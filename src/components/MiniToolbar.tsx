import type { MouseEvent } from 'react';
import type { EditorEngine } from '../editor/engine';
import { useEditorStore } from '../store/editorStore';
import { duplicateSelected, elementMenuItems } from '../editor/canvasOps';

export default function MiniToolbar({ engine }: { engine: EditorEngine }) {
  const pos = useEditorStore((s) => s.miniToolbar);
  const showMenu = useEditorStore((s) => s.showMenu);

  const onMore = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const active = engine.getActiveObject();
    if (!active || active === engine.cropRect) return;
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, elementMenuItems(engine, active));
  };

  return (
    <div id="miniToolbar" hidden={!pos.visible} style={{ left: pos.left, top: pos.top }}>
      <button title="복제 (Ctrl+D)" onClick={() => duplicateSelected(engine)}>⧉</button>
      <button title="삭제" onClick={() => engine.deleteSelected()}>🗑</button>
      <button title="더보기" onClick={onMore}>⋯</button>
    </div>
  );
}
