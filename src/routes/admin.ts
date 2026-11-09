// 管理功能：班級、老師帳號、系統設定。
import bcrypt from "bcryptjs";
import { Router } from "express";
import { destroyUserSessions, requireAdmin, validatePassword } from "../auth";
import { DEFAULT_SETTINGS, type SettingKey, all, get, getSettings, run, setSetting, tx } from "../db";
import { bad, h, intParam, notFound, str } from "../http";
import { nowText } from "../utils/time";

const router = Router();

// ---------- 班級 ----------

/** 所有登入者都能讀（借書時要顯示班級）。 */
router.get(
  "/classes",
  h((req, res) => {
    const includeInactive = req.query.all === "1" && req.user?.role === "admin";
    const rows = all(
      `SELECT c.id, c.name, c.sort_order AS sortOrder, c.active, c.is_admin_group AS isAdminGroup,
              (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.active = 1) AS userCount
         FROM classes c ${includeInactive ? "" : "WHERE c.active = 1"}
        ORDER BY c.sort_order, c.id`
    );
    res.json(rows.map((r) => ({ ...r, active: !!r.active, isAdminGroup: !!r.isAdminGroup })));
  })
);

router.post(
  "/classes",
  requireAdmin,
  h((req, res) => {
    const name = str(req.body?.name, 30);
    if (!name) throw bad("請輸入班級名稱");
    if (get("SELECT id FROM classes WHERE name = ?", name)) throw bad("班級名稱重複");
    const max = get<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM classes WHERE is_admin_group = 0")!.m ?? 0;
    const r = run("INSERT INTO classes (name, sort_order) VALUES (?, ?)", name, max + 1);
    res.json({ id: r.lastInsertRowid });
  })
);

router.put(
  "/classes/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const cls = get<{ is_admin_group: number }>("SELECT is_admin_group FROM classes WHERE id = ?", id);
    if (!cls) throw notFound("找不到班級");
    const name = str(req.body?.name, 30);
    if (!name) throw bad("請輸入班級名稱");
    if (get("SELECT id FROM classes WHERE name = ? AND id <> ?", name, id)) throw bad("班級名稱重複");
    const active = req.body?.active === false ? 0 : 1;
    if (!active && cls.is_admin_group) throw bad("「純行政」不能停用");
    if (!active && get("SELECT id FROM users WHERE class_id = ? AND active = 1", id)) {
      throw bad("這個班級還有啟用中的老師，請先把老師移到其他班級");
    }
    const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : null;
    run("UPDATE classes SET name = ?, active = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?", name, active, sortOrder, id);
    res.json({ ok: true });
  })
);

// ---------- 老師帳號 ----------

router.get(
  "/users",
  requireAdmin,
  h((_req, res) => {
    const rows = all(
      `SELECT u.id, u.username, u.name, u.role, u.class_id AS classId, c.name AS className, u.active,
              u.must_change_password AS mustChangePassword,
              (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL) AS activeLoans
         FROM users u JOIN classes c ON c.id = u.class_id
        ORDER BY u.active DESC, c.sort_order, u.name`
    );
    res.json(rows.map((r) => ({ ...r, active: !!r.active, mustChangePassword: !!r.mustChangePassword })));
  })
);

function readUserBody(body: Record<string, unknown>) {
  const name = str(body?.name, 30);
  if (!name) throw bad("請輸入姓名");
  const classId = intParam(body?.classId, "班級");
  const role = body?.role === "admin" ? "admin" : "teacher";
  if (!get("SELECT id FROM classes WHERE id = ? AND active = 1", classId)) throw bad("請選擇班級");
  return { name, classId, role };
}

function activeAdminCount(excludeId: number): number {
  return get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", excludeId)!.c;
}

