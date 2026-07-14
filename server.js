const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '150mb' }));

// serve the built React app from dist/ if present, otherwise fall back to the
// legacy vanilla-JS public/ build (kept as a backup until dist/ is verified)
const distDir = path.join(__dirname, 'dist');
const staticDir = fs.existsSync(distDir) ? distDir : path.join(__dirname, 'public');
app.use(express.static(staticDir));

// decks live one level up from this project folder
const ROOT = path.resolve(__dirname, '..');

function inlineLocalImage(src) {
  if (typeof src !== 'string' || !src.startsWith('file://')) return src;
  try {
    const localPath = decodeURIComponent(new URL(src).pathname);
    if (!fs.existsSync(localPath)) return src;
    const ext = path.extname(localPath).toLowerCase();
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(localPath).toString('base64')}`;
  } catch {
    return src;
  }
}

app.get('/api/list', (req, res) => {
  const files = fs.readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.html'));
  res.json(files);
});

app.post('/api/import', async (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: 'file required' });
  const filePath = path.join(ROOT, path.basename(file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('file://' + filePath);
    // The source deck fades each active slide in for 400ms. Importing during
    // that transition makes the thumbnail look washed out and can capture an
    // intermediate frame instead of the slide's final colors.
    await page.addStyleTag({ content: '.hud{display:none!important} .bar{display:none!important} .sl{animation:none!important;opacity:1!important}' });
    // Match the source deck's final typography before measuring positions and
    // widths; otherwise a late webfont swap can change wrapping in the editor.
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(200);
    const count = await page.evaluate(() => document.querySelectorAll('.sl').length);
    const pages = [];
    for (let i = 0; i < Math.max(count, 1); i++) {
      await page.evaluate((idx) => {
        document.querySelectorAll('.sl').forEach((s, k) => s.classList.toggle('on', k === idx));
      }, i);
      await page.waitForTimeout(120);
      const imported = await page.evaluate(() => {
        const active = [...document.querySelectorAll('.sl')].find((s) => s.classList.contains('on')) || document.querySelector('.sl');
        if (!active) return { json: { version: '5.3.0', objects: [] }, bg: null, thumb: null, w: 1280, h: 720 };
        const sectionRect = active.getBoundingClientRect();
        const scale = sectionRect.width / (active.offsetWidth || 1280) || 1;
        const w = active.offsetWidth || 1280, h = active.offsetHeight || 720;
        const parsePx = (value) => Number.parseFloat(value) || 0;
        const paint = (value) => value && value !== 'transparent' ? value : null;
        const objects = [];
        for (const el of [active, ...active.querySelectorAll('*')]) {
          if (!(el instanceof HTMLElement)) continue;
          const cs = getComputedStyle(el), rect = el.getBoundingClientRect();
          const text = (el.innerText || '').trim();
          const childHasText = [...el.children].some((child) => (child.textContent || '').trim());
          const directTextNodes = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim());
          const image = el instanceof HTMLImageElement;
          const hasPaint = !!(paint(cs.backgroundColor) || (cs.borderStyle !== 'none' && parsePx(cs.borderWidth) > 0));
          const isText = !!text && el.children.length === 0 && !image;
          const hasDirectText = directTextNodes.length > 0 && !image;
          if ((!isText && !image && !hasPaint && !hasDirectText) || rect.width < 1 || rect.height < 1) continue;
          const isPageBackground = el === active;
          const base = {
            left: (rect.left - sectionRect.left) / scale,
            top: (rect.top - sectionRect.top) / scale,
            // Keep the section background for rendering, but never let it
            // become the selected object when the user clicks empty space.
            selectable: !isPageBackground,
            evented: !isPageBackground,
            angle: 0,
            scaleX: 1,
            scaleY: 1,
          };
          // A painted element can also contain direct text (for example the
          // dark .prompt block). Keep its background and extract the text
          // separately instead of choosing one representation and dropping
          // the other.
          if (!image && hasPaint) {
            objects.push({ type: 'rect', ...base, width: rect.width / scale, height: rect.height / scale, fill: paint(cs.backgroundColor) || 'rgba(0,0,0,0)', stroke: cs.borderStyle !== 'none' ? paint(cs.borderColor) : null, strokeWidth: parsePx(cs.borderWidth), rx: parsePx(cs.borderTopLeftRadius), ry: parsePx(cs.borderTopLeftRadius) });
          }
          if (image) {
            objects.push({ type: 'image', ...base, src: el.src, width: rect.width / scale, height: rect.height / scale });
          } else if (hasDirectText && el.children.length > 0) {
            // Preserve text nodes that sit beside nested elements, e.g. the
            // sentence after the numbered span in a .row element.
            for (const node of directTextNodes) {
              const range = document.createRange();
              range.selectNodeContents(node);
              const textRect = range.getBoundingClientRect();
              const directText = (node.textContent || '').trim();
              if (!directText || textRect.width < 1 || textRect.height < 1) continue;
              objects.push({
                type: 'i-text',
                left: (textRect.left - sectionRect.left) / scale,
                top: (textRect.top - sectionRect.top) / scale,
                selectable: true,
                evented: true,
                angle: 0,
                scaleX: 1,
                scaleY: 1,
                text: directText,
                width: textRect.width / scale,
                height: textRect.height / scale,
                fontSize: parsePx(cs.fontSize),
                fontFamily: cs.fontFamily,
                fontWeight: cs.fontWeight,
                fontStyle: cs.fontStyle,
                fill: cs.color,
                lineHeight: cs.lineHeight === 'normal' ? 1.2 : parsePx(cs.lineHeight) / (parsePx(cs.fontSize) || 1),
                textAlign: cs.textAlign,
                styles: {},
              });
            }
          } else if (isText) {
            const fontSize = parsePx(cs.fontSize);
            const lineHeight = cs.lineHeight === 'normal' ? 1.2 : parsePx(cs.lineHeight) / (fontSize || 1);
            // Source HTML text is laid out inside its measured CSS box. Use a
            // Fabric Textbox so card descriptions keep that width and wrap in
            // the same places instead of overflowing as IText does.
            objects.push({ type: 'textbox', ...base, text, width: rect.width / scale, height: rect.height / scale, fontSize, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fill: cs.color, lineHeight, textAlign: cs.textAlign, styles: {} });
          } else if (!hasPaint) {
            objects.push({ type: 'rect', ...base, width: rect.width / scale, height: rect.height / scale, fill: paint(cs.backgroundColor) || 'rgba(0,0,0,0)', stroke: cs.borderStyle !== 'none' ? paint(cs.borderColor) : null, strokeWidth: parsePx(cs.borderWidth), rx: parsePx(cs.borderTopLeftRadius), ry: parsePx(cs.borderTopLeftRadius) });
          }
        }
        const activeStyle = getComputedStyle(active);
        return { json: { version: '5.3.0', objects }, bg: null, thumb: null, w, h, hasBackgroundImage: activeStyle.backgroundImage !== 'none' };
      });
      // Freeze inline/external <img> elements as data URLs. Fabric otherwise
      // waits on remote image requests before completing loadFromJSON, which
      // can leave a whole slide blank when an icon host is slow or blocked.
      const sourceImageRects = await page.evaluate(() => {
        const active = [...document.querySelectorAll('.sl')].find((s) => s.classList.contains('on'));
        return active ? [...active.querySelectorAll('img')].map((img) => {
          const r = img.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }).filter((r) => r.width > 0 && r.height > 0) : [];
      });
      let sourceImageIndex = 0;
      for (const object of imported.json.objects) {
        if (object.type !== 'image' || String(object.src || '').startsWith('data:')) continue;
        const rect = sourceImageRects[sourceImageIndex++];
        if (!rect) continue;
        const imageBuf = await page.screenshot({ clip: rect });
        object.src = 'data:image/png;base64,' + imageBuf.toString('base64');
      }
      if (imported.hasBackgroundImage) {
        const background = await page.evaluate(() => {
          const active = [...document.querySelectorAll('.sl')].find((s) => s.classList.contains('on'));
          if (!active) return null;
          const rect = active.getBoundingClientRect();
          const children = [...active.children];
          children.forEach((child) => { child.dataset.importVisibility = child.style.visibility; child.style.visibility = 'hidden'; });
          return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, count: children.length };
        });
        if (background) {
          const bgBuf = await page.screenshot({ clip: background.rect });
          await page.evaluate(() => {
            const active = [...document.querySelectorAll('.sl')].find((s) => s.classList.contains('on'));
            active && [...active.children].forEach((child) => {
              child.style.visibility = child.dataset.importVisibility || '';
              delete child.dataset.importVisibility;
            });
          });
          const backgroundObject = {
            type: 'image',
            src: 'data:image/png;base64,' + bgBuf.toString('base64'),
            left: 0,
            top: 0,
            width: imported.w,
            height: imported.h,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
            selectable: false,
            evented: false,
          };
          // The section itself is imported as the first white background rect.
          // Place the captured image immediately above it so it remains visible
          // while all extracted text and cards stay above the image.
          imported.json.objects.splice(imported.json.objects.length > 0 ? 1 : 0, 0, backgroundObject);
        }
      }
      const objects = imported.json && Array.isArray(imported.json.objects) ? imported.json.objects : [];
      objects.forEach((object) => {
        if (object.type === 'image') object.src = inlineLocalImage(object.src);
      });
      const buf = await page.screenshot();
      imported.thumb = 'data:image/png;base64,' + buf.toString('base64');
      pages.push(imported);
    }
    res.json({ pages });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  } finally {
    if (browser) await browser.close();
  }
});

app.post('/api/save', (req, res) => {
  const { file, html } = req.body || {};
  if (!file || !html) return res.status(400).json({ error: 'file and html required' });
  const safe = path.basename(file);
  if (!safe.toLowerCase().endsWith('.html')) return res.status(400).json({ error: 'file must end with .html' });
  fs.writeFileSync(path.join(ROOT, safe), html, 'utf8');
  res.json({ ok: true, path: safe });
});

const PORT = process.env.PORT || 5177;
app.listen(PORT, () => {
  console.log(`Slide editor running at http://localhost:${PORT}`);
  console.log(`Deck folder: ${ROOT}`);
});
