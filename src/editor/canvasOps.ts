import { fabric } from 'fabric';
import type { EditorEngine } from './engine';
import { pushHistory } from './history';
import type { MenuItem } from '../types';
import { copySelected, pasteFromInternalClipboard } from './clipboard';

// ---- duplicate ----

export function duplicateSelected(engine: EditorEngine): void {
  const active = engine.canvas.getActiveObject();
  if (!active || active === engine.cropRect) return;
  active.clone((cloned: fabric.Object) => {
    cloned.set({ left: (active.left || 0) + 24, top: (active.top || 0) + 24 });
    engine.canvas.add(cloned);
    engine.canvas.setActiveObject(cloned);
    engine.canvas.requestRenderAll();
    pushHistory(engine);
    engine.refreshThumb();
  });
}

// ---- alignment (relative to canvas) ----

export function alignCenterH(engine: EditorEngine, obj: fabric.Object): void {
  obj.set('left', engine.CANVAS_W / 2 - obj.getScaledWidth() / 2);
  obj.setCoords();
  engine.canvas.requestRenderAll();
  pushHistory(engine);
  engine.refreshThumb();
  engine.bump();
}

export function alignCenterV(engine: EditorEngine, obj: fabric.Object): void {
  obj.set('top', engine.CANVAS_H / 2 - obj.getScaledHeight() / 2);
  obj.setCoords();
  engine.canvas.requestRenderAll();
  pushHistory(engine);
  engine.refreshThumb();
  engine.bump();
}

// ---- z-order (keeps a locked imported background, if any, always at the back) ----

export function bgLockOffset(engine: EditorEngine): number {
  const objs = engine.canvas.getObjects();
  return objs.length && objs[0].evented === false && objs[0].selectable === false ? 1 : 0;
}

export function orderFront(engine: EditorEngine, obj: fabric.Object): void { engine.canvas.bringToFront(obj); afterOrderChange(engine); }
export function orderForward(engine: EditorEngine, obj: fabric.Object): void { engine.canvas.bringForward(obj); afterOrderChange(engine); }
export function orderBack(engine: EditorEngine, obj: fabric.Object): void {
  const offset = bgLockOffset(engine);
  engine.canvas.moveTo(obj, offset);
  afterOrderChange(engine);
}
export function orderBackward(engine: EditorEngine, obj: fabric.Object): void {
  const offset = bgLockOffset(engine);
  const idx = engine.canvas.getObjects().indexOf(obj);
  if (idx > offset) engine.canvas.moveTo(obj, idx - 1);
  afterOrderChange(engine);
}
function afterOrderChange(engine: EditorEngine): void {
  engine.canvas.requestRenderAll();
  pushHistory(engine);
  engine.refreshThumb();
  engine.bump();
}

// ---- element context menu (canvas right-click + mini toolbar "more") ----

export function elementMenuItems(engine: EditorEngine, obj: fabric.Object): MenuItem[] {
  return [
    { label: '복사 (Ctrl+C)', fn: () => copySelected(engine) },
    { label: '붙여넣기 (Ctrl+V)', disabled: !engine.clipboard, fn: () => pasteFromInternalClipboard(engine) },
    { label: '복제 (Ctrl+D)', fn: () => duplicateSelected(engine) },
    { label: '삭제 (Delete)', fn: () => engine.deleteSelected() },
    { label: '맨 앞으로', fn: () => orderFront(engine, obj) },
    { label: '맨 뒤로', fn: () => orderBack(engine, obj) },
  ];
}

// ---- add text / image ----

export function addText(engine: EditorEngine): void {
  const t = new fabric.IText('텍스트를 입력하세요', {
    left: 0, top: 0, fontSize: 36, fontFamily: "'Pretendard', sans-serif", fill: '#1f1f1f',
  });
  engine.canvas.add(t);
  t.set({ left: engine.CANVAS_W / 2 - t.getScaledWidth() / 2, top: engine.CANVAS_H / 2 - t.getScaledHeight() / 2 });
  t.setCoords();
  engine.canvas.setActiveObject(t);
  engine.canvas.requestRenderAll();
  pushHistory(engine); // snapshot before enterEditing — editing mutates transient props (selectable:false)
  t.enterEditing();
  t.selectAll();
  engine.refreshThumb();
}

