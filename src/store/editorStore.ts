import { create } from 'zustand';
import type { MenuItem, PageData } from '../types';

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface SelectionMeta {
  hasSelection: boolean;
  isCropRect: boolean;
  type: string | null;
}

interface MiniToolbarPos {
  visible: boolean;
  left: number;
  top: number;
}

interface EditorState {
  // pages
  pages: PageData[];
  currentIndex: number;

  // zoom (display only; the authoritative zoomLevel lives in the engine)
  zoomPercent: number;

  // toolbar controls
  canvasSize: string;
  saveName: string;

  // selection / button-enable meta mirrored from fabric (meta only, not full props)
  selection: SelectionMeta;
  canUndo: boolean;
  canRedo: boolean;
  cropModeActive: boolean;

  // bumped whenever the active object's live props change, so panels that read
  // straight from the fabric object know to re-render without storing every prop
  revision: number;

  miniToolbar: MiniToolbarPos;
  menu: MenuState | null;
  toast: { id: number; message: string } | null;

  setPages: (pages: PageData[]) => void;
  setCurrentIndex: (i: number) => void;
  setZoomPercent: (p: number) => void;
  setCanvasSize: (s: string) => void;
  setSaveName: (s: string) => void;
  setSelection: (s: SelectionMeta) => void;
  setUndoRedo: (canUndo: boolean, canRedo: boolean) => void;
  setCropModeActive: (v: boolean) => void;
  bumpRevision: () => void;
  setMiniToolbar: (pos: MiniToolbarPos) => void;
  showMenu: (x: number, y: number, items: MenuItem[]) => void;
  hideMenu: () => void;
  showToast: (message: string) => void;
  hideToast: () => void;
}

let toastId = 0;

export const useEditorStore = create<EditorState>((set, get) => ({
  pages: [],
  currentIndex: -1,
  zoomPercent: 100,
  canvasSize: '1280x720',
  saveName: '',
  selection: { hasSelection: false, isCropRect: false, type: null },
  canUndo: false,
  canRedo: false,
  cropModeActive: false,
  revision: 0,
  miniToolbar: { visible: false, left: 0, top: 0 },
  menu: null,
  toast: null,

  setPages: (pages) => set({ pages }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setZoomPercent: (p) => {
    if (get().zoomPercent !== p) set({ zoomPercent: p });
  },
  setCanvasSize: (s) => set({ canvasSize: s }),
  setSaveName: (s) => set({ saveName: s }),
  setSelection: (s) => {
    const cur = get().selection;
    if (cur.hasSelection !== s.hasSelection || cur.isCropRect !== s.isCropRect || cur.type !== s.type) {
      set({ selection: s });
    }
  },
  setUndoRedo: (canUndo, canRedo) => {
    const s = get();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) set({ canUndo, canRedo });
  },
  setCropModeActive: (v) => {
    if (get().cropModeActive !== v) set({ cropModeActive: v });
  },
  bumpRevision: () => set((s) => ({ revision: s.revision + 1 })),
  setMiniToolbar: (pos) => {
    const cur = get().miniToolbar;
    if (cur.visible !== pos.visible || cur.left !== pos.left || cur.top !== pos.top) {
      set({ miniToolbar: pos });
    }
  },
  showMenu: (x, y, items) => set({ menu: { x, y, items } }),
  hideMenu: () => set({ menu: null }),
  showToast: (message) => set({ toast: { id: ++toastId, message } }),
  hideToast: () => set({ toast: null }),
}));
