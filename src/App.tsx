import { useRef } from 'react';
import { useEditor } from './editor/useEditor';
import Toolbar from './components/Toolbar';
import Stage from './components/Stage';
import PropsPanel from './components/PropsPanel';
import PagesStrip from './components/PagesStrip';
import ContextMenu from './components/ContextMenu';
import Toast from './components/Toast';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engine = useEditor(hostRef, stageRef);

  return (
    <>
      <Toolbar engine={engine} />
      <div id="main">
        <div id="workspace">
          <Stage engine={engine} hostRef={hostRef} stageRef={stageRef} />
          <PropsPanel engine={engine} />
        </div>
        <PagesStrip engine={engine} />
      </div>
      <ContextMenu />
      <Toast />
    </>
  );
}
