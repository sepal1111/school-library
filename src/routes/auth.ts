import bcrypt from "bcryptjs";
import { Router } from "express";
import {
  COOKIE,
  checkLock,
  clearFailures,
  createSession,
  destroySession,
  destroyUserSessions,
  loadUser,
  recordFailure,
  setSessionCookie,
  validatePassword,
} from "../auth";
import { get, getSettings, run } from "../db";
import { HttpError, bad, h, str } from "../http";

const router = Router();

router.post(
  "/login",
  h((req, res) => {
    const username = str(req.body?.username, 50);
    const password = String(req.body?.password ?? "");
    if (!username || !password) throw bad("請輸入帳號與密碼");
    checkLock(username);
    const user = get<{ id: number; password_hash: string; active: number }>(
      "SELECT id, password_hash, active FROM users WHERE username = ?",
      username
    );
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordFailure(username);
      throw new HttpError(401, "帳號或密碼錯誤");
    }
    if (!user.active) throw new HttpError(403, "此帳號已停用，請洽管理員");
    clearFailures(username);
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: loadUser(token) });
  })
);

router.post(
  "/logout",
  h((req, res) => {
    destroySession(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  })
);

/** 目前登入者；未登入時回傳 user: null（不視為錯誤，前端據此顯示登入頁）。 */
router.get(
  "/me",
  h((req, res) => {
    const user = loadUser(req.cookies?.[COOKIE]) ?? null;
    res.json({ user, schoolName: getSettings().schoolName });
  })
);

/** 修改自己的密碼。強制改密碼狀態下也能呼叫，所以不經過 requireLogin。 */
router.post(
  "/change-password",
  h((req, res) => {
    const token = req.cookies?.[COOKIE];
    const user = loadUser(token);
    if (!user) throw new HttpError(401, "請先登入", "LOGIN_REQUIRED");
    const oldPw = String(req.body?.oldPassword ?? "");
    const newPw = String(req.body?.newPassword ?? "");
    const row = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!;
    if (!bcrypt.compareSync(oldPw, row.password_hash)) throw bad("目前的密碼不正確");
    validatePassword(newPw);
    if (newPw === oldPw) throw bad("新密碼不能和目前的密碼相同");
    run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", bcrypt.hashSync(newPw, 10), user.id);
    destroyUserSessions(user.id, token);
    res.json({ user: loadUser(token) });
  })
);

export default router;
