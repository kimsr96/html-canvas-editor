// Pages model: each page = { json: fabric-canvas-json|null, bg: dataURL|null, thumb: dataURL|null, w, h }
export interface PageData {
  json: Record<string, unknown> | null;
  bg: string | null;
  thumb: string | null;
  w: number;
  h: number;
}

export type ImportedPage = PageData;

export interface MenuItem {
  label: string;
  disabled?: boolean;
  fn?: () => void;
}

export const CANVAS_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '1280x720', label: '1280×720 · 프레젠테이션' },
  { value: '1080x1080', label: '1080×1080 · 카드뉴스' },
  { value: '1080x1920', label: '1080×1920 · 쇼츠/스토리' },
  { value: '1920x1080', label: '1920×1080 · 유튜브' },
];