export function addImageFromDataUrl(engine: EditorEngine, dataUrl: string, center = false): void {
  fabric.Image.fromURL(dataUrl, (img) => {
    if ((img.width || 0) > 700) img.scaleToWidth(700);
    if (center) {
      img.set({ left: engine.CANVAS_W / 2 - img.getScaledWidth() / 2, top: engine.CANVAS_H / 2 - img.getScaledHeight() / 2 });
    } else {
      img.set({ left: 150, top: 100 });
    }
    engine.canvas.add(img);
    engine.canvas.setActiveObject(img);
    engine.canvas.requestRenderAll();
    pushHistory(engine);
    engine.refreshThumb();
  });
}

export function addImageFromFile(engine: EditorEngine, file: File): void {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const result = ev.target?.result;
    if (typeof result === 'string') addImageFromDataUrl(engine, result, false);
  };
  reader.readAsDataURL(file);
}

// ---- crop ----

export function startCrop(engine: EditorEngine): void {
  const active = engine.canvas.getActiveObject();
  if (!active || active.type !== 'image') return;
  engine.cropTarget = active as fabric.Image;
  const b = active.getBoundingRect();
  const cropRect = new fabric.Rect({
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
    excludeFromExport: true, // crop overlay must never be serialized (history/autosave/export)
  });
  engine.cropRect = cropRect;
  engine.canvas.add(cropRect);
  engine.canvas.setActiveObject(cropRect);
  engine.canvas.requestRenderAll();
  engine.store.getState().setCropModeActive(true);
}

export function cancelCrop(engine: EditorEngine): void {
  if (engine.cropRect) engine.canvas.remove(engine.cropRect);
  engine.cropRect = null;
  engine.cropTarget = null;
  engine.store.getState().setCropModeActive(false);
}

export function applyCrop(engine: EditorEngine): void {
  const cropRect = engine.cropRect;
  const cropTarget = engine.cropTarget;
  if (!cropRect || !cropTarget) return;
  const imgEl = cropTarget.getElement() as CanvasImageSource;
  const bounds = cropTarget.getBoundingRect();
  const scaleX = cropTarget.scaleX || 1, scaleY = cropTarget.scaleY || 1;
  const relLeft = ((cropRect.left || 0) - bounds.left) / scaleX;
  const relTop = ((cropRect.top || 0) - bounds.top) / scaleY;
  const relW = (cropRect.width! * (cropRect.scaleX || 1)) / scaleX;
  const relH = (cropRect.height! * (cropRect.scaleY || 1)) / scaleY;

  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(relW));
  off.height = Math.max(1, Math.round(relH));
  const ctx = off.getContext('2d')!;
  ctx.drawImage(imgEl, relLeft, relTop, relW, relH, 0, 0, off.width, off.height);
  const newSrc = off.toDataURL('image/png');

  const newLeft = cropRect.left, newTop = cropRect.top, angle = cropTarget.angle;
  const targetW = cropRect.width! * (cropRect.scaleX || 1), targetH = cropRect.height! * (cropRect.scaleY || 1);

  fabric.Image.fromURL(newSrc, (img) => {
    img.set({ left: newLeft, top: newTop, angle });
    img.scaleToWidth(targetW);
    if (img.getScaledHeight() !== targetH) img.set('scaleY', targetH / img.height!);
    engine.canvas.remove(cropTarget);
    engine.canvas.remove(cropRect);
    engine.canvas.add(img);
    engine.canvas.setActiveObject(img);
    engine.cropRect = null;
    engine.cropTarget = null;
    engine.store.getState().setCropModeActive(false);
    engine.canvas.requestRenderAll();
    pushHistory(engine);
    engine.refreshThumb();
  });
}
