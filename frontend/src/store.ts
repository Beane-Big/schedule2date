// 页面状态，以及它和后端保存的班表文档之间的转换。班表只在后端保存最新一份，所有人看到的是同一份。
import type { ImageOptions, Styles } from "./render";
import type { Shift } from "./schedule";

export type Format = "jpeg" | "png";

export type SizePreset = { id: string; label: string; width: number; height: number };

// 默认是手机竖屏 9:16，发朋友圈、设壁纸、存相册都合适。
export const sizePresets: SizePreset[] = [
  { id: "phone", label: "手机竖屏 9:16（1080×1920）", width: 1080, height: 1920 },
  { id: "iphone", label: "iPhone 全面屏（1179×2556）", width: 1179, height: 2556 },
  { id: "photo34", label: "照片竖版 3:4（1080×1440）", width: 1080, height: 1440 },
  { id: "photo43", label: "照片横版 4:3（1440×1080）", width: 1440, height: 1080 },
  { id: "square", label: "方图 1:1（1080×1080）", width: 1080, height: 1080 },
];

// 手机浏览器能画的最大画布有限（iOS 约 1600 万像素），超过时导出会是空白图。
export const minSide = 320;
export const maxSide = 4096;
export const maxPixels = 16_000_000;

export type State = {
  shifts: Shift[];
  yearless: boolean;
  fileName: string;
  month: string; // 当前显示的月份 YYYY-MM，只在本页面里用，不保存
  styles: Styles;
  image: Omit<ImageOptions, "title">;
  title: string; // 空表示用默认标题“2026年10月排班表”
  preset: string; // sizePresets 的 id，自己填尺寸时是 custom
  format: Format;
};

export const initialState: State = {
  shifts: [],
  yearless: false,
  fileName: "",
  month: "",
  styles: { byShift: {}, byDate: {} },
  image: {
    width: 1080,
    height: 1920,
    theme: "light",
    weekStart: 1,
    showTime: true,
    showNote: false,
    showLegend: true,
    showStats: true,
  },
  title: "",
  preset: "phone",
  format: "jpeg",
};

// 后端保存的文档：班次由后端检查格式，settings 原样保存。
export type Doc = {
  shifts: Shift[];
  yearless: boolean;
  fileName: string;
  settings: Pick<State, "styles" | "image" | "title" | "preset" | "format">;
};

// 班次名被清空的记录（正在编辑中）不保存。
export function toDoc(s: State): Doc {
  return {
    shifts: s.shifts.filter((x) => x.name.trim()),
    yearless: s.yearless,
    fileName: s.fileName,
    settings: { styles: s.styles, image: s.image, title: s.title, preset: s.preset, format: s.format },
  };
}

// 和默认值合并，以后加了新选项时老数据也能用。还没有班表时返回默认状态。
export function fromDoc(doc: Doc | null): State {
  if (!doc) return initialState;
  const st: Partial<Doc["settings"]> = doc.settings ?? {};
  return {
    ...initialState,
    shifts: doc.shifts ?? [],
    yearless: !!doc.yearless,
    fileName: doc.fileName ?? "",
    title: st.title ?? initialState.title,
    preset: st.preset ?? initialState.preset,
    format: st.format ?? initialState.format,
    styles: { ...initialState.styles, ...st.styles },
    image: { ...initialState.image, ...st.image },
  };
}
