import type { EditorEngine } from './engine';

// ---- undo / redo (per-page snapshot stack, reset on page switch, capped at 50) ----

export function pushHistory(engine: EditorEngine): void {
  if (!engine.canvas) return;
  const json = JSON.stringify(engine.canvas.toJSON(['selectable', 'evented']));
  if (engine.history[engine.historyIndex] === json) return; // skip no-op snapshots (e.g. editing exited without changes)
  engine.history = engine.history.slice(0, engine.historyIndex + 1);
  engine.history.push(json);
  if (engine.history.length > 50) engine.history.shift();
  engine.historyIndex = engine.history.length - 1;
  updateUndoRedoButtons(engine);
}

export function resetHistory(engine: EditorEngine): void {
  engine.history = [];
  engine.historyIndex = -1;
  pushHistory(engine);
}

export function updateUndoRedoButtons(engine: EditorEngine): void {
  engine.store.getState().setUndoRedo(engine.historyIndex > 0, engine.historyIndex < engine.history.length - 1);
}

export function undo(engine: EditorEngine): void {
  if (engine.historyIndex <= 0) return;
  engine.historyIndex--;
  engine.canvas.loadFromJSON(JSON.parse(engine.history[engine.historyIndex]), () => {
    engine.canvas.renderAll();
    engine.updatePropsAndButtons();
    engine.refreshThumb();
    updateUndoRedoButtons(engine);
  });
}

export function redo(engine: EditorEngine): void {
  if (engine.historyIndex >= engine.history.length - 1) return;
  engine.historyIndex++;
  engine.canvas.loadFromJSON(JSON.parse(engine.history[engine.historyIndex]), () => {
    engine.canvas.renderAll();
    engine.updatePropsAndButtons();
    engine.refreshThumb();
    updateUndoRedoButtons(engine);
  });
}