router.post(
  "/users",
  requireAdmin,
  h((req, res) => {
    const { name, classId, role } = readUserBody(req.body);
    const username = str(req.body?.username, 30);
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(username)) throw bad("帳號只能使用英文、數字和 . _ -，長度 2～30 字");
    if (get("SELECT id FROM users WHERE username = ?", username)) throw bad("這個帳號已經有人使用");
    const password = String(req.body?.password ?? "");
    validatePassword(password);
    const r = run(
      `INSERT INTO users (username, password_hash, name, class_id, role, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      username,
      bcrypt.hashSync(password, 10),
      name,
      classId,
      role,
      nowText()
    );
    res.json({ id: r.lastInsertRowid });
  })
);

router.put(
  "/users/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const user = get<{ role: string; active: number }>("SELECT role, active FROM users WHERE id = ?", id);
    if (!user) throw notFound("找不到帳號");
    const { name, classId, role } = readUserBody(req.body);
    const active = req.body?.active === false ? 0 : 1;
    const losesAdmin = user.role === "admin" && user.active && (role !== "admin" || !active);
    if (losesAdmin && activeAdminCount(id) === 0) throw bad("至少要保留一位啟用中的管理員");
    run("UPDATE users SET name = ?, class_id = ?, role = ?, active = ? WHERE id = ?", name, classId, role, active, id);
    if (!active) destroyUserSessions(id);
    res.json({ ok: true });
  })
);

router.post(
  "/users/:id/reset-password",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    if (!get("SELECT id FROM users WHERE id = ?", id)) throw notFound("找不到帳號");
    const password = String(req.body?.password ?? "");
    validatePassword(password);
    run("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", bcrypt.hashSync(password, 10), id);
    destroyUserSessions(id);
    res.json({ ok: true });
  })
);

// ---------- 系統設定 ----------

router.get(
  "/settings",
  h((_req, res) => {
    res.json(getSettings());
  })
);

type Rule = { min?: number; max?: number; maxLen?: number; int?: boolean };

/** 可由管理員修改的設定，以及每項的範圍。 */
const EDITABLE: Partial<Record<SettingKey, Rule>> = {
  loanDays: { min: 1, max: 365, int: true },
  maxLoansPerUser: { min: 1, max: 200, int: true },
  accessionPrefix: { maxLen: 5 },
  accessionDigits: { min: 3, max: 8, int: true },
  schoolName: { maxLen: 40 },
  labelCols: { min: 1, max: 8, int: true },
  labelRows: { min: 1, max: 30, int: true },
  labelWidthMm: { min: 20, max: 210 },
  labelHeightMm: { min: 10, max: 297 },
  labelPageTopMm: { min: 0, max: 50 },
  labelPageLeftMm: { min: 0, max: 50 },
  labelGapXMm: { min: 0, max: 20 },
  labelGapYMm: { min: 0, max: 20 },
  labelShowSchool: {},
};

router.put(
  "/settings",
  requireAdmin,
  h((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    tx(() => {
      for (const [key, rule] of Object.entries(EDITABLE) as Array<[SettingKey, Rule]>) {
        if (!(key in body)) continue;
        const def = DEFAULT_SETTINGS[key];
        const v = body[key];
        if (typeof def === "number") {
          const n = Number(v);
          if (!Number.isFinite(n) || n < (rule.min ?? -Infinity) || n > (rule.max ?? Infinity)) {
            throw bad(`設定值超出範圍（${rule.min}～${rule.max}）`);
          }
          setSetting(key, (rule.int ? Math.round(n) : Math.round(n * 10) / 10) as never);
        } else if (typeof def === "boolean") {
          setSetting(key, Boolean(v) as never);
        } else {
          let s = str(v, rule.maxLen ?? 100);
          if (key === "accessionPrefix") {
            if (!/^[A-Za-z]{0,5}$/.test(s)) throw bad("登錄號字首只能是英文字母（最多 5 個）");
            s = s.toUpperCase();
          }
          setSetting(key, s as never);
        }
      }
    });
    res.json(getSettings());
  })
);

export default router;
