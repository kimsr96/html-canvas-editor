// Pages model: each page = { json: fabric-canvas-json|null, bg: dataURL|null, thumb: dataURL|null, w, h }
let pages = [];
let currentIndex = -1;
let canvas;
let cropRect = null;
let cropTarget = null;
let zoomLevel = null; // null = auto-fit to stage; number = manual override
let history = [];
let historyIndex = -1;
let snapLines = [];
let CANVAS_W = 1280, CANVAS_H = 720; // dimensions of the page currently loaded on the canvas
let clipboard = null; // fabric object clone, survives page switches
let pasteCount = 0;
let pageClipboard = null; // { json, bg, w, h } deep copy of a page

function initCanvas() {
  canvas = new fabric.Canvas('c', { width: CANVAS_W, height: CANVAS_H, backgroundColor: '#ffffff' });
  canvas.on('selection:created', updatePropsAndButtons);
  canvas.on('selection:updated', updatePropsAndButtons);
  canvas.on('selection:cleared', updatePropsAndButtons);
  canvas.on('object:modified', () => { clearSnapLines(); updatePropsAndButtons(); refreshThumb(); pushHistory(); });
  canvas.on('object:moving', (e) => { applySnap(e.target); updatePropsAndButtons(); });
  canvas.on('object:scaling', updatePropsAndButtons);
  canvas.on('object:rotating', updatePropsAndButtons);
  canvas.on('mouse:up', clearSnapLines);
  canvas.on('text:editing:exited', () => { pushHistory(); refreshThumb(); });
  canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const target = canvas.findTarget(e, false);
    if (target && target !== cropRect) {
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      showMenu(e.clientX, e.clientY, elementMenuItems(target));
    } else if (clipboard) {
      showMenu(e.clientX, e.clientY, [
        { label: '붙여넣기 (Ctrl+V)', fn: () => pasteFromInternalClipboard() },
      ]);
    }
  });
  fitStage();
  window.addEventListener('resize', fitStage);
  document.getElementById('stage').addEventListener('scroll', updateMiniToolbar);
}

function fitStage() {
  const stage = document.getElementById('stage');
  const wrapper = canvas.wrapperEl;
  if (!wrapper) return;
  const availW = stage.clientWidth - 40;
  const availH = stage.clientHeight - 40;
  const autoFit = Math.min(availW / CANVAS_W, availH / CANVAS_H, 1);
  const scale = zoomLevel != null ? zoomLevel : autoFit;
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = 'center center';
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = Math.round(scale * 100) + '%';
  updateMiniToolbar();
}

function setZoom(delta) {
  const stage = document.getElementById('stage');
  const availW = stage.clientWidth - 40, availH = stage.clientHeight - 40;
  const autoFit = Math.min(availW / CANVAS_W, availH / CANVAS_H, 1);
  const current = zoomLevel != null ? zoomLevel : autoFit;
  zoomLevel = Math.min(3, Math.max(0.1, current + delta));
  fitStage();
}

document.getElementById('zoomOut').onclick = () => setZoom(-0.1);
document.getElementById('zoomIn').onclick = () => setZoom(0.1);
document.getElementById('zoomFit').onclick = () => { zoomLevel = null; fitStage(); };

// ---- context menu (singleton, reused for page + element menus) ----

function hideMenu() {
  const menu = document.getElementById('ctxMenu');
  menu.hidden = true;
  menu.innerHTML = '';
}

function showMenu(x, y, items) {
  const menu = document.getElementById('ctxMenu');
  menu.innerHTML = '';
  items.forEach((item) => {
    const b = document.createElement('button');
    b.textContent = item.label;
    b.disabled = !!item.disabled;
    b.onclick = (e) => {
      e.stopPropagation();
      hideMenu();
      if (!item.disabled && item.fn) item.fn();
    };
    menu.appendChild(b);
  });
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.hidden = false;
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('ctxMenu');
  if (!menu.hidden && !menu.contains(e.target)) hideMenu();
});

