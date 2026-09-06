export interface Conn { baseUrl: string; apiKey: string }
// Held in sessionStorage only: cleared when the tab closes, never persisted to disk.
export const load = (): Conn | null => { try { return JSON.parse(sessionStorage.getItem("sal-admin") ?? "null"); } catch { return null; } };
export const save = (c: Conn) => sessionStorage.setItem("sal-admin", JSON.stringify(c));
export const clear = () => sessionStorage.removeItem("sal-admin");

export async function api<T = any>(c: Conn, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { "content-type": "application/json", "x-api-key": c.apiKey, ...(init.headers ?? {}) } });
  if (r.status === 204) return undefined as T;
  const ct = r.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(typeof body === "string" ? body : body.message ?? "Request failed");
  return body;
}
