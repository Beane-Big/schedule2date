// 读取 .xlsx 第一个工作表的单元格。不引入第三方库：.xlsx 是 zip 包里的几份 XML，
// 用浏览器自带的 DecompressionStream 解压、DOMParser 解析即可。旧版 .xls（二进制格式）不支持。

export type CellValue = string | number | Date | null;

type ZipEntry = { method: number; compSize: number; offset: number };

// readZip 读 zip 的中央目录，按文件名返回条目；文件内容在 extract 时才解压。
function readZip(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  let eocd = -1;
  // 中央目录结束记录在文件末尾，后面最多跟 64KB 的注释。
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 .xlsx 文件");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("xlsx 文件已损坏");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    // 本地文件头里的文件名和扩展字段长度可能和中央目录不同，以本地头为准算出数据位置。
    const offset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    entries.set(name.replace(/^\//, ""), { method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extract(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const raw = new Uint8Array(buf, entry.offset, entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8) throw new Error("xlsx 使用了不支持的压缩方式");
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器不支持读取 xlsx，请升级浏览器或改用 CSV");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

// 按本地名取元素，不管带不带命名空间前缀（有的生成器写成 x:c）。
function tags(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

// 内置的数字格式编号，含中文版 Excel 的日期、时间格式。
const builtinDateFormats = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]);
const builtinTimeFormats = new Set([18, 19, 20, 21, 32, 33, 34, 35, 45, 46, 47, 55, 56]);

type FormatKind = "date" | "time";

function formatKind(code: string): FormatKind | null {
  // 去掉引号里的文字、方括号（颜色、区域）和转义字符后，有年或日就是日期格式；
  // 只有 m 时要看有没有时、秒，h:mm 里的 m 是分钟。
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  if (/[yd]/i.test(stripped) || (/m/i.test(stripped) && !/[hs]/i.test(stripped))) return "date";
  if (/[hs]/i.test(stripped)) return "time";
  return null;
}

// 每个单元格样式是不是日期或时间格式，按样式序号。
function formatKinds(stylesXml: string | null): Map<number, FormatKind> {
  const result = new Map<number, FormatKind>();
  if (!stylesXml) return result;
  const doc = parseXml(stylesXml);
  const custom = new Map<number, string>();
  for (const f of tags(doc, "numFmt")) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
  const cellXfs = tags(doc, "cellXfs")[0];
  if (!cellXfs) return result;
  tags(cellXfs, "xf").forEach((xf, i) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    const kind = builtinDateFormats.has(id) ? "date" : builtinTimeFormats.has(id) ? "time" : custom.has(id) ? formatKind(custom.get(id)!) : null;
    if (kind) result.set(i, kind);
  });
  return result;
}

// 时间格式的单元格存的是一天里的比例（0.375 是 9:00），换成“时:分”。
function fractionToTime(v: number): string {
  const minutes = Math.round((v - Math.floor(v)) * 1440) % 1440;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// Excel 的日期序号：1900 日期系统，第 60 天是不存在的 1900-02-29，从 1899-12-30 起算正好抵消。
export function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.toUpperCase().charCodeAt(0) - 64;
  return n - 1;
}

// 富文本里的注音（rPh）不算正文。
function textOf(el: Element): string {
  return tags(el, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");
}

export async function readXlsx(buf: ArrayBuffer): Promise<CellValue[][]> {
  const zip = readZip(buf);
  const read = async (name: string) => {
    const entry = zip.get(name);
    return entry ? extract(buf, entry) : null;
  };

  // 找第一个工作表：workbook.xml 里第一个 sheet 的关系 id，到 workbook.xml.rels 里查文件路径。
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("不是有效的 .xlsx 文件");
  const firstSheet = tags(parseXml(workbook), "sheet")[0];
  const relId = firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? firstSheet?.getAttribute("r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (rels && relId) {
    const rel = tags(parseXml(rels), "Relationship").find((r) => r.getAttribute("Id") === relId);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error("xlsx 里没有工作表");

  const shared = await read("xl/sharedStrings.xml");
  const strings = shared ? tags(parseXml(shared), "si").map(textOf) : [];
  const kinds = formatKinds(await read("xl/styles.xml"));

  const rows: CellValue[][] = [];
  for (const row of tags(parseXml(sheet), "row")) {
    const values: CellValue[] = [];
    let next = 0;
    for (const c of tags(row, "c")) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = c.getAttribute("t");
      const v = tags(c, "v")[0]?.textContent ?? null;
      let value: CellValue = null;
      if (type === "s") value = v === null ? null : (strings[Number(v)] ?? null);
      else if (type === "inlineStr") value = textOf(c);
      else if (type === "str" || type === "e") value = v;
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== null) {
        const num = Number(v);
        const kind = kinds.get(Number(c.getAttribute("s") ?? -1));
        value = kind === "date" ? excelSerialToDate(num) : kind === "time" ? fractionToTime(num) : num;
      }
      values[col] = value;
    }
    const rowIndex = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
    rows[rowIndex] = Array.from(values, (v) => v ?? null);
  }
  return Array.from(rows, (r) => r ?? []);
}