// ---- snap guides (canvas center / edges) ----
const SNAP_PX = 6;

function clearSnapLines() {
  snapLines.forEach((l) => canvas.remove(l));
  snapLines = [];
}

function addSnapLine(coords) {
  const line = new fabric.Line(coords, {
    stroke: '#ff4757', strokeWidth: 1, selectable: false, evented: false, excludeFromExport: true,
  });
  canvas.add(line);
  snapLines.push(line);
}

function applySnap(obj) {
  if (!obj || obj === cropRect) return;
  clearSnapLines();
  const w = obj.getScaledWidth(), h = obj.getScaledHeight();
  const cx = obj.left + w / 2, cy = obj.top + h / 2;
  const canvasCX = CANVAS_W / 2, canvasCY = CANVAS_H / 2;

  if (Math.abs(cx - canvasCX) < SNAP_PX) {
    obj.set('left', canvasCX - w / 2);
    addSnapLine([canvasCX, 0, canvasCX, CANVAS_H]);
  }
  if (Math.abs(cy - canvasCY) < SNAP_PX) {
    obj.set('top', canvasCY - h / 2);
    addSnapLine([0, canvasCY, CANVAS_W, canvasCY]);
  }
  if (Math.abs(obj.left) < SNAP_PX) { obj.set('left', 0); addSnapLine([0, 0, 0, CANVAS_H]); }
  if (Math.abs(obj.left + w - CANVAS_W) < SNAP_PX) { obj.set('left', CANVAS_W - w); addSnapLine([CANVAS_W, 0, CANVAS_W, CANVAS_H]); }
  if (Math.abs(obj.top) < SNAP_PX) { obj.set('top', 0); addSnapLine([0, 0, CANVAS_W, 0]); }
  if (Math.abs(obj.top + h - CANVAS_H) < SNAP_PX) { obj.set('top', CANVAS_H - h); addSnapLine([0, CANVAS_H, CANVAS_W, CANVAS_H]); }
  obj.setCoords();
}

// ---- undo / redo (per-page snapshot stack) ----

function pushHistory() {
  if (!canvas) return;
  const json = JSON.stringify(canvas.toJSON(['selectable', 'evented']));
  history = history.slice(0, historyIndex + 1);
  history.push(json);
  if (history.length > 50) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

function resetHistory() {
  history = [];
  historyIndex = -1;
  pushHistory();
}

function updateUndoRedoButtons() {
  document.getElementById('btnUndo').disabled = historyIndex <= 0;
  document.getElementById('btnRedo').disabled = historyIndex >= history.length - 1;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  canvas.loadFromJSON(JSON.parse(history[historyIndex]), () => {
    canvas.renderAll(); updatePropsAndButtons(); refreshThumb(); updateUndoRedoButtons();
  });
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  canvas.loadFromJSON(JSON.parse(history[historyIndex]), () => {
    canvas.renderAll(); updatePropsAndButtons(); refreshThumb(); updateUndoRedoButtons();
  });
}

document.getElementById('btnUndo').onclick = undo;
document.getElementById('btnRedo').onclick = redo;

// ---- duplicate ----

function duplicateSelected() {
  const active = canvas.getActiveObject();
  if (!active || active === cropRect) return;
  active.clone((cloned) => {
    cloned.set({ left: (active.left || 0) + 24, top: (active.top || 0) + 24 });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.requestRenderAll();
    pushHistory();
    refreshThumb();
  });
}

// ---- clipboard: elements (Ctrl+C / Ctrl+X / Ctrl+V) ----

function copySelectionToSystemClipboard(obj) {
  try {
    if (obj.type === 'image') {
      const dataUrl = obj.toDataURL({ format: 'png' });
      fetch(dataUrl).then((r) => r.blob()).then((blob) => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
      }).catch(() => {});
    } else if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      navigator.clipboard.writeText(obj.text).catch(() => {});
    }
  } catch (e) { /* clipboard API unavailable/denied — internal copy still works */ }
}

