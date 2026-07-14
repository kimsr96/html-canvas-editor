import type { PageData } from '../types';

// ---- save (export as a standalone slide HTML) — ported verbatim from public/editor.js ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FabricObjJson = any;

function escapeHtml(s: string | undefined | null): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function objToHtml(o: FabricObjJson): string {
  const angle = o.angle || 0;
  const scaleX = o.scaleX || 1, scaleY = o.scaleY || 1;
  const w = (o.width || 0) * scaleX, h = (o.height || 0) * scaleY;
  const base = `left:${Math.round(o.left)}px;top:${Math.round(o.top)}px;transform:rotate(${angle}deg);transform-origin:center center;`;

  if (o.type === 'image') {
    return `<img class="el" src="${o.src}" style="${base}width:${Math.round(w)}px;height:${Math.round(h)}px;">`;
  }
  if (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox') {
    const fs = (o.fontSize || 24) * scaleY;
    const color = o.fill || '#000';
    const weight = o.fontWeight || 'normal';
    const style = o.fontStyle || 'normal';
    const decoration = o.underline ? 'text-decoration:underline;' : '';
    const align = o.textAlign || 'left';
    const lineHeight = o.lineHeight ? `line-height:${o.lineHeight};` : '';
    return `<div class="el" style="${base}font-size:${fs}px;color:${color};font-family:${o.fontFamily || "'Pretendard',sans-serif"};font-weight:${weight};font-style:${style};text-align:${align};${lineHeight}${decoration}white-space:pre-wrap;width:${Math.round(w)}px;">${escapeHtml(o.text)}</div>`;
  }
  if (o.type === 'rect') {
    const fill = o.fill || 'transparent';
    const stroke = o.stroke && o.stroke !== 'transparent' && o.strokeWidth ? `border:${o.strokeWidth}px solid ${o.stroke};` : '';
    const radius = Math.max(o.rx || 0, o.ry || 0);
    const opacity = o.opacity != null && o.opacity !== 1 ? `opacity:${o.opacity};` : '';
    return `<div class="el" style="${base}width:${Math.round(w)}px;height:${Math.round(h)}px;background:${fill};${stroke}border-radius:${radius}px;${opacity}"></div>`;
  }
  return '';
}

export function buildExportHtml(pages: PageData[]): string {
  const pagesHtml = pages.map((p, i) => {
    const objs = (p.json && (p.json as FabricObjJson).objects) || [];
    const inner = objs.map(objToHtml).join('\n');
    const w = p.w || 1280, h = p.h || 720;
    return `<section class="page${i === 0 ? ' on' : ''}" style="width:${w}px;height:${h}px" data-w="${w}" data-h="${h}">${inner}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>편집된 슬라이드</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#111;font-family:'Pretendard',sans-serif;overflow:hidden}
.deck{position:relative;width:100vw;height:100vh}
.page{
  background:#fff;position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%) scale(var(--fit,1));transform-origin:center center;
  display:none;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.3)
}
.page.on{display:block}
.el{position:absolute}
.hud{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:14px;
  font-size:12px;color:#888}
</style>
</head>
<body>
<div class="deck" id="deck">
${pagesHtml}
</div>
<div class="hud">← → 또는 스페이스 · 클릭으로 이동</div>
<script>
const pages=[...document.querySelectorAll('.page')];let i=0;
function fit(){
  const cur=pages[i];
  const w=Number(cur.dataset.w)||1280, h=Number(cur.dataset.h)||720;
  const s=Math.min(window.innerWidth/w,window.innerHeight/h);
  document.documentElement.style.setProperty('--fit',s);
}
function go(n){i=Math.max(0,Math.min(pages.length-1,n));pages.forEach((p,k)=>p.classList.toggle('on',k===i));fit();}
window.addEventListener('resize',fit);
document.addEventListener('keydown',e=>{
  if(['ArrowRight',' ','PageDown'].includes(e.key)){e.preventDefault();go(i+1);}
  if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();go(i-1);}
});
document.getElementById('deck').addEventListener('click',()=>go(i+1));
go(0);
</script>
</body>
</html>`;
}
