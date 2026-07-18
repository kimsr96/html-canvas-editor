import { fabric } from 'fabric';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useEditorStore } from '../store/editorStore';
import type { ImportedPage, MenuItem, PageData } from '../types';
import { clearSnapLines, applySnap } from './snap';
import { pushHistory, resetHistory, undo, redo } from './history';
import {
  copySelected, cutSelected, pasteFromInternalClipboard,
  copyPageAt, pastePageAfter,
} from './clipboard';
import {
  duplicateSelected, elementMenuItems, addImageFromDataUrl,
  startCrop, applyCrop, cancelCrop,
} from './canvasOps';
import { buildExportHtml } from './exportHtml';

const AUTOSAVE_KEY = 'slide-editor:autosave:v1';
const AUTOSAVE_DEBOUNCE_MS = 1000;

type Store = UseBoundStore<StoreApi<ReturnType<typeof useEditorStore.getState>>>;

// @types/fabric doesn't declare these DOM properties even though fabric.Canvas
// sets them at runtime (they back the wrapper/upper canvas used for zoom + hit testing).
type FabricCanvasDom = fabric.Canvas & {
  wrapperEl: HTMLDivElement;
  upperCanvasEl: HTMLCanvasElement;
};

// Fabric 5.3.0 uses the non-standard CanvasTextBaseline value
// "alphabetical". Chromium logs a warning for it; the standard value is
// "alphabetic". Translate only that legacy value at the browser API boundary.
let textBaselineCompatibilityInstalled = false;
function installTextBaselineCompatibility(): void {
  if (textBaselineCompatibilityInstalled || typeof CanvasRenderingContext2D === 'undefined') return;
  const proto = CanvasRenderingContext2D.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'textBaseline');
  if (!descriptor?.get || !descriptor.set || !descriptor.configurable) return;
  Object.defineProperty(proto, 'textBaseline', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value: string) {
      descriptor.set!.call(this, value === 'alphabetical' ? 'alphabetic' : value);
    },
  });
  textBaselineCompatibilityInstalled = true;
}

// Ported from public/editor.js. The engine owns the fabric.Canvas instance and all
// the mutable editing state that used to live as module-level `let` variables
// (cropRect, history, clipboard, ...). React components read UI-relevant meta
// through the zustand store; the canvas content itself stays fabric-owned.
export class EditorEngine {
  canvas!: fabric.Canvas;
  stageEl: HTMLDivElement | null = null;
  store: Store = useEditorStore;

  CANVAS_W = 1280;
  CANVAS_H = 720;
  cropRect: fabric.Rect | null = null;
  cropTarget: fabric.Image | null = null;
  zoomLevel: number | null = null;
  history: string[] = [];
  historyIndex = -1;
  snapLines: fabric.Line[] = [];
  clipboard: fabric.Object | null = null;
  pasteCount = 0;
  pageClipboard: PageData | null = null;

  private autosaveTimer: number | null = null;
  private unsubscribeAutosave: (() => void) | null = null;
  private resizeHandler = () => this.fitStage();

  get currentIndex(): number {
    return this.store.getState().currentIndex;
  }

  // The <canvas> element is created imperatively (not via a JSX ref) so that a
  // StrictMode dev double-mount (init -> dispose -> init) never has to fight
  // over ownership of a single React-managed DOM node; the host div is simply
  // cleared and rebuilt.
  init(hostEl: HTMLDivElement, stageEl: HTMLDivElement): void {
    this.stageEl = stageEl;
    installTextBaselineCompatibility();
    const canvasEl = document.createElement('canvas');
    hostEl.appendChild(canvasEl);
    this.canvas = new fabric.Canvas(canvasEl, { width: this.CANVAS_W, height: this.CANVAS_H, backgroundColor: '#ffffff' });
    this.attachCanvasEvents();
    this.fitStage();
    window.addEventListener('resize', this.resizeHandler);
    this.boot();
  }

  dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.unsubscribeAutosave) this.unsubscribeAutosave();
    if (this.autosaveTimer != null) window.clearTimeout(this.autosaveTimer);
    const hostEl = (this.canvas as FabricCanvasDom | undefined)?.wrapperEl?.parentElement;
    this.canvas?.dispose();
    if (hostEl) hostEl.innerHTML = '';
  }

  // ---- boot / autosave ----

  private boot(): void {
    const restored = this.restoreAutosave();
    if (restored) {
      this.store.getState().showToast('복원됨');
      this.loadPage(0);
    } else {
      this.newPage();
    }
    this.initAutosave();
  }

  private initAutosave(): void {
    this.unsubscribeAutosave = this.store.subscribe((state, prev) => {
      if (state.pages !== prev.pages) this.scheduleAutosave();
    });
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer != null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.store.getState().pages));
      } catch {
        // QuotaExceededError or storage unavailable — skip silently
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private restoreAutosave(): boolean {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const pages = JSON.parse(raw) as PageData[];
      if (!Array.isArray(pages) || pages.length === 0) return false;
      this.store.getState().setPages(pages);
      return true;
    } catch {
      return false;
    }
  }

  // ---- canvas events ----

  private attachCanvasEvents(): void {
    const c = this.canvas;
    c.on('selection:created', () => this.updatePropsAndButtons());
    c.on('selection:updated', () => this.updatePropsAndButtons());
    c.on('selection:cleared', () => this.updatePropsAndButtons());
    c.on('object:modified', () => { clearSnapLines(this); this.updatePropsAndButtons(); this.refreshThumb(); pushHistory(this); });
    c.on('object:moving', (e) => { applySnap(this, e.target); this.updatePropsAndButtons(); });
    c.on('object:scaling', () => this.updatePropsAndButtons());
    c.on('object:rotating', () => this.updatePropsAndButtons());
    c.on('mouse:up', () => clearSnapLines(this));
    c.on('text:editing:exited', () => { pushHistory(this); this.refreshThumb(); });

    // ★ explicit dblclick handler — do not rely solely on fabric's native IText
    // dblclick-to-edit. Text -> enter editing immediately. Image -> crop mode.
    c.on('mouse:dblclick', (opt) => {
      const target = opt.target;
      if (!target || target === this.cropRect) return;
      if (target.type === 'i-text' || target.type === 'text' || target.type === 'textbox') {
        c.setActiveObject(target);
        const it = target as fabric.IText;
        it.enterEditing();
        it.selectAll();
        c.requestRenderAll();
      } else if (target.type === 'image') {
        c.setActiveObject(target);
        c.requestRenderAll();
        this.toggleCrop();
      }
    });

    (c as FabricCanvasDom).upperCanvasEl.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const target = c.findTarget(e, false);
      if (target && target !== this.cropRect) {
        c.setActiveObject(target);
        c.requestRenderAll();
        this.store.getState().showMenu(e.clientX, e.clientY, elementMenuItems(this, target));
      } else if (this.clipboard) {
        this.store.getState().showMenu(e.clientX, e.clientY, [
          { label: '붙여넣기 (Ctrl+V)', fn: () => pasteFromInternalClipboard(this) },
        ]);
      }
    });
  }

  // ---- zoom / stage fit ----

  fitStage(): void {
    const wrapperEl = (this.canvas as FabricCanvasDom)?.wrapperEl;
    if (!this.stageEl || !wrapperEl) return;
    const availW = this.stageEl.clientWidth - 40;
    const availH = this.stageEl.clientHeight - 40;
    const autoFit = Math.min(availW / this.CANVAS_W, availH / this.CANVAS_H, 1);
    const scale = this.zoomLevel != null ? this.zoomLevel : autoFit;
    const wrapper = wrapperEl;
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = 'center center';
    this.store.getState().setZoomPercent(Math.round(scale * 100));
    this.updateMiniToolbar();
  }

  setZoom(delta: number): void {
    if (!this.stageEl) return;
    const availW = this.stageEl.clientWidth - 40, availH = this.stageEl.clientHeight - 40;
    const autoFit = Math.min(availW / this.CANVAS_W, availH / this.CANVAS_H, 1);
    const current = this.zoomLevel != null ? this.zoomLevel : autoFit;
    this.zoomLevel = Math.min(3, Math.max(0.1, current + delta));
    this.fitStage();
  }

  setZoomFit(): void {
    this.zoomLevel = null;
    this.fitStage();
  }

  navigatePage(delta: number): void {
    const pages = this.store.getState().pages;
    if (pages.length === 0 || this.currentIndex < 0) return;
    const next = Math.max(0, Math.min(pages.length - 1, this.currentIndex + delta));
    if (next !== this.currentIndex) this.loadPage(next);
  }

  goToPage(index: number): void {
    const pages = this.store.getState().pages;
    if (pages.length === 0 || this.currentIndex < 0) return;
    const next = Math.max(0, Math.min(pages.length - 1, index));
    if (next !== this.currentIndex) this.loadPage(next);
  }

  // ---- mini toolbar position ----

  updateMiniToolbar(): void {
    const active = this.canvas?.getActiveObject();
    const wrapperEl = (this.canvas as FabricCanvasDom)?.wrapperEl;
    if (!active || active === this.cropRect || !wrapperEl || !this.stageEl) {
      this.store.getState().setMiniToolbar({ visible: false, left: 0, top: 0 });
      return;
    }
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const s = wrapperRect.width / this.CANVAS_W;
    const br = active.getBoundingRect(true, true);
    const screenLeft = wrapperRect.left + br.left * s;
    const screenTop = wrapperRect.top + br.top * s;
    const screenWidth = br.width * s;
    const stageTop = this.stageEl.getBoundingClientRect().top;
    this.store.getState().setMiniToolbar({
      visible: true,
      left: screenLeft + screenWidth / 2,
      top: Math.max(stageTop + 8, screenTop - 40),
    });
  }

  // ---- selection meta / revision bump ----

  updatePropsAndButtons(): void {
    const active = this.canvas.getActiveObject();
    const isCropRect = active === this.cropRect;
    this.store.getState().setSelection({ hasSelection: !!active, isCropRect, type: active ? active.type ?? null : null });
    this.updateMiniToolbar();
    this.bump();
  }

  bump(): void {
    this.store.getState().bumpRevision();
  }

  getActiveObject(): fabric.Object | null {
    return this.canvas ? this.canvas.getActiveObject() ?? null : null;
  }

  // ---- delete / crop ----

  deleteSelected(): void {
    const objs = this.canvas.getActiveObjects();
    if (this.cropTarget && objs.includes(this.cropTarget)) cancelCrop(this);
    objs.forEach((o) => { if (o !== this.cropRect) this.canvas.remove(o); });
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    pushHistory(this);
    this.refreshThumb();
  }

  toggleCrop(): void {
    if (this.cropRect) { applyCrop(this); return; }
    startCrop(this);
  }

  cancelCrop(): void {
    cancelCrop(this);
  }

  // ---- pages ----

  captureCurrentPage(): void {
    const idx = this.currentIndex;
    if (idx < 0 || !this.canvas) return;
    const active = this.canvas.getActiveObject() as fabric.IText | null;
    if (active && active.isEditing) active.exitEditing(); // never serialize mid-edit transient props

    const pages = this.store.getState().pages.slice();
    if (!pages[idx]) return;
    let thumb = pages[idx].thumb;
    try {
      thumb = this.canvas.toDataURL({ format: 'png', multiplier: 0.15 });
    } catch {
      // External images without CORS headers taint the canvas. Keep the last
      // thumbnail, but never let that optional preview block page navigation.
    }
    pages[idx] = {
      ...pages[idx],
      json: this.canvas.toJSON(['selectable', 'evented']),
      thumb,
    };
    this.store.getState().setPages(pages);
  }

  refreshThumb(): void {
    const idx = this.currentIndex;
    if (idx < 0) return;
    const pages = this.store.getState().pages.slice();
    if (!pages[idx]) return;
    let thumb = pages[idx].thumb;
    try {
      thumb = this.canvas.toDataURL({ format: 'png', multiplier: 0.15 });
    } catch {
      // See captureCurrentPage: preview generation is best effort.
    }
    pages[idx] = { ...pages[idx], thumb };
    this.store.getState().setPages(pages);
  }

  newPage(): void {
    if (this.currentIndex >= 0) this.captureCurrentPage();
    const [w, h] = this.store.getState().canvasSize.split('x').map(Number);
    const pages = this.store.getState().pages.slice();
    pages.push({ json: null, bg: null, thumb: null, w, h });
    this.store.getState().setPages(pages);
    this.loadPage(pages.length - 1);
  }

  loadPage(idx: number): void {
    if (this.currentIndex >= 0 && this.currentIndex !== idx) this.captureCurrentPage();
    this.store.getState().setCurrentIndex(idx);
    this.cropRect = null;
    this.cropTarget = null;
    this.store.getState().setCropModeActive(false);
    const p = this.store.getState().pages[idx];
    if (!p) return;

    this.CANVAS_W = p.w || 1280;
    this.CANVAS_H = p.h || 720;
    this.canvas.setWidth(this.CANVAS_W);
    this.canvas.setHeight(this.CANVAS_H);
    this.canvas.clear();
    this.canvas.backgroundColor = '#ffffff';

    // Older imported/autosaved text objects may not have Fabric's optional
    // `styles` map. Fabric 5 assumes it exists while serializing IText, so
    // normalize the persisted JSON before loading it.
    const pageJson = p.json ? {
      ...p.json,
      objects: Array.isArray((p.json as { objects?: unknown[] }).objects)
        ? ((p.json as { objects: Record<string, unknown>[] }).objects || []).map((object) => {
          if (object.type === 'i-text' || object.type === 'text' || object.type === 'textbox') {
            return { ...object, styles: object.styles || {} };
          }
          return object;
        })
        : [],
    } : null;

    const finish = () => {
      const render = () => {
        if (pageJson) {
          this.canvas.loadFromJSON(pageJson, () => {
            this.canvas.renderAll();
            this.updatePropsAndButtons();
            resetHistory(this);
            this.fitStage();
          });
        } else {
          this.canvas.renderAll();
          this.updatePropsAndButtons();
          resetHistory(this);
          this.fitStage();
        }
      };
      // Canvas text is rasterized once at render time, unlike DOM text which
      // reflows automatically when a web font finishes loading. Rendering
      // before Pretendard is ready bakes in fallback-font metrics (wrong
      // glyph widths/line breaks) permanently, which is why imported slides
      // look fine in a normal browser tab but broken on the canvas.
      void (document.fonts ? document.fonts.ready : Promise.resolve()).then(render);
    };

    if (p.json) {
      finish();
    } else if (p.bg) {
      fabric.Image.fromURL(p.bg, (img) => {
        img.set({ left: 0, top: 0, selectable: false, evented: false });
        const scale = Math.min(this.CANVAS_W / (img.width || 1), this.CANVAS_H / (img.height || 1));
        img.scale(scale);
        this.canvas.add(img);
        finish();
      });
    } else {
      finish();
    }
  }

  movePage(i: number, dir: number): void {
    const pages = this.store.getState().pages;
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    if (i === this.currentIndex) this.captureCurrentPage();
    const newPages = this.store.getState().pages.slice();
    const tmp = newPages[i]; newPages[i] = newPages[j]; newPages[j] = tmp;
    this.store.getState().setPages(newPages);
    if (this.currentIndex === i) this.store.getState().setCurrentIndex(j);
    else if (this.currentIndex === j) this.store.getState().setCurrentIndex(i);
  }

  deletePage(i: number): void {
    const pages = this.store.getState().pages.slice();
    pages.splice(i, 1);
    this.store.getState().setPages(pages);
    if (pages.length === 0) {
      this.store.getState().setCurrentIndex(-1);
      this.newPage();
      return;
    }
    const nextIdx = Math.min(i, pages.length - 1);
    this.store.getState().setCurrentIndex(-1); // force reload without trying to capture the just-deleted page
    this.loadPage(nextIdx);
  }

  duplicatePage(i: number): void {
    const pages = this.store.getState().pages;
    if (i < 0 || i >= pages.length) return;
    if (i === this.currentIndex) this.captureCurrentPage();
    const copy = JSON.parse(JSON.stringify(this.store.getState().pages[i])) as PageData;
    const newPages = this.store.getState().pages.slice();
    newPages.splice(i + 1, 0, copy);
    this.store.getState().setPages(newPages);
    this.loadPage(i + 1);
  }

  pageMenuItems(i: number): MenuItem[] {
    return [
      { label: '페이지 복사', fn: () => copyPageAt(this, i) },
      { label: '페이지 붙여넣기', disabled: !this.pageClipboard, fn: () => pastePageAfter(this, i) },
      { label: '페이지 복제', fn: () => this.duplicatePage(i) },
      { label: '페이지 삭제', fn: () => this.deletePage(i) },
    ];
  }

  // ---- keyboard / paste (document-level, bound once in useEditor) ----

  handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { this.store.getState().hideMenu(); return; }
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const active = this.canvas && this.canvas.getActiveObject();
    if (active && (active as fabric.IText).isEditing) return; // let native text-field undo/typing work

    const mod = e.metaKey || e.ctrlKey;
    const hasSelection = !!active && active !== this.cropRect;
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      if (hasSelection) duplicateSelected(this);
      else if (this.currentIndex >= 0) this.duplicatePage(this.currentIndex);
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      if (hasSelection) { e.preventDefault(); copySelected(this); }
      else if (this.currentIndex >= 0) { e.preventDefault(); copyPageAt(this, this.currentIndex); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      if (hasSelection) { e.preventDefault(); cutSelected(this); }
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(this); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(this); return; }

    // Page navigation takes priority over canvas selection. Imported decks may
    // contain a full-page background object, so requiring no selection here
    // would make the arrow shortcuts appear broken after an import.
    if (!mod) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); this.navigatePage(-1); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); this.navigatePage(1); return; }
      if (e.key === 'Home') { e.preventDefault(); this.goToPage(0); return; }
      if (e.key === 'End') { e.preventDefault(); this.goToPage(this.store.getState().pages.length - 1); return; }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && active) {
      this.deleteSelected();
    }
  };

  // paste event only — no keydown Ctrl+V handler, avoids double-paste
  handlePaste = (e: ClipboardEvent): void => {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const active = this.canvas && this.canvas.getActiveObject();
    if (active && (active as fabric.IText).isEditing) return;
    if (!this.canvas || this.currentIndex < 0) return;

    const items = (e.clipboardData && e.clipboardData.items) || ([] as unknown as DataTransferItemList);
    let imageItem: DataTransferItem | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) { imageItem = items[i]; break; }
    }

    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        if (typeof result === 'string') addImageFromDataUrl(this, result, true);
      };
      reader.readAsDataURL(file);
      return;
    }

    if (this.clipboard) {
      e.preventDefault();
      pasteFromInternalClipboard(this);
      return;
    }

    if (this.pageClipboard) {
      e.preventDefault();
      pastePageAfter(this, this.currentIndex);
      return;
    }

    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      const t = new fabric.IText(text, {
        left: 0, top: 0, fontSize: 36, fontFamily: "'Pretendard', sans-serif", fill: '#1f1f1f',
      });
      this.canvas.add(t);
      t.set({ left: this.CANVAS_W / 2 - t.getScaledWidth() / 2, top: this.CANVAS_H / 2 - t.getScaledHeight() / 2 });
      t.setCoords();
      this.canvas.setActiveObject(t);
      this.canvas.requestRenderAll();
      pushHistory(this);
      this.refreshThumb();
    }
  };

  // ---- server: deck import / save ----

  async importDeckFile(file: File): Promise<void> {
    try {
      const html = await file.text();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const data = await res.json() as { error?: string; pages?: ImportedPage[] };
      if (data.error) throw new Error(data.error);
      // Picking a deck means opening that deck. Replacing the current pages
      // prevents stale autosave pages or a previous deck from appearing before
      // the selected file and making the editor differ from the source HTML.
      const newPages = (data.pages || []).map((page) => ({
        json: page.json,
        bg: page.bg,
        thumb: page.thumb,
        w: page.w || 1280,
        h: page.h || 720,
      }));
      if (newPages.length === 0) throw new Error('가져온 슬라이드가 없습니다');
      this.store.getState().setPages(newPages);
      this.loadPage(0);
      const base = file.name.replace(/\.html$/i, '');
      this.store.getState().setSaveName(base + '-edited.html');
    } catch (e) {
      this.store.getState().showToast('가져오기 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async save(file: string): Promise<void> {
    // A blank filename used to just show a toast and silently no-op, which
    // looked like "저장을 눌러도 반영이 안 됨" when the field was never
    // filled in (e.g. starting from a blank page instead of an import).
    // Fall back to a default so the button always actually writes a file.
    const name = file || `slide-${new Date().toISOString().slice(0, 10)}.html`;
    if (name !== file) this.store.getState().setSaveName(name);
    this.captureCurrentPage();
    const html = buildExportHtml(this.store.getState().pages);
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: name, html }),
      });
      const data = await res.json();
      if (data.error) this.store.getState().showToast('저장 실패: ' + data.error);
      else this.store.getState().showToast('저장됨: ' + data.path);
    } catch (e) {
      this.store.getState().showToast('저장 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
}