function copySelected() {
  const active = canvas.getActiveObject();
  if (!active || active === cropRect) return false;
  active.clone((cloned) => { clipboard = cloned; });
  pasteCount = 0;
  pageClipboard = null; // last copy wins: element copy supersedes page copy
  copySelectionToSystemClipboard(active);
  return true;
}

function cutSelected() {
  const active = canvas.getActiveObject();
  if (!active || active === cropRect) return false;
  copySelected();
  document.getElementById('btnDelete').click(); // handles pushHistory + refreshThumb
  return true;
}

function pasteFromInternalClipboard() {
  if (!clipboard || currentIndex < 0) return;
  pasteCount++;
  const offset = 24 * pasteCount;
  clipboard.clone((cloned) => {
    if (cloned.type === 'activeSelection') {
      cloned.canvas = canvas;
      cloned.set({ left: (clipboard.left || 0) + offset, top: (clipboard.top || 0) + offset });
      cloned.forEachObject((obj) => canvas.add(obj));
    } else {
      cloned.set({ left: (clipboard.left || 0) + offset, top: (clipboard.top || 0) + offset });
      canvas.add(cloned);
    }
    canvas.setActiveObject(cloned);
    canvas.requestRenderAll();
    pushHistory();
    refreshThumb();
  });
}

// ---- alignment (relative to canvas) ----

function alignCenterH(obj) {
  obj.set('left', CANVAS_W / 2 - obj.getScaledWidth() / 2);
  obj.setCoords();
  canvas.requestRenderAll();
  pushHistory();
  refreshThumb();
  renderProps(obj);
}

function alignCenterV(obj) {
  obj.set('top', CANVAS_H / 2 - obj.getScaledHeight() / 2);
  obj.setCoords();
  canvas.requestRenderAll();
  pushHistory();
  refreshThumb();
  renderProps(obj);
}

// ---- z-order (keeps a locked imported background, if any, always at the back) ----

function bgLockOffset() {
  const objs = canvas.getObjects();
  return objs.length && objs[0].evented === false && objs[0].selectable === false ? 1 : 0;
}

function orderFront(obj) { canvas.bringToFront(obj); afterOrderChange(); }
function orderForward(obj) { canvas.bringForward(obj); afterOrderChange(); }
function orderBack(obj) {
  const offset = bgLockOffset();
  canvas.moveTo(obj, offset);
  afterOrderChange();
}
function orderBackward(obj) {
  const offset = bgLockOffset();
  const idx = canvas.getObjects().indexOf(obj);
  if (idx > offset) canvas.moveTo(obj, idx - 1);
  afterOrderChange();
}
function afterOrderChange() {
  canvas.requestRenderAll();
  pushHistory();
  refreshThumb();
}

document.getElementById('btnDuplicate').onclick = duplicateSelected;
document.getElementById('miniDup').onclick = duplicateSelected;
document.getElementById('miniDel').onclick = () => document.getElementById('btnDelete').click();

// ---- element context menu (canvas right-click + mini toolbar "more") ----

function elementMenuItems(obj) {
  return [
    { label: '복사 (Ctrl+C)', fn: () => copySelected() },
    { label: '붙여넣기 (Ctrl+V)', disabled: !clipboard, fn: () => pasteFromInternalClipboard() },
    { label: '복제 (Ctrl+D)', fn: () => duplicateSelected() },
    { label: '삭제 (Delete)', fn: () => document.getElementById('btnDelete').click() },
    { label: '맨 앞으로', fn: () => orderFront(obj) },
    { label: '맨 뒤로', fn: () => orderBack(obj) },
  ];
}

document.getElementById('miniMore').onclick = (e) => {
  e.stopPropagation();
  const active = canvas.getActiveObject();
  if (!active || active === cropRect) return;
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, elementMenuItems(active));
};

