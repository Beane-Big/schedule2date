// 选中一个日期格子后的编辑面板：改这一天的班次内容，改格子样式（只这一天或所有同名班次）。
import { useState } from "react";
import { styleFor, weekNames, type CellStyle, type Styles, type Theme } from "./render";
import type { Shift } from "./schedule";
import { Field, Segmented, Toggle } from "./ui";

type Scope = "shift" | "date";

export default function CellEditor({
  className,
  date,
  entry,
  styles,
  theme,
  onShiftChange,
  onStylesChange,
  onClose,
}: {
  className?: string;
  date: string;
  entry: Shift | undefined; // 这一天的记录，班次名可能正被清空
  styles: Styles;
  theme: Theme;
  onShiftChange: (s: Shift) => void;
  onStylesChange: (s: Styles) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("shift");
  const shift = entry?.name.trim() ? entry : undefined;
  // 这一天没有班次时，只能按日期设置样式。
  const effectiveScope: Scope = shift ? scope : "date";
  const current = styleFor(shift, date, styles, theme);
  const scopeKey = effectiveScope === "shift" ? shift!.name : date;
  const bucket = effectiveScope === "shift" ? styles.byShift : styles.byDate;
  const own = bucket[scopeKey];
  const dayOverride = styles.byDate[date];

  const [y, m, d] = date.split("-").map(Number);
  const weekday = weekNames[new Date(y, m - 1, d).getDay()];

  function setStyle(patch: CellStyle) {
    const field = effectiveScope === "shift" ? "byShift" : "byDate";
    onStylesChange({ ...styles, [field]: { ...bucket, [scopeKey]: { ...own, ...patch } } });
  }

  function resetStyle(field: "byShift" | "byDate", k: string) {
    const next = { ...styles[field] };
    delete next[k];
    onStylesChange({ ...styles, [field]: next });
  }

  // 班次名清空就等于这一天没有排班；时间和备注先留着，重新输入班次名时还在。
  function setText(patch: Partial<Shift>) {
    onShiftChange({ date, name: "", time: "", note: "", ...entry, ...patch });
  }

  return (
    <section className={`card stack ${className ?? ""}`}>
      <div className="card-head">
        <h1>
          {m}月{d}日 周{weekday}
        </h1>
        <button type="button" className="link" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="fields">
        <Field label="班次">
          <input value={entry?.name ?? ""} placeholder="例如 白4、休" onChange={(e) => setText({ name: e.target.value })} />
        </Field>
        <Field label="上下班时间">
          <input value={entry?.time ?? ""} placeholder="例如 9:00-17:30" onChange={(e) => setText({ time: e.target.value })} />
        </Field>
        <Field label="备注（就餐时间等）" wide>
          <input value={entry?.note ?? ""} onChange={(e) => setText({ note: e.target.value })} />
        </Field>
      </div>

      <h2>样式</h2>
      {shift && (
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "shift", label: `所有「${shift.name}」` },
            { value: "date", label: "只改这一天" },
          ]}
        />
      )}
      <div className="fields">
        <Field label="背景色">
          <input type="color" value={current.bg} onChange={(e) => setStyle({ bg: e.target.value })} />
        </Field>
        <Field label="文字颜色">
          <input type="color" value={current.color} onChange={(e) => setStyle({ color: e.target.value })} />
        </Field>
        <Field label={`字号 ${Math.round(current.scale * 100)}%`} wide>
          <input type="range" min={0.6} max={1.6} step={0.05} value={current.scale} onChange={(e) => setStyle({ scale: Number(e.target.value) })} />
        </Field>
      </div>
      <Toggle label="班次名加粗" checked={current.bold} onChange={(v) => setStyle({ bold: v })} />

      {effectiveScope === "shift" && dayOverride && (
        <p className="muted">
          这一天单独设置过样式，会盖过班次样式。
          <button type="button" className="link" onClick={() => resetStyle("byDate", date)}>
            清除这一天的单独样式
          </button>
        </p>
      )}
      <div className="actions">
        <button type="button" className="secondary" disabled={!own} onClick={() => resetStyle(effectiveScope === "shift" ? "byShift" : "byDate", scopeKey)}>
          恢复默认样式
        </button>
      </div>
    </section>
  );
}
