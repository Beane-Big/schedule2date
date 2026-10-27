import type { Doc } from "./store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
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
    throw new ApiError(res.status, body.error ?? "请求失败", body);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// 后端保存的当前班表。还没有人导入过时 data 是 null、version 是 0。
export type Saved = { data: Doc | null; version: number; updatedBy: string; updatedAt: string };

export const api = {
  schedule: () => request<Saved>("/api/schedule2date/schedule"),
  // version 是保存前看到的版本；别人先改过时返回 409，错误的 body.current 是最新的班表。
  save: (version: number, data: Doc) => request<Saved>("/api/schedule2date/schedule", { method: "PUT", body: JSON.stringify({ version, data }) }),
};
