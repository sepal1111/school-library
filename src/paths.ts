// 可攜式部署：exe 旁邊放 system/（前端檔案），執行時在 exe 旁建立 bin/（資料庫、封面、憑證、備份）。
// 所有路徑都以執行檔所在位置為準，不依賴目前工作目錄。
import fs from "fs";
import path from "path";

export function isPackaged(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

/** 程式根目錄：打包時為 exe 所在資料夾，開發時為專案根目錄。 */
export function getAppDir(): string {
  if (isPackaged()) return path.dirname(process.execPath);
  return path.resolve(__dirname, "..");
}

/** 前端靜態檔位置：打包時在 exe 旁的 system/static，開發時在專案的 static/。 */
export function getStaticDir(): string {
  if (isPackaged()) return path.join(getAppDir(), "system", "static");
  return path.join(getAppDir(), "static");
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const getBinDir = () => ensureDir(path.join(getAppDir(), "bin"));
export const getCoversDir = () => ensureDir(path.join(getBinDir(), "covers"));
export const getBackupsDir = () => ensureDir(path.join(getBinDir(), "backups"));
export const getCertsDir = () => ensureDir(path.join(getBinDir(), "certs"));
export const getTmpDir = () => ensureDir(path.join(getBinDir(), "tmp"));
export const getDbPath = () => process.env.SCHOOL_LIB_DB_PATH || process.env.KYPS_LIB_DB_PATH || path.join(getBinDir(), "library.db");