// ---- floating mini toolbar above the selected element ----

function updateMiniToolbar() {
  const mt = document.getElementById('miniToolbar');
  if (!canvas) return;
  const active = canvas.getActiveObject();
  if (!active || active === cropRect) { mt.hidden = true; return; }
  const wrapperRect = canvas.wrapperEl.getBoundingClientRect();
  const s = wrapperRect.width / CANVAS_W;
  const br = active.getBoundingRect(true, true);
  const screenLeft = wrapperRect.left + br.left * s;
  const screenTop = wrapperRect.top + br.top * s;
  const screenWidth = br.width * s;
  const stageTop = document.getElementById('stage').getBoundingClientRect().top;
  mt.style.left = (screenLeft + screenWidth / 2) + 'px';
  mt.style.top = Math.max(stageTop + 8, screenTop - 40) + 'px';
  mt.hidden = false;
}

function newPage() {
  if (currentIndex >= 0) captureCurrentPage();
  const [w, h] = document.getElementById('canvasSize').value.split('x').map(Number);
  pages.push({ json: null, bg: null, thumb: null, w, h });
  loadPage(pages.length - 1);
}

function captureCurrentPage() {
  if (currentIndex < 0 || !canvas) return;
  pages[currentIndex].json = canvas.toJSON(['selectable', 'evented']);
  pages[currentIndex].thumb = canvas.toDataURL({ format: 'png', multiplier: 0.15 });
}

function refreshThumb() {
  if (currentIndex < 0) return;
  pages[currentIndex].thumb = canvas.toDataURL({ format: 'png', multiplier: 0.15 });
  renderPagesList();
}

function loadPage(idx) {
  if (currentIndex >= 0 && currentIndex !== idx) captureCurrentPage();
  currentIndex = idx;
  cropRect = null;
  cropTarget = null;
  document.getElementById('btnCrop').textContent = '자르기';
  canvas.clear();
  canvas.backgroundColor = '#ffffff';
  const p = pages[idx];
  if (p.json) {
    canvas.loadFromJSON(p.json, () => { canvas.renderAll(); updatePropsAndButtons(); });
  } else {
    canvas.renderAll();
    updatePropsAndButtons();
  }
  renderPagesList();
}

function renderPagesList() {
  const el = document.getElementById('pages');
  el.innerHTML = '';
  pages.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'thumb' + (i === currentIndex ? ' active' : '');
    if (p.thumb) {
      const img = document.createElement('img');
      img.src = p.thumb;
      div.appendChild(img);
    }
    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = i + 1;
    div.appendChild(label);

    const up = document.createElement('button');
    up.textContent = '◀';
    up.title = '이전으로';
    up.onclick = (e) => { e.stopPropagation(); movePage(i, -1); };
    const down = document.createElement('button');
    down.textContent = '▶';
    down.title = '다음으로';
    down.onclick = (e) => { e.stopPropagation(); movePage(i, 1); };
    const dup = document.createElement('button');
    dup.textContent = '⧉';
    dup.title = '페이지 복제 (Ctrl+D)';
    dup.onclick = (e) => { e.stopPropagation(); duplicatePage(i); };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = '삭제';
    del.onclick = (e) => { e.stopPropagation(); deletePage(i); };
    div.appendChild(up);
    div.appendChild(down);
    div.appendChild(dup);
    div.appendChild(del);

    div.onclick = () => loadPage(i);
    div.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, pageMenuItems(i));
    };
    el.appendChild(div);
  });
}

function movePage(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= pages.length) return;
  if (i === currentIndex) captureCurrentPage();
  const tmp = pages[i];
  pages[i] = pages[j];
  pages[j] = tmp;
  if (currentIndex === i) currentIndex = j;
  else if (currentIndex === j) currentIndex = i;
  renderPagesList();
}

