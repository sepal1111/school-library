import type { NextFunction, Request, RequestHandler, Response } from "express";

/** 可預期的錯誤（輸入錯誤、權限不足等），訊息會直接顯示給使用者。 */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = "找不到資料") => new HttpError(404, msg);

/** 包裝 route handler：同步或非同步錯誤都交給統一的錯誤處理。 */
export function h(fn: (req: Request, res: Response) => unknown): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = fn(req, res);
      if (r instanceof Promise) r.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

export function intParam(v: unknown, name = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${name} 格式錯誤`);
  return n;
}

export function str(v: unknown, max = 500): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const e = err as { type?: string; code?: string; message?: string };
  if (e?.type === "entity.too.large" || e?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "檔案太大" });
    return;
  }
  console.error("[錯誤]", err);
  res.status(500).json({ error: "系統發生錯誤，請稍後再試" });
}
