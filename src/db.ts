// SQLite 資料庫（Node 內建 node:sqlite，不需要原生模組，打包成 exe 也能直接使用）。
// 每次啟動都執行等冪的 CREATE TABLE IF NOT EXISTS，資料庫位置在執行時才決定（bin/library.db）。
import fs from "fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import bcrypt from "bcryptjs";
import { getDbPath } from "./paths";
import { nowText } from "./utils/time";

let current: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (!current) throw new Error("資料庫尚未開啟");
  return current;
}

export type Params = SQLInputValue[];
export type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, ...params: Params): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: Params): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Params): { changes: number; lastInsertRowid: number } {
  const r = db().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** 包在交易中執行；fn 丟出錯誤時整批復原。 */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_admin_group INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('admin','teacher')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn TEXT UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  classification_no TEXT NOT NULL DEFAULT '',
  author_no TEXT NOT NULL DEFAULT '',
  cover_path TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accession_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  book_id INTEGER NOT NULL REFERENCES books(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_loan','lost','withdrawn')),
  label_printed INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copies_book ON copies(book_id);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  copy_id INTEGER NOT NULL REFERENCES copies(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  class_id_at_loan INTEGER NOT NULL REFERENCES classes(id),
  loaned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  loan_handled_by INTEGER REFERENCES users(id),
  return_handled_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_loans_copy ON loans(copy_id);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_open ON loans(returned_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 系統設定的預設值；資料庫沒有該鍵時使用。 */
export const DEFAULT_SETTINGS = {
  loanDays: 30,
  maxLoansPerUser: 10,
  accessionPrefix: "K",
  accessionDigits: 4,
  nextAccession: 1,
  schoolName: "",
  labelCols: 3,
  labelRows: 10,
  labelWidthMm: 70,
  labelHeightMm: 29.7,
  labelPageTopMm: 0,
  labelPageLeftMm: 0,
  labelGapXMm: 0,
  labelGapYMm: 0,
  labelShowSchool: true,
  lastBackupAt: "",
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

export function getSettings(): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* 忽略損壞的值，沿用預設 */
    }
  }
  return out as Settings;
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value)
  );
}

export const ADMIN_GROUP_NAME = "純行政";

export interface InitResult {
  createdAdmin: boolean;
}

/** 建立資料表與預設資料：「純行政」班級，以及第一次啟動時的管理員帳號 admin／admin。 */
function bootstrap(): InitResult {
  db().exec(SCHEMA);

  // 資料表欄位升級（新增 classification_no、author_no）
  const bookCols = all<{ name: string }>("PRAGMA table_info(books)").map((c) => c.name);
  if (!bookCols.includes("classification_no")) {
    db().exec("ALTER TABLE books ADD COLUMN classification_no TEXT NOT NULL DEFAULT ''");
  }
  if (!bookCols.includes("author_no")) {
    db().exec("ALTER TABLE books ADD COLUMN author_no TEXT NOT NULL DEFAULT ''");
  }

  if (!get("SELECT id FROM classes WHERE is_admin_group = 1")) {
    run("INSERT INTO classes (name, sort_order, is_admin_group) VALUES (?, 999, 1)", ADMIN_GROUP_NAME);
  }

  let createdAdmin = false;
  const userCount = get<{ c: number }>("SELECT COUNT(*) AS c FROM users")!.c;
  if (userCount === 0) {
    const adminClass = get<{ id: number }>("SELECT id FROM classes WHERE is_admin_group = 1")!;
    run(
      `INSERT INTO users (username, password_hash, name, class_id, role, must_change_password, created_at)
       VALUES ('admin', ?, '系統管理員', ?, 'admin', 1, ?)`,
      bcrypt.hashSync("admin", 10),
      adminClass.id,
      nowText()
    );
    createdAdmin = true;
  }

  run("DELETE FROM sessions WHERE expires_at < ?", nowText());
  return { createdAdmin };
}

export function openDb(): InitResult {
  const dbPath = getDbPath();
  current = new DatabaseSync(dbPath);
  current.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return bootstrap();
}

export function closeDb(): void {
  if (current) {
    try {
      current.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      /* ignore */
    }
    current.close();
    current = null;
  }
}

/** 用另一個資料庫檔取代目前的資料庫（還原備份用）。 */
export function replaceDbFile(newFile: string): void {
  const dbPath = getDbPath();
  closeDb();
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* 不存在就略過 */
    }
  }
  fs.copyFileSync(newFile, dbPath);
  openDb();
}

/** 產生下一個登錄號，計數器只增不減，刪除的號碼不回收。必須在交易中呼叫。 */
export function nextAccessionNo(): string {
  const s = getSettings();
  let n = s.nextAccession;
  const digits = Math.max(1, Math.min(10, s.accessionDigits));
  for (;;) {
    const candidate = `${s.accessionPrefix}${String(n).padStart(digits, "0")}`;
    n += 1;
    if (!get("SELECT id FROM copies WHERE accession_no = ?", candidate)) {
      setSetting("nextAccession", n);
      return candidate;
    }
  }
}
