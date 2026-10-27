import { useEffect, useState, type FormEvent } from "react";
import { api, type Note } from "./api";
import { hasData } from "./config";
import { getMe } from "./platform";

// 首页：显示当前用户，有数据时演示读写。换成你自己的页面即可。
export default function App() {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getMe().then((me) => setName(me.name));
    if (hasData) {
      api
        .notes()
        .then(setNotes)
        .catch((err) => setError(err.message));
    }
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const note = await api.addNote(text);
      setNotes([note, ...notes]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  return (
    <>
      <header className="topbar">
        <span className="title">schedule2date</span>
      </header>
      <main className="content stack">
        <section className="card stack">
          <h1>{name ? `你好，${name}` : "你好"}</h1>
          <p className="muted">排期班表</p>
          {error && <p className="error">{error}</p>}
        </section>
        {hasData && (
          <section className="card stack">
            <h1>笔记</h1>
            <form className="actions" onSubmit={add}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="写点什么" />
              <button type="submit" disabled={!text.trim()}>
                保存
              </button>
            </form>
            <ul className="list">
              {notes.map((n) => (
                <li key={n.id}>
                  {n.text}
                  <span className="muted"> · {n.author}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
