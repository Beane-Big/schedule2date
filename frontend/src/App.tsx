import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { api, ApiError, type Saved } from "./api";
import CellEditor from "./CellEditor";
import { can, getMe, type Me } from "./platform";
import { draw, hitTest, type CellBox, type ImageOptions, type MonthData } from "./render";
import { monthsOf, readTable, toShifts, withYear, type Shift } from "./schedule";
import { fromDoc, initialState, maxPixels, maxSide, minSide, sizePresets, toDoc, type Format, type State } from "./store";
import { Field, Segmented, Toggle } from "./ui";

type SaveStatus = "idle" | "saving" | "saved" | "error";

// 首页：有“制作班表”权限的人导入班表文件、点格子改样式、改图片设置，改动自动保存到后端；
// 只有“查看班表”权限的人只能看、切换月份和下载。后端只保留最新一份班表。
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState<State>(initialState);
  const [meta, setMeta] = useState<Omit<Saved, "data"> | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<CellBox[]>([]);

  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const setImage = (patch: Partial<State["image"]>) => setState((s) => ({ ...s, image: { ...s.image, ...patch } }));

  const canMake = !!me && can(me, "make");
  const canView = !!me && (canMake || can(me, "view"));

  // 先取当前用户的权限，能查看时再取班表。
  useEffect(() => {
    getMe()
      .then(async (user) => {
        setMe(user);
        if (can(user, "view") || can(user, "make")) apply(await api.schedule());
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "读取班表失败"));
  }, []);

  // ---- 自动保存 ----
  // 改动停下 0.8 秒后把整份班表存到后端。同一时间只发一个保存请求，保存期间又有改动时，存完接着再存一次。
  const docJson = JSON.stringify(toDoc(state));
  const latestDoc = useRef(docJson);
  latestDoc.current = docJson;
  const lastSaved = useRef(docJson); // 和后端一致的那份
  const version = useRef(0);
  const inFlight = useRef(false);

  // apply 换成后端的班表（加载时，或保存冲突时换成别人刚存的那份）。
  function apply(saved: Saved) {
    const next = fromDoc(saved.data);
    lastSaved.current = JSON.stringify(toDoc(next));
    version.current = saved.version;
    setMeta({ version: saved.version, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt });
    setSelected(null);
    setState((s) => ({ ...next, month: s.month }));
  }

  async function flush() {
    if (inFlight.current || latestDoc.current === lastSaved.current) return;
    const body = latestDoc.current;
    inFlight.current = true;
    setSaveStatus("saving");
    setSaveError("");
    let ok = false;
    try {
      const saved = await api.save(version.current, JSON.parse(body));
      lastSaved.current = body;
      version.current = saved.version;
      setMeta({ version: saved.version, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt });
      setSaveStatus("saved");
      ok = true;
    } catch (err) {
      const current = err instanceof ApiError && err.status === 409 ? (err.body as { current?: Saved }).current : undefined;
      if (current) apply(current);
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      inFlight.current = false;
    }
    if (ok && latestDoc.current !== lastSaved.current) flush();
  }

  useEffect(() => {
    if (!canMake || docJson === lastSaved.current) return;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [docJson, canMake]);

  // 还有没存上的改动时，关闭或刷新页面前提醒一下。
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latestDoc.current !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const months = useMemo(() => monthsOf(state.shifts.filter((s) => s.name.trim())), [state.shifts]);
  const month = months.includes(state.month) ? state.month : (months[0] ?? "");
  const [year, monthNum] = month ? month.split("-").map(Number) : [0, 0];

  const data: MonthData | null = useMemo(() => {
    if (!month) return null;
    const shifts = new Map<string, Shift>();
    for (const s of state.shifts) if (s.date.startsWith(month) && s.name.trim()) shifts.set(s.date, s);
    return { year, month: monthNum, shifts };
  }, [state.shifts, month, year, monthNum]);

  const options: ImageOptions = { ...state.image, title: state.title.trim() || `${year}年${monthNum}月排班表` };

  // 尺寸超出范围时下载按钮不可用，并说明原因。
  const { width, height } = state.image;
  const sizeError =
    !Number.isFinite(width) || !Number.isFinite(height) || width < minSide || height < minSide || width > maxSide || height > maxSide
      ? `宽和高要在 ${minSide}–${maxSide} 像素之间`
      : width * height > maxPixels
        ? "图片太大，手机上可能导出空白图，请把宽或高调小"
        : "";

  // 每次数据或设置变化都按实际尺寸重画预览，预览和下载的图片完全一样（只多了选中框）。
  // 尺寸不合法时（比如正在输入）保留上一张预览。
  useEffect(() => {
    if (data && preview.current && !sizeError) boxes.current = draw(preview.current, data, state.styles, options, selected ?? undefined);
  });

  async function importFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const imported = toShifts(await readTable(file), new Date().getFullYear());
      setSelected(null);
      update({ shifts: imported.shifts, yearless: imported.yearless, fileName: file.name, month: monthsOf(imported.shifts)[0] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取文件失败");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) importFile(file);
  }

  function select(date: string | null) {
    // 离开一个格子时，把班次名被清空的记录去掉。
    setState((s) => ({ ...s, shifts: s.shifts.filter((x) => x.name.trim() || x.date === date) }));
    setSelected(date);
  }

  function onPreviewClick(e: MouseEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height;
    const date = canMake ? hitTest(boxes.current, x, y) : null;
    if (date) select(date === selected ? null : date);
  }

  function changeShift(next: Shift) {
    setState((s) => {
      const rest = s.shifts.filter((x) => x.date !== next.date);
      return { ...s, shifts: [...rest, next].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  }

  // 原表没写年份时可选的年份：今年前后各 3 年，再加上当前选的年份。
  const thisYear = new Date().getFullYear();
  const yearChoices = [...new Set([...Array.from({ length: 7 }, (_, i) => thisYear - 3 + i), year])].sort((a, b) => a - b);

  function changeYear(y: number) {
    setSelected(null);
    update({ shifts: withYear(state.shifts, y), month: String(y) + month.slice(4) });
  }

  function setSize(width: number, height: number, preset = "custom") {
    update({ preset, image: { ...state.image, width, height } });
  }

  const fileName = `排班表-${month}.${state.format === "jpeg" ? "jpg" : "png"}`;

  async function renderBlob(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    draw(canvas, data!, state.styles, options);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${state.format}`, 0.92));
    if (!blob) throw new Error("生成图片失败，请把尺寸调小再试");
    return blob;
  }

  async function download() {
    setError("");
    try {
      const url = URL.createObjectURL(await renderBlob());
      // 链接要放进页面里再点，有的浏览器才会用 download 指定的文件名。
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }

  // 手机上用系统分享面板，可以直接“存储图像”到相册或发给别人。
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "a.png", { type: "image/png" })] });
  async function share() {
    setError("");
    try {
      const blob = await renderBlob();
      await navigator.share({ files: [new File([blob], fileName, { type: blob.type })], title: options.title });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // 生成图片耗时较长时，有的浏览器（iOS Safari）会认为不是用户操作而拒绝分享，改为直接下载。
      if (err instanceof DOMException && err.name === "NotAllowedError") return download();
      setError(err instanceof Error ? err.message : "分享失败");
    }
  }

  // 清空导入的班表和按天设置的样式；班次样式和图片设置留着，下个月导入时接着用。
  // 班表是大家共用的，清空后所有人都看不到，先确认一下。
  function clearAll() {
    if (!window.confirm("清空后所有人都看不到这份班表，确定清空吗？")) return;
    setSelected(null);
    setError("");
    setState((s) => ({
      ...s,
      shifts: initialState.shifts,
      yearless: false,
      fileName: "",
      month: "",
      styles: { ...s.styles, byDate: {} },
    }));
  }

  const selectedEntry = selected ? state.shifts.find((s) => s.date === selected) : undefined;
  const updated = meta?.updatedAt && meta.version > 0 ? formatTime(meta.updatedAt) : "";

  // 还在取权限和班表、出错了、或者没有权限时，只显示一张说明卡片。
  const notice = loadError ? (
    <p className="error">{loadError}</p>
  ) : !me || (canView && !meta) ? (
    <p className="muted">正在读取班表…</p>
  ) : !canView ? (
    <p className="muted">你还没有“查看班表”的权限，请联系管理员在门户的“用户”页开通。</p>
  ) : null;
  if (notice)
    return (
      <main className="content">
        <section className="card stack empty">{notice}</section>
      </main>
    );

  return (
    <main className="content wide">
      {/* 窄屏按 导入、预览、编辑、设置 的顺序排；宽屏左边是导入和设置，右边是预览，见 styles.css 的 .layout。
          只能查看的人只有预览一块。 */}
      <div className={canMake ? "layout" : "layout view-only"}>
        {canMake && (
          <section
            className={dragging ? "card stack dropzone dragging area-import" : "card stack dropzone area-import"}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <h1>导入班表</h1>
            <p className="muted">支持 .xlsx 和 .csv。表头要有“日期”和“班次”列，“上下班时间”“就餐时间/备注”列可选。也可以把文件拖到这里。</p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy ? "读取中…" : state.shifts.length ? "重新导入" : "选择文件"}
              </button>
              {state.shifts.length > 0 && (
                <>
                  <span className="muted">
                    {state.fileName} · {state.shifts.filter((s) => s.name.trim()).length} 天
                  </span>
                  <button type="button" className="link" onClick={clearAll}>
                    清空
                  </button>
                </>
              )}
            </div>
            {error && <p className="error">{error}</p>}
            {data && state.yearless && (
              <div className="fields">
                <Field label="年份（原表没写年份）">
                  <select value={year} onChange={(e) => changeYear(Number(e.target.value))}>
                    {yearChoices.map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </section>
        )}

        {data ? (
          <section className="card stack area-preview">
            <div className="card-head">
              <h1>预览</h1>
              <span className="muted">
                {width}×{height}
              </span>
              <div className="actions">
              <button type="button" disabled={!!sizeError} onClick={download}>
                下载图片
              </button>
              {canShare && (
                <button type="button" className="secondary" disabled={!!sizeError} onClick={share}>
                  分享 / 存到相册
                </button>
              )}
            </div>
            </div>
            {canMake ? (
              <p className="muted">
                {saveStatus === "saving"
                  ? "正在保存…"
                  : saveStatus === "error"
                    ? ""
                    : updated
                      ? `已保存（${meta!.updatedBy} ${updated}）。`
                      : "改动会自动保存。"}
                {saveStatus !== "error" && "点日期格子可以修改内容和样式。"}
              </p>
            ) : (
              updated && <p className="muted">最后更新：{meta!.updatedBy} {updated}</p>
            )}
            {saveStatus === "error" && (
              <p className="error">
                {saveError}
                {latestDoc.current !== lastSaved.current && (
                  <button type="button" className="link" onClick={flush}>
                    重试
                  </button>
                )}
              </p>
            )}
            {!canMake && error && <p className="error">{error}</p>}
            {months.length > 1 && (
              <Field label="月份">
                <select
                  value={month}
                  onChange={(e) => {
                    select(null);
                    update({ month: e.target.value });
                  }}
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("-", "年")}月
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <canvas ref={preview} className={canMake ? "preview editable" : "preview"} onClick={onPreviewClick} />
          </section>
        ) : (
          <section className="card stack empty area-preview">
            <p className="muted">{canMake ? "导入班表后，这里会显示生成的图片。" : "还没有班表，有“制作班表”权限的人导入后这里就会显示。"}</p>
          </section>
        )}

        {canMake && data && selected && (
          <CellEditor
            className="area-editor"
            key={selected}
            date={selected}
            entry={selectedEntry}
            styles={state.styles}
            theme={state.image.theme}
            onShiftChange={changeShift}
            onStylesChange={(styles) => update({ styles })}
            onClose={() => select(null)}
          />
        )}

        {canMake && data && (
          <section className="card stack area-settings">
            <h1>图片设置</h1>
            <div className="fields">
              <Field label="标题" wide>
                <input value={state.title} placeholder={`${year}年${monthNum}月排班表`} onChange={(e) => update({ title: e.target.value })} />
              </Field>
              <Field label="尺寸" wide>
                <select
                  value={state.preset}
                  onChange={(e) => {
                    const p = sizePresets.find((x) => x.id === e.target.value);
                    if (p) setSize(p.width, p.height, p.id);
                    else update({ preset: "custom" });
                  }}
                >
                  {sizePresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">自定义</option>
                </select>
              </Field>
              <Field label="宽（像素）">
                <input type="number" min={minSide} max={maxSide} value={width} onChange={(e) => setSize(Number(e.target.value), height)} />
              </Field>
              <Field label="高（像素）">
                <input type="number" min={minSide} max={maxSide} value={height} onChange={(e) => setSize(width, Number(e.target.value))} />
              </Field>
            </div>
            {sizeError && <p className="error">{sizeError}</p>}
            <div className="fields">
              <Field label="格式">
                <Segmented<Format>
                  value={state.format}
                  onChange={(format) => update({ format })}
                  options={[
                    { value: "jpeg", label: "JPG" },
                    { value: "png", label: "PNG" },
                  ]}
                />
              </Field>
              <Field label="主题">
                <Segmented
                  value={state.image.theme}
                  onChange={(theme) => setImage({ theme })}
                  options={[
                    { value: "light", label: "浅色" },
                    { value: "dark", label: "深色" },
                  ]}
                />
              </Field>
              <Field label="每周从">
                <Segmented<0 | 1>
                  value={state.image.weekStart}
                  onChange={(weekStart) => setImage({ weekStart })}
                  options={[
                    { value: 1, label: "周一" },
                    { value: 0, label: "周日" },
                  ]}
                />
              </Field>
            </div>
            <div className="actions">
              <Toggle label="显示上下班时间" checked={state.image.showTime} onChange={(showTime) => setImage({ showTime })} />
              <Toggle label="显示就餐备注" checked={state.image.showNote} onChange={(showNote) => setImage({ showNote })} />
              <Toggle label="显示班次说明" checked={state.image.showLegend} onChange={(showLegend) => setImage({ showLegend })} />
              <Toggle label="显示天数统计" checked={state.image.showStats} onChange={(showStats) => setImage({ showStats })} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// 保存时间显示成“10月27日 14:50”，今年以外的带上年份。
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`;
}