function deletePage(i) {
  pages.splice(i, 1);
  if (pages.length === 0) {
    currentIndex = -1;
    newPage();
    return;
  }
  const nextIdx = Math.min(i, pages.length - 1);
  currentIndex = -1; // force reload without trying to capture the just-deleted page
  loadPage(nextIdx);
}

// ---- clipboard: pages (page-level copy/duplicate/paste) ----

function copyPageAt(i) {
  if (i < 0 || i >= pages.length) return;
  if (i === currentIndex) captureCurrentPage();
  const p = pages[i];
  pageClipboard = JSON.parse(JSON.stringify({ json: p.json, bg: p.bg, thumb: p.thumb, w: p.w, h: p.h }));
  clipboard = null; // last copy wins: page copy supersedes element copy
}

function pastePageAfter(i) {
  if (!pageClipboard) return;
  const copy = JSON.parse(JSON.stringify(pageClipboard));
  pages.splice(i + 1, 0, { json: copy.json, bg: copy.bg, thumb: copy.thumb || null, w: copy.w, h: copy.h });
  loadPage(i + 1);
}

function duplicatePage(i) {
  if (i < 0 || i >= pages.length) return;
  if (i === currentIndex) captureCurrentPage();
  const copy = JSON.parse(JSON.stringify(pages[i]));
  pages.splice(i + 1, 0, copy);
  loadPage(i + 1);
}

function pageMenuItems(i) {
  return [
    { label: '페이지 복사', fn: () => copyPageAt(i) },
    { label: '페이지 붙여넣기', disabled: !pageClipboard, fn: () => pastePageAfter(i) },
    { label: '페이지 복제', fn: () => duplicatePage(i) },
    { label: '페이지 삭제', fn: () => deletePage(i) },
  ];
}

// ---- toolbar actions ----

document.getElementById('btnAddPage').onclick = () => newPage();

document.getElementById('btnAddText').onclick = () => {
  const t = new fabric.IText('텍스트를 입력하세요', {
    left: 0, top: 0, fontSize: 36, fontFamily: "'Pretendard', sans-serif", fill: '#1f1f1f',
  });
  canvas.add(t);
  t.set({ left: CANVAS_W / 2 - t.getScaledWidth() / 2, top: CANVAS_H / 2 - t.getScaledHeight() / 2 });
  t.setCoords();
  canvas.setActiveObject(t);
  canvas.requestRenderAll();
  t.enterEditing();
  t.selectAll();
  pushHistory();
  refreshThumb();
};

document.getElementById('fileImg').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    fabric.Image.fromURL(ev.target.result, (img) => {
      if (img.width > 700) img.scaleToWidth(700);
      img.set({ left: 150, top: 100 });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      pushHistory();
      refreshThumb();
    });
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

document.getElementById('btnDelete').onclick = () => {
  const objs = canvas.getActiveObjects();
  if (cropTarget && objs.includes(cropTarget)) cancelCrop();
  objs.forEach((o) => { if (o !== cropRect) canvas.remove(o); });
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  pushHistory();
  refreshThumb();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideMenu(); return; }
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const active = canvas && canvas.getActiveObject();
  if (active && active.isEditing) return; // let native text-field undo/typing work

  const mod = e.metaKey || e.ctrlKey;
  const hasSelection = active && active !== cropRect;
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (hasSelection) duplicateSelected();
    else if (currentIndex >= 0) duplicatePage(currentIndex);
    return;
  }
  if (mod && e.key.toLowerCase() === 'c') {
    if (hasSelection) { e.preventDefault(); copySelected(); }
    else if (currentIndex >= 0) { e.preventDefault(); copyPageAt(currentIndex); }
    return;
  }
  if (mod && e.key.toLowerCase() === 'x') {
    if (hasSelection) { e.preventDefault(); cutSelected(); }
    return;
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && active) {
    document.getElementById('btnDelete').click();
  }
});

// ---- paste (document 'paste' event only — no keydown Ctrl+V handler, avoids double-paste) ----

