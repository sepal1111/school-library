// 備份：資料庫快照（VACUUM INTO，確保一致）＋封面圖片，打包成 zip 存在 bin/backups/。
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { NEWER_DB_MESSAGE, SCHEMA_VERSION, db, readSchemaVersion, replaceDbFile, setSetting } from "./db";
import { bad } from "./http";
import { getBackupsDir, getCoversDir, getTmpDir } from "./paths";
import { nowText, stamp } from "./utils/time";
import { VERSION } from "./version";

const KEEP_AUTO = 10;
const NAME_RE = /^library-(auto|manual|before-restore)-\d{8}-\d{6}\.zip$/;

export function isBackupName(name: string): boolean {
  return NAME_RE.test(name);
}

export function createBackup(kind: "auto" | "manual" | "before-restore"): string {
  const tmpDb = path.join(getTmpDir(), `snapshot-${Date.now()}.db`);
  db().exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  try {
    const zip = new AdmZip();
    zip.addLocalFile(tmpDb, "", "library.db");
    const coversDir = getCoversDir();
    for (const f of fs.readdirSync(coversDir)) zip.addLocalFile(path.join(coversDir, f), "covers");
    zip.addFile("backup-info.json", Buffer.from(JSON.stringify({ app: "school-library", version: VERSION, schemaVersion: SCHEMA_VERSION, createdAt: nowText(), kind }, null, 2)));
    // 同一秒內重複備份時，往後順延一秒命名，避免覆蓋
    let name = "";
    for (let k = 0; !name || fs.existsSync(path.join(getBackupsDir(), name)); k++) {
      name = `library-${kind}-${stamp(new Date(Date.now() + k * 1000))}.zip`;
    }
    zip.writeZip(path.join(getBackupsDir(), name));
    if (kind !== "before-restore") setSetting("lastBackupAt", nowText());
    if (kind === "auto") pruneAutoBackups();
    return name;
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }
}

function pruneAutoBackups(): void {
  const autos = fs
    .readdirSync(getBackupsDir())
    .filter((f) => f.startsWith("library-auto-") && isBackupName(f))
    .sort()
    .reverse();
  for (const f of autos.slice(KEEP_AUTO)) fs.rmSync(path.join(getBackupsDir(), f), { force: true });
}

export function listBackups() {
  return fs
    .readdirSync(getBackupsDir())
    .filter(isBackupName)
    .map((name) => {
      const st = fs.statSync(path.join(getBackupsDir(), name));
      const kind = name.split("-")[1];
      return { name, size: st.size, createdAt: nowText(st.mtime), kind };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 從 zip 還原。先驗證內容，再自動備份目前資料，最後取代資料庫與封面。 */
export function restoreFromZip(zipPath: string): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw bad("檔案不是有效的備份檔（zip）");
  }
  const dbEntry = zip.getEntry("library.db");
  if (!dbEntry) throw bad("備份檔裡找不到資料庫，請確認是本系統產生的備份檔");

  const tmpDb = path.join(getTmpDir(), `restore-${Date.now()}.db`);
  fs.writeFileSync(tmpDb, dbEntry.getData());
  try {
    // 確認是本系統的資料庫
    const probe = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      for (const t of ["books", "copies", "loans", "users", "classes"]) {
        if (!probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)) {
          throw bad("備份檔的資料格式不正確");
        }
      }
      // 較新版本產生的備份不能還原到舊版程式；較舊的備份還原後會在開啟時自動升級
      if (readSchemaVersion(probe) > SCHEMA_VERSION) throw bad(`${NEWER_DB_MESSAGE}，無法在這個版本還原`);
    } finally {
      probe.close();
    }

    createBackup("before-restore");
    replaceDbFile(tmpDb);

    const coversDir = getCoversDir();
    for (const f of fs.readdirSync(coversDir)) fs.rmSync(path.join(coversDir, f), { force: true });
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith("covers/")) continue;
      const base = path.basename(entry.entryName);
      if (!/^[\w.-]+$/.test(base)) continue;
      fs.writeFileSync(path.join(coversDir, base), entry.getData());
    }
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }
}
