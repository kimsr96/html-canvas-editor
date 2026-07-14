import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

export default function ContextMenu() {
  const menu = useEditorStore((s) => s.menu);
  const hideMenu = useEditorStore((s) => s.hideMenu);

  useEffect(() => {
    if (!menu) return;
    const onDocClick = (e: MouseEvent) => {
      const el = document.getElementById('ctxMenu');
      if (el && !el.contains(e.target as Node)) hideMenu();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menu, hideMenu]);

  return (
    <div id="ctxMenu" hidden={!menu} style={menu ? { left: menu.x, top: menu.y } : undefined}>
      {menu?.items.map((item, i) => (
        <button
          key={i}
          disabled={!!item.disabled}
          onClick={(e) => {
            e.stopPropagation();
            hideMenu();
            if (!item.disabled && item.fn) item.fn();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
