// 封面圖片存在 bin/covers/。前端已經先縮圖並轉成 JPEG（長邊 600px），伺服器只檢查格式與大小。
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { bad } from "./http";
import { getCoversDir } from "./paths";

const MAX_BYTES = 2 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

/** 把 data URL 存成檔案，回傳檔名。 */
export function saveCoverDataUrl(dataUrl: string, bookId: number): string {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m || !EXT[m[1]]) throw bad("封面圖片格式不正確");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_BYTES) throw bad("封面圖片太大");
  const name = `b${bookId}-${crypto.randomBytes(4).toString("hex")}${EXT[m[1]]}`;
  fs.writeFileSync(path.join(getCoversDir(), name), buf);
  return name;
}

export function deleteCover(name: string | null | undefined): void {
  if (!name || name.includes("/") || name.includes("\\")) return;
  try {
    fs.unlinkSync(path.join(getCoversDir(), name));
  } catch {
    /* 已不存在 */
  }
}
