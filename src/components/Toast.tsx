import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

export default function Toast() {
  const toast = useEditorStore((s) => s.toast);
  const hideToast = useEditorStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => hideToast(), 2600);
    return () => window.clearTimeout(t);
  }, [toast, hideToast]);

  if (!toast) return null;
  return <div id="toast">{toast.message}</div>;
}
