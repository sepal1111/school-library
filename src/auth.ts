// 登入狀態：隨機 token 存在 sessions 資料表，透過 httpOnly cookie 傳遞。
// 存在資料庫裡，所以關閉程式後再開啟，老師不必重新登入。
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { get, run } from "./db";
import { HttpError } from "./http";
import { nowText } from "./utils/time";

export const COOKIE = "kl_sid";
const SESSION_DAYS = 30;

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: "admin" | "teacher";
  classId: number;
  className: string;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = nowText(new Date(Date.now() + SESSION_DAYS * 86400000));
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, expires);
  return token;
}

export function destroySession(token: string | undefined): void {
  if (token) run("DELETE FROM sessions WHERE token = ?", token);
}

export function destroyUserSessions(userId: number, exceptToken?: string): void {
  run("DELETE FROM sessions WHERE user_id = ? AND token <> ?", userId, exceptToken ?? "");
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_DAYS * 86400000, path: "/" });
}

export function loadUser(token: string | undefined): AuthUser | undefined {
  if (!token) return undefined;
  const row = get<{
    id: number;
    username: string;
    name: string;
    role: "admin" | "teacher";
    class_id: number;
    class_name: string;
    must_change_password: number;
  }>(
    `SELECT u.id, u.username, u.name, u.role, u.class_id, c.name AS class_name, u.must_change_password
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN classes c ON c.id = u.class_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token,
    nowText()
  );
  if (!row) return undefined;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    classId: row.class_id,
    className: row.class_name,
    mustChangePassword: !!row.must_change_password,
  };
}

/** 掛在所有 /api 上：讀取登入者；未登入或需要先改密碼時擋下。 */
export function requireLogin(req: Request, _res: Response, next: NextFunction): void {
  const user = loadUser(req.cookies?.[COOKIE]);
  if (!user) return next(new HttpError(401, "請先登入", "LOGIN_REQUIRED"));
  req.user = user;
  if (user.mustChangePassword) {
    return next(new HttpError(403, "請先修改密碼", "MUST_CHANGE_PASSWORD"));
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") return next(new HttpError(403, "只有管理員可以使用這個功能"));
  next();
}

// 登入失敗鎖定：同一帳號連續錯 5 次，鎖 5 分鐘（只存在記憶體，重新啟動就解除）。
const failures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function checkLock(username: string): void {
  const f = failures.get(username.toLowerCase());
  if (f && f.lockedUntil > Date.now()) {
    const min = Math.ceil((f.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `密碼錯誤次數過多，請 ${min} 分鐘後再試`);
  }
}

export function recordFailure(username: string): void {
  const key = username.toLowerCase();
  const f = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.lockedUntil = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(key, f);
}

export function clearFailures(username: string): void {
  failures.delete(username.toLowerCase());
}

export function validatePassword(pw: string): void {
  if (pw.length < 6) throw new HttpError(400, "密碼至少需要 6 個字元");
  if (pw.length > 100) throw new HttpError(400, "密碼太長");
}