document.addEventListener('paste', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const active = canvas && canvas.getActiveObject();
  if (active && active.isEditing) return;
  if (!canvas || currentIndex < 0) return;

  const items = (e.clipboardData && e.clipboardData.items) || [];
  let imageItem = null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image/') === 0) { imageItem = items[i]; break; }
  }

  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      fabric.Image.fromURL(ev.target.result, (img) => {
        if (img.width > 700) img.scaleToWidth(700);
        img.set({ left: CANVAS_W / 2 - img.getScaledWidth() / 2, top: CANVAS_H / 2 - img.getScaledHeight() / 2 });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        pushHistory();
        refreshThumb();
      });
    };
    reader.readAsDataURL(file);
    return;
  }

  if (clipboard) {
    e.preventDefault();
    pasteFromInternalClipboard();
    return;
  }

  if (pageClipboard) {
    e.preventDefault();
    pastePageAfter(currentIndex);
    return;
  }

  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (text) {
    e.preventDefault();
    const t = new fabric.IText(text, {
      left: 0, top: 0, fontSize: 36, fontFamily: "'Pretendard', sans-serif", fill: '#1f1f1f',
    });
    canvas.add(t);
    t.set({ left: CANVAS_W / 2 - t.getScaledWidth() / 2, top: CANVAS_H / 2 - t.getScaledHeight() / 2 });
    t.setCoords();
    canvas.setActiveObject(t);
    canvas.requestRenderAll();
    pushHistory();
    refreshThumb();
  }
});

function updatePropsAndButtons() {
  const active = canvas.getActiveObject();
  const isCropRect = active === cropRect;
  document.getElementById('btnDelete').disabled = !active;
  document.getElementById('btnDuplicate').disabled = !active || isCropRect;
  document.getElementById('btnCrop').disabled = !(active && active.type === 'image') && !isCropRect;
  renderProps(active);
  updateMiniToolbar();
}

function renderProps(obj) {
  const el = document.getElementById('props');
  el.innerHTML = '';
  if (!obj) {
    el.innerHTML = '<div class="hint">요소를 선택하세요</div>';
    return;
  }
  const addRow = (label, input) => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    const l = document.createElement('label');
    l.textContent = label;
    row.appendChild(l);
    row.appendChild(input);
    el.appendChild(row);
  };
  const numInput = (val, onChange) => {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = Math.round(val);
    i.oninput = () => { onChange(Number(i.value)); canvas.requestRenderAll(); };
    return i;
  };

  addRow('X', numInput(obj.left, (v) => obj.set('left', v)));
  addRow('Y', numInput(obj.top, (v) => obj.set('top', v)));
  addRow('W', numInput(obj.getScaledWidth(), (v) => obj.set('scaleX', v / obj.width)));
  addRow('H', numInput(obj.getScaledHeight(), (v) => obj.set('scaleY', v / obj.height)));
  addRow('회전°', numInput(obj.angle || 0, (v) => obj.set('angle', v)));

  if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
    addRow('글자크기', numInput(obj.fontSize, (v) => obj.set('fontSize', v)));
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = /^#/.test(obj.fill) ? obj.fill : '#1f1f1f';
    colorInput.oninput = () => { obj.set('fill', colorInput.value); canvas.requestRenderAll(); };
    addRow('색상', colorInput);

    const fontSelect = document.createElement('select');
    [
      ["'Pretendard', sans-serif", 'Pretendard'],
      ['-apple-system, sans-serif', '시스템'],
      ['serif', '명조'],
      ["'Courier New', monospace", '고정폭'],
    ].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (obj.fontFamily === val) opt.selected = true;
      fontSelect.appendChild(opt);
    });
    fontSelect.onchange = () => {
      obj.set('fontFamily', fontSelect.value);
      canvas.requestRenderAll();
      pushHistory();
      refreshThumb();
    };
    addRow('폰트', fontSelect);

    const styleGroup = document.createElement('div');
    styleGroup.className = 'btn-group';
    const toggleBtn = (text, title2, isOn, fn) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title2;
      if (isOn) b.classList.add('on');
      b.onclick = () => {
        fn();
        canvas.requestRenderAll();
        pushHistory();
        refreshThumb();
        renderProps(obj);
      };
      styleGroup.appendChild(b);
    };
    toggleBtn('B', '굵게', obj.fontWeight === 'bold', () => obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold'));
    toggleBtn('I', '기울임', obj.fontStyle === 'italic', () => obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic'));
    toggleBtn('U', '밑줄', !!obj.underline, () => obj.set('underline', !obj.underline));
    addRow('스타일', styleGroup);

    const alignGroup = document.createElement('div');
    alignGroup.className = 'btn-group';
    [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].forEach(([align, title2]) => {
      const b = document.createElement('button');
      b.textContent = title2;
      if (obj.textAlign === align) b.classList.add('on');
      b.onclick = () => {
        obj.set('textAlign', align);
        canvas.requestRenderAll();
        pushHistory();
        refreshThumb();
        renderProps(obj);
      };
      alignGroup.appendChild(b);
    });
    addRow('정렬', alignGroup);
  }

  const addGroup = (title, buttons) => {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.textContent = title;
    el.appendChild(label);
    const group = document.createElement('div');
    group.className = 'btn-group';
    buttons.forEach(([text, title2, fn]) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title2;
      b.onclick = () => fn(obj);
      group.appendChild(b);
    });
    el.appendChild(group);
  };

  addGroup('정렬', [
    ['↔', '가로 중앙정렬', alignCenterH],
    ['↕', '세로 중앙정렬', alignCenterV],
  ]);
  addGroup('순서', [
    ['⤒', '맨 앞으로', orderFront],
    ['↑', '앞으로', orderForward],
    ['↓', '뒤로', orderBackward],
    ['⤓', '맨 뒤로', orderBack],
  ]);
}

