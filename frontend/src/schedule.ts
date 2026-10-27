// 班表数据：从导入的表格里认出日期、班次、上下班时间和备注，按月份整理。
import { readXlsx, excelSerialToDate, type CellValue } from "./xlsx";

// 一天的班次。date 是 YYYY-MM-DD。
export type Shift = { date: string; name: string; time: string; note: string };

export type Imported = {
  shifts: Shift[];
  // 原表的日期没有年份（比如 10/1）时为 true，年份由页面上选，可以改。
  yearless: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

// ---- 读文件 ----

export async function readTable(file: File): Promise<CellValue[][]> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  // zip 文件以 PK 开头，就是 xlsx；旧版 xls 以 D0 CF 开头。
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buf);
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error("暂不支持旧版 .xls，请在 Excel 里另存为 .xlsx 或 .csv");
  return parseCsv(decodeText(buf));
}

// Excel 在中文系统上导出的 CSV 常是 GBK 编码：按 UTF-8 解出乱码时改用 GBK。
function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return utf8;
  }
}

// parseCsv 按 RFC 4180 解析：支持引号、引号里的逗号和换行、两个引号表示一个引号。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---- 认列 ----

type Columns = { date: number; name: number; time: number; note: number };

const cellText = (v: CellValue | undefined) => (v instanceof Date ? "" : v === null || v === undefined ? "" : String(v).trim());

function findColumns(header: string[]): Columns | null {
  const find = (re: RegExp, skip?: RegExp) => header.findIndex((h) => re.test(h) && !(skip && skip.test(h)));
  const date = find(/日期|date/i);
  const meal = /就餐|用餐|吃饭|备注|说明|note|remark/i;
  const name = find(/班次|班别|班种|班型|shift/i, /时间|时段|time|工时/i);
  // “上下班时间”优先，没有时退回到任何带“时间/时段”、但不是就餐或工时的列。
  let time = find(/上下班|工作时间|班次时间|时段/);
  if (time < 0) time = find(/时间|time/i, new RegExp(meal.source + "|工时|时长", "i"));
  const note = find(meal);
  if (date < 0 || name < 0) return null;
  return { date, name, time, note };
}

// ---- 认日期 ----

type DateParts = { y?: number; m: number; d: number };

function parseDate(v: CellValue | undefined): DateParts | null {
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  // 没有设日期格式的日期单元格读出来是序号，只在合理范围（1954–2119 年）内当日期。
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return parseDate(excelSerialToDate(v));
    return null;
  }
  const s = cellText(v);
  let m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return valid({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  m = s.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (m) return valid({ m: Number(m[1]), d: Number(m[2]) });
  return null;
}

function valid(p: DateParts): DateParts | null {
  if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return null;
  return p;
}

// ---- 整理 ----

// 表示“没有内容”的写法：休息日的时间、没有就餐时间时原表常这样填。
const emptyValue = /^(无|没有|休息|休息备班|-+|—+|\/|0|0分钟|0 分钟|none|n\/a)$/i;

export function cleanValue(s: string): string {
  const t = s.trim();
  if (emptyValue.test(t)) return "";
  // “无（原表未提供该班次时间）”这类带说明的空值也当作空。
  if (/^无[（(]/.test(t)) return "";
  return t;
}

export function toShifts(rows: CellValue[][], year: number): Imported {
  const headerAt = rows.slice(0, 10).findIndex((r) => findColumns(r.map(cellText)) !== null);
  if (headerAt < 0) throw new Error("表格里找不到表头：至少要有“日期”和“班次”两列");
  const cols = findColumns(rows[headerAt].map(cellText))!;
  const pick = (r: CellValue[], i: number) => (i < 0 ? "" : cellText(r[i]));

  const byDate = new Map<string, Shift>();
  let yearless = false;
  for (const r of rows.slice(headerAt + 1)) {
    const parts = parseDate(r[cols.date]);
    const name = pick(r, cols.name);
    if (!parts || !name) continue;
    if (parts.y === undefined) yearless = true;
    const date = dateKey(parts.y ?? year, parts.m, parts.d);
    // 同一天出现多次时以最后一行为准。
    byDate.set(date, { date, name, time: cleanValue(pick(r, cols.time)), note: cleanValue(pick(r, cols.note)) });
  }
  if (byDate.size === 0) throw new Error("没有读到任何班次，请检查“日期”列的格式（例如 2026-10-01 或 10/1）");
  const shifts = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { shifts, yearless };
}

// 原表没写年份时，改年份就是把每一天的年份换掉。
export function withYear(shifts: Shift[], year: number): Shift[] {
  return shifts.map((s) => ({ ...s, date: String(year) + s.date.slice(4) }));
}

// 班表里出现的月份（YYYY-MM），从早到晚。
export function monthsOf(shifts: Shift[]): string[] {
  return [...new Set(shifts.map((s) => s.date.slice(0, 7)))].sort();
}

// 休息类班次：名称里带“休”。
export const isRest = (name: string) => name.includes("休");
