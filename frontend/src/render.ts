// 把一个月的班表画到 canvas 上。预览和导出用同一套绘制，看到的就是下载得到的图片。
import { isRest, type Shift } from "./schedule";

export type Theme = "light" | "dark";

// 单元格样式。没设置的项用班次的默认配色。scale 是字号倍数。
export type CellStyle = { bg?: string; color?: string; bold?: boolean; scale?: number };

export type Styles = {
  byShift: Record<string, CellStyle>; // 按班次名称，所有同名班次一起生效
  byDate: Record<string, CellStyle>; // 按日期，只对这一天生效，优先级更高
};

export type ImageOptions = {
  width: number;
  height: number;
  title: string;
  theme: Theme;
  weekStart: 0 | 1; // 0 周日开始，1 周一开始
  showTime: boolean;
  showNote: boolean;
  showLegend: boolean;
  showStats: boolean;
};

export type Rect = { x: number; y: number; w: number; h: number };
export type CellBox = { date: string; rect: Rect };

export const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

// 画面颜色和门户的浅色、深色主题一致。
const palette = {
  light: { page: "#f5f6f8", surface: "#ffffff", text: "#1d2129", muted: "#6b7280", border: "#e5e7eb", weekend: "#d93025", accent: "#2f6fde" },
  dark: { page: "#15171c", surface: "#1f2228", text: "#e8eaed", muted: "#9aa0a6", border: "#2e3239", weekend: "#f28b82", accent: "#6b9cf5" },
};

// 班次默认配色：按名称里的关键字归类，先匹配的优先（“早晚”要排在“早”“晚”前面）。
const shiftKinds: { test: (n: string) => boolean; light: [string, string]; dark: [string, string] }[] = [
  { test: isRest, light: ["#e7f5ea", "#1e7b34"], dark: ["#1f3326", "#8fd19e"] },
  { test: (n) => n.includes("早晚"), light: ["#e0f4f1", "#0f766e"], dark: ["#173431", "#7dd3c8"] },
  { test: (n) => n.includes("夜"), light: ["#e8eaf6", "#3949ab"], dark: ["#252a45", "#a5b0f0"] },
  { test: (n) => n.includes("晚"), light: ["#f3e8fb", "#8e24aa"], dark: ["#35253d", "#d7a6ea"] },
  { test: (n) => n.includes("早"), light: ["#fff1e0", "#c25e00"], dark: ["#3a2c1c", "#ffb871"] },
  { test: (n) => n.includes("白"), light: ["#e6f0ff", "#2f6fde"], dark: ["#1e2c45", "#8fb4f7"] },
  { test: (n) => n.includes("中"), light: ["#fff8db", "#9a7400"], dark: ["#38331b", "#ead27a"] },
  { test: (n) => n.includes("下"), light: ["#e0f5fb", "#00788f"], dark: ["#173640", "#7fd3e6"] },
];

// 其他名称按名字算出一个固定的颜色，同名班次颜色总是一样。
const fallbackKinds: { light: [string, string]; dark: [string, string] }[] = [
  { light: ["#fde7ef", "#c2185b"], dark: ["#3d2230", "#f2a1c0"] },
  { light: ["#eef3e2", "#5b7a13"], dark: ["#2b331c", "#c3df86"] },
  { light: ["#ece7e1", "#6d4c41"], dark: ["#332c28", "#d0b8ad"] },
  { light: ["#e3eef4", "#37617a"], dark: ["#22303a", "#a8c8dc"] },
];

export function defaultStyle(name: string, theme: Theme): Required<CellStyle> {
  const kind = shiftKinds.find((k) => k.test(name)) ?? fallbackKinds[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % fallbackKinds.length];
  const [bg, color] = kind[theme];
  return { bg, color, bold: true, scale: 1 };
}

export function styleFor(shift: Shift | undefined, date: string, styles: Styles, theme: Theme): Required<CellStyle> {
  const base = shift ? defaultStyle(shift.name, theme) : { bg: palette[theme].surface, color: palette[theme].text, bold: false, scale: 1 };
  return { ...base, ...(shift ? styles.byShift[shift.name] : undefined), ...styles.byDate[date] };
}

// ---- 文字工具 ----

function setFont(ctx: CanvasRenderingContext2D, size: number, bold: boolean) {
  ctx.font = `${bold ? 700 : 400} ${size}px ${fontFamily}`;
}

// 字号从 size 往下缩，直到一行放得下。
function fitSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, bold: boolean, min: number): number {
  let s = size;
  setFont(ctx, s, bold);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s = Math.max(min, s * 0.92);
    setFont(ctx, s, bold);
  }
  return s;
}

// 按字折行（中文没有空格），最多 maxLines 行，超出的最后一行用省略号收尾。
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

// iOS 16 以前的 Safari 没有 roundRect，退回直角矩形。
function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  if ("roundRect" in ctx) ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else (ctx as CanvasRenderingContext2D).rect(r.x, r.y, r.w, r.h);
}