// ---- crop ----

document.getElementById('btnCrop').onclick = () => {
  if (cropRect) { applyCrop(); return; }
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'image') return;
  cropTarget = active;
  const b = active.getBoundingRect();
  cropRect = new fabric.Rect({
    left: b.left + b.width * 0.1,
    top: b.top + b.height * 0.1,
    width: b.width * 0.8,
    height: b.height * 0.8,
    fill: 'rgba(20,114,207,0.15)',
    stroke: '#1472cf',
    strokeDashArray: [6, 4],
    strokeWidth: 2,
    cornerColor: '#1472cf',
    transparentCorners: false,
  });
  canvas.add(cropRect);
  canvas.setActiveObject(cropRect);
  canvas.requestRenderAll();
  document.getElementById('btnCrop').textContent = '자르기 적용';
};

function cancelCrop() {
  if (cropRect) canvas.remove(cropRect);
  cropRect = null;
  cropTarget = null;
  document.getElementById('btnCrop').textContent = '자르기';
}

function applyCrop() {
  if (!cropRect || !cropTarget) return;
  const imgEl = cropTarget.getElement();
  const bounds = cropTarget.getBoundingRect();
  const relLeft = (cropRect.left - bounds.left) / cropTarget.scaleX;
  const relTop = (cropRect.top - bounds.top) / cropTarget.scaleY;
  const relW = (cropRect.width * cropRect.scaleX) / cropTarget.scaleX;
  const relH = (cropRect.height * cropRect.scaleY) / cropTarget.scaleY;

  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(relW));
  off.height = Math.max(1, Math.round(relH));
  const ctx = off.getContext('2d');
  ctx.drawImage(imgEl, relLeft, relTop, relW, relH, 0, 0, off.width, off.height);
  const newSrc = off.toDataURL('image/png');

  const newLeft = cropRect.left, newTop = cropRect.top, angle = cropTarget.angle;
  const targetW = cropRect.width * cropRect.scaleX, targetH = cropRect.height * cropRect.scaleY;

  fabric.Image.fromURL(newSrc, (img) => {
    img.set({ left: newLeft, top: newTop, angle: angle });
    img.scaleToWidth(targetW);
    if (img.getScaledHeight() !== targetH) img.set('scaleY', targetH / img.height);
    canvas.remove(cropTarget);
    canvas.remove(cropRect);
    canvas.add(img);
    canvas.setActiveObject(img);
    cropRect = null;
    cropTarget = null;
    document.getElementById('btnCrop').textContent = '자르기';
    canvas.requestRenderAll();
    pushHistory();
    refreshThumb();
  });
}

