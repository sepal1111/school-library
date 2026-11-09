// 記錄檔：可攜版沒有命令提示字元視窗，console 的輸出另外寫到 bin/logs/server.log，方便疑難排解。
// 超過 1 MB 時，啟動時把舊檔改名成 server.log.1（只保留一份舊檔）。
import fs from "fs";
import path from "path";
import util from "util";
import { nowText } from "./utils/time";

const MAX_SIZE = 1024 * 1024;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

let logFile: string | null = null;

export function getLogFile(): string | null {
  return logFile;
}

export function setupFileLog(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "server.log");
  try {
    if (fs.statSync(file).size > MAX_SIZE) fs.renameSync(file, `${file}.1`);
  } catch {
    /* 檔案不存在 */
  }
  logFile = file;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const text = util.format(...args).replace(ANSI_RE, "");
      const tag = level === "warn" ? " [警告]" : level === "error" ? " [錯誤]" : "";
      try {
        // 同步寫入：程式突然結束時，最後幾行也會留在檔案裡
        fs.appendFileSync(file, `[${nowText()}]${tag} ${text}\n`);
      } catch {
        /* 寫不進去就算了，不影響系統運作 */
      }
    };
  }
}
