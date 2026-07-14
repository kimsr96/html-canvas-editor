import { fabric } from 'fabric';
import type { EditorEngine } from './engine';

// ---- snap guides (canvas center / edges) ----
export const SNAP_PX = 6;

export function clearSnapLines(engine: EditorEngine): void {
  engine.snapLines.forEach((l) => engine.canvas.remove(l));
  engine.snapLines = [];
}

function addSnapLine(engine: EditorEngine, coords: [number, number, number, number]): void {
  const line = new fabric.Line(coords, {
    stroke: '#ff4757', strokeWidth: 1, selectable: false, evented: false, excludeFromExport: true,
  });
  engine.canvas.add(line);
  engine.snapLines.push(line);
}

export function applySnap(engine: EditorEngine, obj: fabric.Object | undefined): void {
  if (!obj || obj === engine.cropRect) return;
  clearSnapLines(engine);
  const w = obj.getScaledWidth(), h = obj.getScaledHeight();
  const left = obj.left ?? 0, top = obj.top ?? 0;
  const cx = left + w / 2, cy = top + h / 2;
  const { CANVAS_W, CANVAS_H } = engine;
  const canvasCX = CANVAS_W / 2, canvasCY = CANVAS_H / 2;

  if (Math.abs(cx - canvasCX) < SNAP_PX) {
    obj.set('left', canvasCX - w / 2);
    addSnapLine(engine, [canvasCX, 0, canvasCX, CANVAS_H]);
  }
  if (Math.abs(cy - canvasCY) < SNAP_PX) {
    obj.set('top', canvasCY - h / 2);
    addSnapLine(engine, [0, canvasCY, CANVAS_W, canvasCY]);
  }
  const l = obj.left ?? 0, t = obj.top ?? 0;
  if (Math.abs(l) < SNAP_PX) { obj.set('left', 0); addSnapLine(engine, [0, 0, 0, CANVAS_H]); }
  if (Math.abs(l + w - CANVAS_W) < SNAP_PX) { obj.set('left', CANVAS_W - w); addSnapLine(engine, [CANVAS_W, 0, CANVAS_W, CANVAS_H]); }
  if (Math.abs(t) < SNAP_PX) { obj.set('top', 0); addSnapLine(engine, [0, 0, CANVAS_W, 0]); }
  if (Math.abs(t + h - CANVAS_H) < SNAP_PX) { obj.set('top', CANVAS_H - h); addSnapLine(engine, [0, CANVAS_H, CANVAS_W, CANVAS_H]); }
  obj.setCoords();
}
