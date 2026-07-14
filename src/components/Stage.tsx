import type { RefObject } from 'react';
import type { EditorEngine } from '../editor/engine';
import { useEditorStore } from '../store/editorStore';
import MiniToolbar from './MiniToolbar';

interface StageProps {
  engine: EditorEngine;
  hostRef: RefObject<HTMLDivElement>;
  stageRef: RefObject<HTMLDivElement>;
}

export default function Stage({ engine, hostRef, stageRef }: StageProps) {
  const zoomPercent = useEditorStore((s) => s.zoomPercent);

  return (
    <div id="stage" ref={stageRef} onScroll={() => engine.updateMiniToolbar()}>
      <div ref={hostRef} />
      <MiniToolbar engine={engine} />
      <div id="zoomControls">
        <button id="zoomOut" title="축소" onClick={() => engine.setZoom(-0.1)}>−</button>
        <span id="zoomLabel">{zoomPercent}%</span>
        <button id="zoomIn" title="확대" onClick={() => engine.setZoom(0.1)}>+</button>
        <button id="zoomFit" title="화면에 맞추기" onClick={() => engine.setZoomFit()}>맞춤</button>
      </div>
    </div>
  );
}
