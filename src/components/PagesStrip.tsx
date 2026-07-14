import { useEffect, type MouseEvent } from 'react';
import type { EditorEngine } from '../editor/engine';
import { useEditorStore } from '../store/editorStore';

export default function PagesStrip({ engine }: { engine: EditorEngine }) {
  const pages = useEditorStore((s) => s.pages);
  const currentIndex = useEditorStore((s) => s.currentIndex);
  const showMenu = useEditorStore((s) => s.showMenu);

  useEffect(() => {
    const activeThumb = document.querySelector<HTMLElement>('#pages .thumb.active');
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex, pages.length]);

  return (
    <div id="pages">
      {pages.map((p, i) => (
        <div
          key={i}
          className={'thumb' + (i === currentIndex ? ' active' : '')}
          onClick={() => engine.loadPage(i)}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            showMenu(e.clientX, e.clientY, engine.pageMenuItems(i));
          }}
        >
          {p.thumb && <img src={p.thumb} alt={`page ${i + 1}`} />}
          <div className="thumb-label">{i + 1}</div>
          <button title="이전으로" onClick={(e) => { e.stopPropagation(); engine.movePage(i, -1); }}>◀</button>
          <button title="다음으로" onClick={(e) => { e.stopPropagation(); engine.movePage(i, 1); }}>▶</button>
          <button title="페이지 복제 (Ctrl+D)" onClick={(e) => { e.stopPropagation(); engine.duplicatePage(i); }}>⧉</button>
          <button title="삭제" onClick={(e) => { e.stopPropagation(); engine.deletePage(i); }}>✕</button>
        </div>
      ))}
    </div>
  );
}