// ---- import existing deck (server-side screenshot per slide) ----

async function loadDeckList() {
  const res = await fetch('/api/list');
  const files = await res.json();
  const sel = document.getElementById('deckSelect');
  files.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    sel.appendChild(opt);
  });
}

document.getElementById('btnImport').onclick = async () => {
  const file = document.getElementById('deckSelect').value;
  if (!file) { alert('덱을 선택하세요'); return; }
  const btn = document.getElementById('btnImport');
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  try {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (currentIndex >= 0) captureCurrentPage();
    const startIdx = pages.length;
    data.pages.forEach((dataUrl) => {
      pages.push({ json: null, bg: dataUrl, thumb: dataUrl, w: 1280, h: 720 });
    });
    loadPage(startIdx);
    const base = file.replace(/\.html$/i, '');
    document.getElementById('saveName').value = base + '-edited.html';
  } catch (e) {
    alert('가져오기 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '가져오기';
  }
};

// wrap loadPage to place the imported background image as a locked base layer
loadPage = function (idx) {
  if (currentIndex >= 0 && currentIndex !== idx) captureCurrentPage();
  currentIndex = idx;
  cropRect = null;
  cropTarget = null;
  document.getElementById('btnCrop').textContent = '자르기';
  const p = pages[idx];

  CANVAS_W = p.w || 1280;
  CANVAS_H = p.h || 720;
  canvas.setWidth(CANVAS_W);
  canvas.setHeight(CANVAS_H);
  canvas.clear();
  canvas.backgroundColor = '#ffffff';

  const finish = () => {
    if (p.json) {
      canvas.loadFromJSON(p.json, () => { canvas.renderAll(); updatePropsAndButtons(); resetHistory(); fitStage(); });
    } else {
      canvas.renderAll();
      updatePropsAndButtons();
      resetHistory();
      fitStage();
    }
    renderPagesList();
  };

  if (p.json) {
    finish();
  } else if (p.bg) {
    fabric.Image.fromURL(p.bg, (img) => {
      img.set({ left: 0, top: 0, selectable: false, evented: false });
      const scale = Math.min(CANVAS_W / img.width, CANVAS_H / img.height);
      img.scale(scale);
      canvas.add(img);
      finish();
    });
  } else {
    finish();
  }
};

// ---- save (export as a standalone slide HTML) ----

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function objToHtml(o) {
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
    return `<div class="el" style="${base}font-size:${fs}px;color:${color};font-family:'Pretendard',sans-serif;white-space:pre-wrap;width:${Math.round(w)}px;">${escapeHtml(o.text)}</div>`;
  }
  return '';
}

function buildExportHtml() {
  captureCurrentPage();
  const pagesHtml = pages.map((p, i) => {
    const objs = (p.json && p.json.objects) || [];
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

document.getElementById('btnSave').onclick = async () => {
  const file = document.getElementById('saveName').value.trim();
  if (!file) { alert('저장할 파일명을 입력하세요 (예: my-deck.html)'); return; }
  const html = buildExportHtml();
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, html }),
  });
  const data = await res.json();
  if (data.error) alert('저장 실패: ' + data.error);
  else alert('저장됨: ' + data.path);
};

// ---- boot ----
initCanvas();
loadDeckList();
newPage();
