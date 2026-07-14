import { useState, type ChangeEvent } from 'react';
import type { EditorEngine } from '../editor/engine';
import { useEditorStore } from '../store/editorStore';
import { CANVAS_SIZE_OPTIONS } from '../types';
import { addText, addImageFromFile, duplicateSelected } from '../editor/canvasOps';
import { undo, redo } from '../editor/history';

export default function Toolbar({ engine }: { engine: EditorEngine }) {
  const decks = useEditorStore((s) => s.decks);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const setCanvasSize = useEditorStore((s) => s.setCanvasSize);
  const saveName = useEditorStore((s) => s.saveName);
  const setSaveName = useEditorStore((s) => s.setSaveName);
  const selection = useEditorStore((s) => s.selection);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const cropModeActive = useEditorStore((s) => s.cropModeActive);

  const [deckFile, setDeckFile] = useState('');
  const [importing, setImporting] = useState(false);

  const btnCropDisabled = selection.type !== 'image' && !selection.isCropRect;

  const onImport = async () => {
    setImporting(true);
    await engine.importDeck(deckFile);
    setImporting(false);
  };

  const onDeckChange = async (file: string) => {
    setDeckFile(file);
    if (!file || importing) return;
    setImporting(true);
    await engine.importDeck(file);
    setImporting(false);
  };

  const onFileImg = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImageFromFile(engine, file);
    e.target.value = '';
  };

  return (
    <div id="toolbar">
      <select value={deckFile} disabled={importing} onChange={(e) => void onDeckChange(e.target.value)}>
        <option value="">덱 선택…</option>
        {decks.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <button onClick={onImport} disabled={importing}>{importing ? '불러오는 중…' : '가져오기'}</button>
      <select
        value={canvasSize}
        onChange={(e) => setCanvasSize(e.target.value)}
        title="캔버스 사이즈 (다음에 만들 페이지부터 적용)"
      >
        {CANVAS_SIZE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button onClick={() => engine.newPage()}>+ 새 페이지</button>
      <button onClick={() => addText(engine)}>+ 텍스트</button>
      <label className="btn" htmlFor="fileImg">+ 이미지</label>
      <input type="file" id="fileImg" accept="image/*" hidden onChange={onFileImg} />
      <button disabled={btnCropDisabled} onClick={() => engine.toggleCrop()}>
        {cropModeActive ? '자르기 적용' : '자르기'}
      </button>
      <button
        disabled={!selection.hasSelection || selection.isCropRect}
        title="복제 (Ctrl+D)"
        onClick={() => duplicateSelected(engine)}
      >
        복제
      </button>
      <button disabled={!selection.hasSelection} onClick={() => engine.deleteSelected()}>삭제</button>
      <span className="sep" />
      <button id="btnUndo" disabled={!canUndo} title="실행취소 (Ctrl+Z)" onClick={() => undo(engine)}>↶</button>
      <button id="btnRedo" disabled={!canRedo} title="다시실행 (Ctrl+Shift+Z)" onClick={() => redo(engine)}>↷</button>
      <span className="spacer" />
      <input
        type="text"
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        placeholder="저장할 파일명 (예: my-deck.html)"
      />
      <button id="btnSave" onClick={() => engine.save(saveName.trim())}>저장</button>
    </div>
  );
}
