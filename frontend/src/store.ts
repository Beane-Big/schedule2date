// 页面状态和它在浏览器里的保存。模块没有后端，导入的班表和样式只存在这台设备的浏览器里。
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
  month: string; // 当前显示的月份 YYYY-MM
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

const key = "schedule2date:v1";

export function loadState(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!saved) return initialState;
    // 和默认值合并，以后加了新选项时老数据也能用。
    return {
      ...initialState,
      ...saved,
      styles: { ...initialState.styles, ...saved.styles },
      image: { ...initialState.image, ...saved.image },
    };
  } catch {
    return initialState;
  }
}

export function saveState(state: State) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // 无痕模式或存储已满时存不了，不影响当前使用。
  }
}
