// 呼叫後端 API。錯誤統一丟出 ApiError，訊息可直接顯示給使用者。

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 未登入或需要改密碼時呼叫的處理器，由 app.js 設定。 */
let authHandler = () => {};
export function onAuthProblem(fn) {
  authHandler = fn;
}

export async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError(0, "無法連線到系統，請確認主機電腦的借閱系統仍在執行");
  }
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || `發生錯誤（${res.status}）`, data?.code);
    if (err.code === "LOGIN_REQUIRED" || err.code === "MUST_CHANGE_PASSWORD") authHandler(err);
    throw err;
  }
  return data;
}

export const GET = (p) => api("GET", p);
export const POST = (p, b) => api("POST", p, b ?? {});
export const PUT = (p, b) => api("PUT", p, b ?? {});
export const PATCH = (p, b) => api("PATCH", p, b ?? {});
export const DEL = (p) => api("DELETE", p);

/** 把物件轉成查詢字串，略過空值。 */
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
