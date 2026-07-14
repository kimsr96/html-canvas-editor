import { useEffect, useRef, type RefObject } from 'react';
import { EditorEngine } from './engine';

// fabric.Canvas lifecycle hook: creates the engine once, mounts the canvas into
// `hostRef` on mount, binds document-level keydown/paste handlers, and disposes
// cleanly on unmount (safe for React StrictMode's mount/cleanup/mount cycle).
export function useEditor(hostRef: RefObject<HTMLDivElement>, stageRef: RefObject<HTMLDivElement>): EditorEngine {
  const engineRef = useRef<EditorEngine | null>(null);
  if (!engineRef.current) engineRef.current = new EditorEngine();
  const engine = engineRef.current;
  (window as unknown as { __editor: EditorEngine }).__editor = engine; // e2e/debug hook

  useEffect(() => {
    if (!hostRef.current || !stageRef.current) return;
    engine.init(hostRef.current, stageRef.current);
    document.addEventListener('keydown', engine.handleKeydown);
    document.addEventListener('paste', engine.handlePaste);
    return () => {
      document.removeEventListener('keydown', engine.handleKeydown);
      document.removeEventListener('paste', engine.handlePaste);
      engine.dispose();
    };
    // mount/unmount only — engine identity is stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}