// 多段时间（“8:00-12:00、17:00-21:00”）拆成多行显示。
export const timeLines = (time: string) => time.split(/[、,，;；/]\s*|\s{2,}|\n/).filter(Boolean);

// ---- 绘制 ----

export type MonthData = { year: number; month: number; shifts: Map<string, Shift> };

export const weekNames = ["日", "一", "二", "三", "四", "五", "六"];

export function draw(canvas: HTMLCanvasElement, data: MonthData, styles: Styles, o: ImageOptions, selected?: string): CellBox[] {
  const W = (canvas.width = o.width);
  const H = (canvas.height = o.height);
  const ctx = canvas.getContext("2d")!;
  const c = palette[o.theme];
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = c.page;
  ctx.fillRect(0, 0, W, H);

  // 尺寸都按 u 算：竖图按宽，横图按高，保证不同比例下字号都合适。
  const u = Math.min(W, H * 0.75) / 100;
  const pad = Math.round(u * 5);
  const innerW = W - pad * 2;
  let y = pad;

  // 标题和统计
  ctx.fillStyle = c.text;
  ctx.textAlign = "left";
  const titleSize = fitSize(ctx, o.title, innerW, u * 6.4, true, u * 3);
  y += titleSize;
  ctx.fillText(o.title, pad, y);
  const days = [...data.shifts.values()];
  if (o.showStats && days.length) {
    const rest = days.filter((s) => isRest(s.name)).length;
    const stats = `上班 ${days.length - rest} 天 · 休息 ${rest} 天`;
    setFont(ctx, u * 3.2, false);
    ctx.fillStyle = c.muted;
    y += u * 2.2 + u * 3.2;
    ctx.fillText(stats, pad, y);
  }
  y += u * 3.5;

  // 图例：本月出现的班次和它们的时间。
  const legend = legendItems(days);
  const legendCols = W > H ? 4 : 2;
  const legendRowH = u * 5.2;
  const legendH = o.showLegend && legend.length ? Math.ceil(legend.length / legendCols) * legendRowH + u * 2 : 0;

  // 日期格子：格子太高时限制高度，多出来的空间留在星期表头和格子区的上下，表头始终贴着格子。
  const gap = Math.max(2, Math.round(u * 0.9));
  const cellW = (innerW - gap * 6) / 7;
  const headH = u * 5;
  const first = new Date(data.year, data.month - 1, 1);
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  const lead = (first.getDay() - o.weekStart + 7) % 7;
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const gridH = H - pad - legendH - y - headH;
  const cellH = Math.max(u * 6, Math.min((gridH - gap * (rows - 1)) / rows, cellW * 1.9));
  const gridTop = y + headH + Math.max(0, (gridH - (cellH * rows + gap * (rows - 1))) / 2);

  // 星期表头
  const order = Array.from({ length: 7 }, (_, i) => (i + o.weekStart) % 7);
  setFont(ctx, u * 3, true);
  ctx.textAlign = "center";
  order.forEach((wd, i) => {
    ctx.fillStyle = wd === 0 || wd === 6 ? c.weekend : c.muted;
    ctx.fillText(weekNames[wd], pad + i * (cellW + gap) + cellW / 2, gridTop - headH + headH * 0.68);
  });
  const radius = Math.min(cellW, cellH) * 0.12;
  const boxes: CellBox[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const idx = lead + d - 1;
    const rect = { x: pad + (idx % 7) * (cellW + gap), y: gridTop + Math.floor(idx / 7) * (cellH + gap), w: cellW, h: cellH };
    const date = `${data.year}-${String(data.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const wd = (first.getDay() + d - 1) % 7;
    drawCell(ctx, rect, radius, d, wd === 0 || wd === 6, data.shifts.get(date), styleFor(data.shifts.get(date), date, styles, o.theme), o, u);
    if (date === selected) {
      ctx.lineWidth = Math.max(2, u * 0.6);
      ctx.strokeStyle = c.accent;
      roundRect(ctx, { x: rect.x - ctx.lineWidth / 2, y: rect.y - ctx.lineWidth / 2, w: rect.w + ctx.lineWidth, h: rect.h + ctx.lineWidth }, radius + ctx.lineWidth / 2);
      ctx.stroke();
    }
    boxes.push({ date, rect });
  }

  if (legendH) drawLegend(ctx, legend, { x: pad, y: H - pad - legendH + u * 2, w: innerW, h: legendH - u * 2 }, legendCols, legendRowH, styles, o, u);
  return boxes;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
  day: number,
  weekend: boolean,
  shift: Shift | undefined,
  st: Required<CellStyle>,
  o: ImageOptions,
  u: number,
) {
  const c = palette[o.theme];
  ctx.fillStyle = st.bg;
  roundRect(ctx, r, radius);
  ctx.fill();
  if (!shift) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.border;
    ctx.stroke();
  }

  // 日期数字在左上角
  const daySize = Math.min(r.w * 0.2, r.h * 0.16, u * 3.4);
  setFont(ctx, daySize, false);
  ctx.textAlign = "left";
  ctx.fillStyle = shift ? st.color : weekend ? c.weekend : c.muted;
  ctx.globalAlpha = shift ? 0.75 : 1;
  ctx.fillText(String(day), r.x + r.w * 0.1, r.y + daySize * 1.25);
  ctx.globalAlpha = 1;
  if (!shift) return;

  // 班次名、时间、备注竖着排，整体在日期数字下方的空间里居中。
  const maxW = r.w * 0.88;
  const nameSize = fitSize(ctx, shift.name, maxW, Math.min(r.w * 0.3, r.h * 0.2) * st.scale, st.bold, u * 1.6);
  const lines: { text: string; size: number; bold: boolean; alpha: number }[] = [{ text: shift.name, size: nameSize, bold: st.bold, alpha: 1 }];
  if (o.showTime && shift.time) {
    const parts = timeLines(shift.time);
    const longest = parts.reduce((a, b) => (b.length > a.length ? b : a), "");
    const size = fitSize(ctx, longest, maxW, Math.min(r.w * 0.15, r.h * 0.1) * st.scale, false, u * 1.2);
    for (const t of parts) lines.push({ text: t, size, bold: false, alpha: 0.9 });
  }
  if (o.showNote && shift.note) {
    const size = Math.max(u * 1.1, Math.min(r.w * 0.11, r.h * 0.075) * st.scale);
    setFont(ctx, size, false);
    for (const t of wrap(ctx, shift.note, maxW, 3)) lines.push({ text: t, size, bold: false, alpha: 0.7 });
  }

  const top = r.y + daySize * 1.6;
  const avail = r.y + r.h - top - r.h * 0.05;
  const lineGap = (s: number) => s * 1.25;
  // 放不下时从后往前去掉备注和时间行，班次名总是保留。
  while (lines.length > 1 && lines.reduce((h, l) => h + lineGap(l.size), 0) > avail) lines.pop();
  const total = lines.reduce((h, l) => h + lineGap(l.size), 0);
  let y = top + Math.max(0, (avail - total) / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = st.color;
  for (const l of lines) {
    setFont(ctx, l.size, l.bold);
    ctx.globalAlpha = l.alpha;
    y += lineGap(l.size);
    ctx.fillText(l.text, r.x + r.w / 2, y - l.size * 0.3);
  }
  ctx.globalAlpha = 1;
}

type LegendItem = { name: string; time: string };

// 时间里第一个“时:分”换算成分钟，用来按上班早晚排图例；没有时间的排在后面。
function startMinutes(time: string): number {
  const m = time.match(/(\d{1,2})[:：](\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
}

// 每个班次取它最常见的时间；按上班时间从早到晚排，休息类排最后。
function legendItems(days: Shift[]): LegendItem[] {
  const map = new Map<string, Map<string, number>>();
  for (const s of days) {
    const times = map.get(s.name) ?? new Map<string, number>();
    times.set(s.time, (times.get(s.time) ?? 0) + 1);
    map.set(s.name, times);
  }
  return [...map.entries()]
    .map(([name, times]) => ({ name, time: [...times.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort(
      (a, b) =>
        Number(isRest(a.name)) - Number(isRest(b.name)) ||
        startMinutes(a.time) - startMinutes(b.time) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
}

function drawLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], area: Rect, cols: number, rowH: number, styles: Styles, o: ImageOptions, u: number) {
  const c = palette[o.theme];
  const colW = area.w / cols;
  const chipH = rowH * 0.72;
  ctx.textBaseline = "middle";
  items.forEach((item, i) => {
    const x = area.x + (i % cols) * colW;
    const y = area.y + Math.floor(i / cols) * rowH;
    const st = { ...defaultStyle(item.name, o.theme), ...styles.byShift[item.name] };
    // 班次名做成和格子同色的小标签
    const chipSize = fitSize(ctx, item.name, u * 14, chipH * 0.55, true, u * 1.4);
    const chipW = Math.max(chipH * 1.6, ctx.measureText(item.name).width + chipH * 0.7);
    ctx.fillStyle = st.bg;
    roundRect(ctx, { x, y, w: chipW, h: chipH }, chipH * 0.3);
    ctx.fill();
    ctx.fillStyle = st.color;
    ctx.textAlign = "center";
    setFont(ctx, chipSize, true);
    ctx.fillText(item.name, x + chipW / 2, y + chipH / 2);

    const text = item.time ? timeLines(item.time).join(" / ") : isRest(item.name) ? "休息" : "—";
    const tx = x + chipW + u * 1.5;
    ctx.fillStyle = c.text;
    ctx.textAlign = "left";
    fitSize(ctx, text, colW - chipW - u * 3, u * 2.7, false, u * 1.2);
    ctx.fillText(text, tx, y + chipH / 2);
  });
  ctx.textBaseline = "alphabetic";
}

// 点击位置换算成画布坐标后，找到落在哪个日期格子里。
export function hitTest(boxes: CellBox[], x: number, y: number): string | null {
  const box = boxes.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return box?.date ?? null;
}
