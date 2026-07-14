import { fabric } from 'fabric';
import type { EditorEngine } from './engine';
import { pushHistory } from './history';

// ---- clipboard: elements (Ctrl+C / Ctrl+X / Ctrl+V) ----

export function copySelectionToSystemClipboard(obj: fabric.Object): void {
  try {
    if (obj.type === 'image') {
      const dataUrl = (obj as fabric.Image).toDataURL({ format: 'png' });
      fetch(dataUrl).then((r) => r.blob()).then((blob) => {
        // eslint-disable-next-line no-undef
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
      }).catch(() => {});
    } else if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      const text = (obj as fabric.IText).text || '';
      navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch {
    /* clipboard API unavailable/denied — internal copy still works */
  }
}

export function copySelected(engine: EditorEngine): boolean {
  const active = engine.canvas.getActiveObject();
  if (!active || active === engine.cropRect) return false;
  active.clone((cloned: fabric.Object) => { engine.clipboard = cloned; });
  engine.pasteCount = 0;
  engine.pageClipboard = null; // last copy wins: element copy supersedes page copy
  copySelectionToSystemClipboard(active);
  return true;
}

export function cutSelected(engine: EditorEngine): boolean {
  const active = engine.canvas.getActiveObject();
  if (!active || active === engine.cropRect) return false;
  copySelected(engine);
  engine.deleteSelected();
  return true;
}

export function pasteFromInternalClipboard(engine: EditorEngine): void {
  if (!engine.clipboard || engine.currentIndex < 0) return;
  engine.pasteCount++;
  const offset = 24 * engine.pasteCount;
  const clipboard = engine.clipboard;
  clipboard.clone((cloned: fabric.Object) => {
    if (cloned.type === 'activeSelection') {
      const sel = cloned as fabric.ActiveSelection;
      sel.canvas = engine.canvas;
      sel.set({ left: (clipboard.left || 0) + offset, top: (clipboard.top || 0) + offset });
      sel.forEachObject((obj) => engine.canvas.add(obj));
    } else {
      cloned.set({ left: (clipboard.left || 0) + offset, top: (clipboard.top || 0) + offset });
      engine.canvas.add(cloned);
    }
    engine.canvas.setActiveObject(cloned);
    engine.canvas.requestRenderAll();
    pushHistory(engine);
    engine.refreshThumb();
  });
}

// ---- clipboard: pages (page-level copy/duplicate/paste) ----

export function copyPageAt(engine: EditorEngine, i: number): void {
  const pages = engine.store.getState().pages;
  if (i < 0 || i >= pages.length) return;
  if (i === engine.currentIndex) engine.captureCurrentPage();
  const p = engine.store.getState().pages[i];
  engine.pageClipboard = JSON.parse(JSON.stringify({ json: p.json, bg: p.bg, thumb: p.thumb, w: p.w, h: p.h }));
  engine.clipboard = null; // last copy wins: page copy supersedes element copy
}

export function pastePageAfter(engine: EditorEngine, i: number): void {
  if (!engine.pageClipboard) return;
  const copy = JSON.parse(JSON.stringify(engine.pageClipboard));
  const pages = engine.store.getState().pages.slice();
  pages.splice(i + 1, 0, { json: copy.json, bg: copy.bg, thumb: copy.thumb || null, w: copy.w, h: copy.h });
  engine.store.getState().setPages(pages);
  engine.loadPage(i + 1);
}
