export type Note = { id: number; text: string; author: string; createdAt: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 调用本模块后端的对内接口；登录 Cookie 由浏览器自动带上，网关负责校验。
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "请求失败");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  notes: () => request<Note[]>("/api/schedule2date/notes"),
  addNote: (text: string) => request<Note>("/api/schedule2date/notes", { method: "POST", body: JSON.stringify({ text }) }),
};
