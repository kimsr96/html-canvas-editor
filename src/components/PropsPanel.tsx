import type { ReactNode } from 'react';
import type { fabric } from 'fabric';
import type { EditorEngine } from '../editor/engine';
import { useEditorStore } from '../store/editorStore';
import { alignCenterH, alignCenterV, orderFront, orderForward, orderBack, orderBackward } from '../editor/canvasOps';
import { pushHistory } from '../editor/history';

const FONT_OPTIONS: [string, string][] = [
  ["'Pretendard', sans-serif", 'Pretendard'],
  ['-apple-system, sans-serif', '시스템'],
  ['serif', '명조'],
  ["'Courier New', monospace", '고정폭'],
];

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function isTextType(t?: string): boolean {
  return t === 'i-text' || t === 'text' || t === 'textbox';
}

export default function PropsPanel({ engine }: { engine: EditorEngine }) {
  // revision is bumped whenever the active object's live props change from
  // outside this panel (selection change, canvas drag/scale/rotate, toggle
  // buttons below) — subscribing forces a fresh read of engine.getActiveObject().
  const revision = useEditorStore((s) => s.revision);
  const selection = useEditorStore((s) => s.selection);
  const currentIndex = useEditorStore((s) => s.currentIndex);

  const obj = engine.getActiveObject();

  // note: the reference renderProps(active) renders position/align/order controls
  // even when active === cropRect (lets you numerically nudge the crop rect too).
  if (!obj || !selection.hasSelection) {
    return (
      <div id="props">
        <div className="hint">요소를 선택하세요</div>
      </div>
    );
  }

  const textObj = obj as fabric.IText;
  const isText = isTextType(obj.type);

  // matches numInput()/colorInput() in the reference: mutate the fabric object
  // and re-render the canvas only — no history push, no panel rebuild, so the
  // input keeps focus/cursor while the user types.
  const rerenderOnly = () => engine.canvas.requestRenderAll();

  // matches toggleBtn()/alignGroup buttons/fontSelect.onchange: commit history +
  // refresh the thumbnail; toggle/align buttons additionally rebuild the panel.
  const commit = (rebuild: boolean) => {
    engine.canvas.requestRenderAll();
    pushHistory(engine);
    engine.refreshThumb();
    if (rebuild) engine.bump();
  };

  return (
    <div id="props" key={`${currentIndex}-${revision}`}>
      <PropRow label="X">
        <input
          type="number"
          defaultValue={Math.round(obj.left ?? 0)}
          onInput={(e) => { obj.set('left', Number((e.target as HTMLInputElement).value)); rerenderOnly(); }}
        />
      </PropRow>
      <PropRow label="Y">
        <input
          type="number"
          defaultValue={Math.round(obj.top ?? 0)}
          onInput={(e) => { obj.set('top', Number((e.target as HTMLInputElement).value)); rerenderOnly(); }}
        />
      </PropRow>
      <PropRow label="W">
        <input
          type="number"
          defaultValue={Math.round(obj.getScaledWidth())}
          onInput={(e) => { obj.set('scaleX', Number((e.target as HTMLInputElement).value) / (obj.width || 1)); rerenderOnly(); }}
        />
      </PropRow>
      <PropRow label="H">
        <input
          type="number"
          defaultValue={Math.round(obj.getScaledHeight())}
          onInput={(e) => { obj.set('scaleY', Number((e.target as HTMLInputElement).value) / (obj.height || 1)); rerenderOnly(); }}
        />
      </PropRow>
      <PropRow label="회전°">
        <input
          type="number"
          defaultValue={Math.round(obj.angle || 0)}
          onInput={(e) => { obj.set('angle', Number((e.target as HTMLInputElement).value)); rerenderOnly(); }}
        />
      </PropRow>

      {isText && (
        <>
          <PropRow label="글자크기">
            <input
              type="number"
              defaultValue={Math.round(textObj.fontSize || 36)}
              onInput={(e) => { textObj.set('fontSize', Number((e.target as HTMLInputElement).value)); rerenderOnly(); }}
            />
          </PropRow>
          <PropRow label="색상">
            <input
              type="color"
              defaultValue={typeof textObj.fill === 'string' && /^#/.test(textObj.fill) ? textObj.fill : '#1f1f1f'}
              onInput={(e) => { textObj.set('fill', (e.target as HTMLInputElement).value); rerenderOnly(); }}
            />
          </PropRow>
          <PropRow label="폰트">
            <select
              defaultValue={textObj.fontFamily}
              onChange={(e) => { textObj.set('fontFamily', e.target.value); commit(false); }}
            >
              {FONT_OPTIONS.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </PropRow>
          <PropRow label="스타일">
            <div className="btn-group">
              <button
                className={textObj.fontWeight === 'bold' ? 'on' : undefined}
                title="굵게"
                onClick={() => { textObj.set('fontWeight', textObj.fontWeight === 'bold' ? 'normal' : 'bold'); commit(true); }}
              >
                B
              </button>
              <button
                className={textObj.fontStyle === 'italic' ? 'on' : undefined}
                title="기울임"
                onClick={() => { textObj.set('fontStyle', textObj.fontStyle === 'italic' ? 'normal' : 'italic'); commit(true); }}
              >
                I
              </button>
              <button
                className={textObj.underline ? 'on' : undefined}
                title="밑줄"
                onClick={() => { textObj.set('underline', !textObj.underline); commit(true); }}
              >
                U
              </button>
            </div>
          </PropRow>
          <PropRow label="정렬">
            <div className="btn-group">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  className={textObj.textAlign === align ? 'on' : undefined}
                  onClick={() => { textObj.set('textAlign', align); commit(true); }}
                >
                  {align === 'left' ? '왼쪽' : align === 'center' ? '가운데' : '오른쪽'}
                </button>
              ))}
            </div>
          </PropRow>
        </>
      )}

      <div className="group-label">정렬</div>
      <div className="btn-group">
        <button title="가로 중앙정렬" onClick={() => alignCenterH(engine, obj)}>↔</button>
        <button title="세로 중앙정렬" onClick={() => alignCenterV(engine, obj)}>↕</button>
      </div>
      <div className="group-label">순서</div>
      <div className="btn-group">
        <button title="맨 앞으로" onClick={() => orderFront(engine, obj)}>⤒</button>
        <button title="앞으로" onClick={() => orderForward(engine, obj)}>↑</button>
        <button title="뒤로" onClick={() => orderBackward(engine, obj)}>↓</button>
        <button title="맨 뒤로" onClick={() => orderBack(engine, obj)}>⤓</button>
      </div>
    </div>
  );
}
