// 借書、還書、借出清單、借閱紀錄、首頁統計。
import { Router } from "express";
import { all, get, getSettings, run, tx } from "../db";
import { HttpError, bad, h, intParam, notFound, str } from "../http";
import { cleanIsbn, looksLikeIsbn, normalizeIsbn } from "../isbn";
import { recognizeAlphanumeric } from "../utils/ocr";
import { addDays, diffDays, nowText, todayText } from "../utils/time";
import { STATUS_LABEL } from "./books";

const router = Router();

interface CopyRow {
  id: number;
  accessionNo: string;
  status: string;
  bookId: number;
  title: string;
  author: string;
  coverPath: string | null;
  loanId: number | null;
  borrowerId: number | null;
  borrowerName: string | null;
  borrowerClass: string | null;
  loanedAt: string | null;
  dueAt: string | null;
}

const COPY_SELECT = `
  SELECT c.id, c.accession_no AS accessionNo, c.status, b.id AS bookId, b.title, b.author, b.cover_path AS coverPath,
         l.id AS loanId, l.user_id AS borrowerId, u.name AS borrowerName, cl.name AS borrowerClass,
         l.loaned_at AS loanedAt, l.due_at AS dueAt
    FROM copies c
    JOIN books b ON b.id = c.book_id
    LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_at IS NULL
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN classes cl ON cl.id = l.class_id_at_loan`;

function present(c: CopyRow) {
  const today = todayText();
  return {
    ...c,
    coverUrl: c.coverPath ? `/covers/${c.coverPath}` : null,
    coverPath: undefined,
    statusLabel: STATUS_LABEL[c.status],
    overdueDays: c.dueAt && today > c.dueAt ? diffDays(c.dueAt, today) : 0,
  };
}

/**
 * 掃描或輸入的代碼 → 對應的冊。
 * 先比對登錄號；不是登錄號且看起來像 ISBN 時，回傳該書所有可流通的冊，由前端讓使用者選。
 */
router.get(
  "/scan/:code",
  h((req, res) => {
    const code = str(req.params.code, 40);
    if (!code) throw bad("請輸入條碼");
    const byAccession = get<CopyRow>(`${COPY_SELECT} WHERE c.accession_no = ?`, code);
    if (byAccession) {
      res.json({ type: "copy", copies: [present(byAccession)] });
      return;
    }
    if (looksLikeIsbn(code)) {
      const isbn = normalizeIsbn(code) ?? cleanIsbn(code);
      const rows = all<CopyRow>(
        `${COPY_SELECT} WHERE b.isbn = ? AND c.status IN ('available','on_loan') ORDER BY c.accession_no`,
        isbn
      );
      if (!rows.length) throw notFound(`找不到 ISBN ${isbn} 的書，可能尚未建檔`);
      res.json({ type: "isbn", copies: rows.map(present) });
      return;
    }
    throw notFound(`找不到登錄號「${code}」`);
  })
);

/**
 * 鏡頭辨識英數字（OCR）：
 * 辨識影像中的文字，自動萃取 ISBN、登錄號、學號或英數代碼，並比對系統資料。
 */
router.post(
  "/scan/ocr",
  h(async (req, res) => {
    const img = str(req.body?.image, 10 * 1024 * 1024);
    if (!img) throw bad("請提供影像");
    const { rawText, candidates } = await recognizeAlphanumeric(img);

    // 1. 先比對登錄號
    for (const c of candidates) {
      const byAccession = get<CopyRow>(`${COPY_SELECT} WHERE c.accession_no = ?`, c);
      if (byAccession) {
        res.json({ matched: "copy", code: c, rawText, copies: [present(byAccession)] });
        return;
      }
    }

    // 2. 比對 ISBN
    for (const c of candidates) {
      if (looksLikeIsbn(c)) {
        const isbn = normalizeIsbn(c) ?? cleanIsbn(c);
        const rows = all<CopyRow>(
          `${COPY_SELECT} WHERE b.isbn = ? AND c.status IN ('available','on_loan') ORDER BY c.accession_no`,
          isbn
        );
        if (rows.length) {
          res.json({ matched: "isbn", code: isbn, rawText, copies: rows.map(present) });
          return;
        }
      }
    }

    // 3. 比對借閱者/使用者帳號 (username)
    for (const c of candidates) {
      const user = get<{ id: number; name: string }>(`SELECT id, name FROM users WHERE username = ?`, c);
      if (user) {
        res.json({ matched: "user", code: c, rawText, user });
        return;
      }
    }

    // 4. 無直接在庫紀錄時，回傳候選代碼
    res.json({
      matched: null,
      code: candidates[0] || null,
      candidates,
      rawText,
    });
  })
);

/** 搜尋書名找冊（借書／還書時不掃描、改用打字的情況）。status=available 或 on_loan。 */
router.get(
  "/copies/search",
  h((req, res) => {
    const q = str(req.query.q, 100);
    const status = req.query.status === "on_loan" ? "on_loan" : "available";
    if (!q) {
      res.json([]);
      return;
    }
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const rows = all<CopyRow>(
      `${COPY_SELECT}
        WHERE c.status = ? AND (b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\' OR c.accession_no LIKE ? ESCAPE '\\'
              OR u.name LIKE ? ESCAPE '\\')
        ORDER BY b.title, c.accession_no
        LIMIT 50`,
      status,
      like,
      like,
      like,
      like
    );
    res.json(rows.map(present));
  })
);

/** 管理員代借時的老師選單。 */
router.get(
  "/borrowers",
  h((req, res) => {
    if (req.user!.role !== "admin") {
      res.json([{ id: req.user!.id, name: req.user!.name, className: req.user!.className }]);
      return;
    }
    res.json(
      all(
        `SELECT u.id, u.name, c.name AS className,
                (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL) AS activeLoans
           FROM users u JOIN classes c ON c.id = u.class_id
          WHERE u.active = 1 ORDER BY c.sort_order, u.name`
      )
    );
  })
);

/** 借出。body：{ userId?, copyIds: number[] }。一般老師只能借給自己。 */
router.post(
  "/loans",
  h((req, res) => {
    const me = req.user!;
    const userId = req.body?.userId ? intParam(req.body.userId, "老師") : me.id;
    if (userId !== me.id && me.role !== "admin") throw new HttpError(403, "只能借給自己");
    const copyIds: number[] = [...new Set<number>((Array.isArray(req.body?.copyIds) ? req.body.copyIds : []).map(Number))];
    if (!copyIds.length || copyIds.some((n) => !Number.isInteger(n) || n <= 0)) throw bad("請先掃描要借的書");

    const borrower = get<{ id: number; name: string; class_id: number; active: number }>(
      "SELECT id, name, class_id, active FROM users WHERE id = ?",
      userId
    );
    if (!borrower || !borrower.active) throw bad("找不到這位老師，或帳號已停用");

    const s = getSettings();
    const result = tx(() => {
      const current = get<{ c: number }>("SELECT COUNT(*) AS c FROM loans WHERE user_id = ? AND returned_at IS NULL", userId)!.c;
      if (current + copyIds.length > s.maxLoansPerUser) {
        throw bad(`超過借閱上限：每人最多 ${s.maxLoansPerUser} 本，${borrower.name}目前已借 ${current} 本`);
      }
      const now = nowText();
      const due = addDays(todayText(), s.loanDays);
      const done: Array<{ loanId: number; copyId: number; accessionNo: string; title: string }> = [];
      for (const copyId of copyIds) {
        const c = get<CopyRow>(`${COPY_SELECT} WHERE c.id = ?`, copyId);
        if (!c) throw bad("找不到其中一本書");
        if (c.status === "on_loan") throw bad(`${c.accessionNo}《${c.title}》已被${c.borrowerName ?? "其他人"}借出`);
        if (c.status !== "available") throw bad(`${c.accessionNo}《${c.title}》目前狀態為「${STATUS_LABEL[c.status]}」，不能借出`);
        const ins = run(
          `INSERT INTO loans (copy_id, user_id, class_id_at_loan, loaned_at, due_at, loan_handled_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          copyId,
          userId,
          borrower.class_id,
          now,
          due,
          me.id
        );
        run("UPDATE copies SET status = 'on_loan' WHERE id = ?", copyId);
        done.push({ loanId: Number(ins.lastInsertRowid), copyId, accessionNo: c.accessionNo, title: c.title });
      }
      return { borrower: borrower.name, dueAt: due, items: done };
    });
    res.json(result);
  })
);

/**
 * 取消借出：當天掃錯或輸入錯誤時使用。
 * 直接刪除這筆借閱（不列入借閱紀錄），書恢復在架。
 * 限當天借出、尚未歸還；一般老師只能取消自己借的或自己經手的，管理員可以取消任何一筆。
 */
router.delete(
  "/loans/:id",
  h((req, res) => {
    const me = req.user!;
    const id = intParam(req.params.id, "借閱");
    const loan = get<{ id: number; copyId: number; userId: number; handledBy: number | null; loanedAt: string; returnedAt: string | null; accessionNo: string; title: string }>(
      `SELECT l.id, l.copy_id AS copyId, l.user_id AS userId, l.loan_handled_by AS handledBy, l.loaned_at AS loanedAt,
              l.returned_at AS returnedAt, c.accession_no AS accessionNo, b.title
         FROM loans l JOIN copies c ON c.id = l.copy_id JOIN books b ON b.id = c.book_id
        WHERE l.id = ?`,
      id
    );
    if (!loan) throw notFound("找不到這筆借閱，可能已經取消");
    if (loan.returnedAt) throw bad(`${loan.accessionNo}《${loan.title}》已經歸還，不能取消借出`);
    if (loan.loanedAt.slice(0, 10) !== todayText()) throw bad("只能取消當天的借出；之前借出的書請用「還書」");
    if (me.role !== "admin" && loan.userId !== me.id && loan.handledBy !== me.id) throw new HttpError(403, "只能取消自己的借出");
    tx(() => {
      run("DELETE FROM loans WHERE id = ?", id);
      run("UPDATE copies SET status = 'available' WHERE id = ? AND status = 'on_loan'", loan.copyId);
    });
    res.json({ accessionNo: loan.accessionNo, title: loan.title });
  })
);

/** 歸還。body：{ copyId }。任何登入者都可以歸還任何一冊，並記錄操作者。 */
router.post(
  "/returns",
  h((req, res) => {
    const copyId = intParam(req.body?.copyId, "書");
    const c = get<CopyRow>(`${COPY_SELECT} WHERE c.id = ?`, copyId);
    if (!c) throw notFound("找不到這本書");
    if (c.status !== "on_loan" || !c.loanId) throw bad(`${c.accessionNo}《${c.title}》目前不是借出狀態，不需要歸還`);
    tx(() => {
      run("UPDATE loans SET returned_at = ?, return_handled_by = ? WHERE id = ?", nowText(), req.user!.id, c.loanId);
      run("UPDATE copies SET status = 'available' WHERE id = ?", copyId);
    });
    res.json({ item: present(c) });
  })
);

// ---------- 清單與紀錄 ----------

export interface LoanFilter {
  userId?: number;
  classId?: number;
  overdueOnly?: boolean;
  from?: string;
  to?: string;
  q?: string;
}

/** 一般老師只能看自己的；管理員可依條件篩選。 */
export function readFilter(req: { user?: { id: number; role: string }; query: Record<string, unknown> }): LoanFilter {
  const f: LoanFilter = {};
  const q = req.query;
  if (req.user!.role !== "admin") f.userId = req.user!.id;
  else if (q.userId) f.userId = intParam(q.userId, "老師");
  if (q.classId) f.classId = intParam(q.classId, "班級");
  if (q.overdue === "1") f.overdueOnly = true;
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  f.from = date(q.from);
  f.to = date(q.to);
  f.q = str(q.q, 100) || undefined;
  return f;
}

const LOAN_SELECT = `
  SELECT l.id, l.loaned_at AS loanedAt, l.due_at AS dueAt, l.returned_at AS returnedAt,
         c.id AS copyId, c.accession_no AS accessionNo, b.id AS bookId, b.title, b.author, b.isbn,
         u.id AS userId, u.name AS borrowerName, cl.name AS className,
         hb.name AS loanHandledBy, rb.name AS returnHandledBy
    FROM loans l
    JOIN copies c ON c.id = l.copy_id
    JOIN books b ON b.id = c.book_id
    JOIN users u ON u.id = l.user_id
    JOIN classes cl ON cl.id = l.class_id_at_loan
    LEFT JOIN users hb ON hb.id = l.loan_handled_by
    LEFT JOIN users rb ON rb.id = l.return_handled_by`;

export interface LoanRow {
  id: number;
  loanedAt: string;
  dueAt: string;
  returnedAt: string | null;
  copyId: number;
  accessionNo: string;
  bookId: number;
  title: string;
  author: string;
  isbn: string | null;
  userId: number;
  borrowerName: string;
  className: string;
  loanHandledBy: string | null;
  returnHandledBy: string | null;
  overdueDays: number;
  /** 今天借出且尚未歸還，可以「取消借出」。 */
  loanedToday: boolean;
}

function withOverdue(rows: Omit<LoanRow, "overdueDays" | "loanedToday">[]): LoanRow[] {
  const today = todayText();
  return rows.map((r) => {
    // 已歸還：以歸還日計算當時是否逾期；未歸還：以今天計算。
    const end = r.returnedAt ? r.returnedAt.slice(0, 10) : today;
    return {
      ...r,
      overdueDays: end > r.dueAt ? diffDays(r.dueAt, end) : 0,
      loanedToday: !r.returnedAt && r.loanedAt.slice(0, 10) === today,
    };
  });
}

export function queryActiveLoans(f: LoanFilter): LoanRow[] {
  const where = ["l.returned_at IS NULL"];
  const params: (string | number)[] = [];
  if (f.userId) (where.push("l.user_id = ?"), params.push(f.userId));
  if (f.classId) (where.push("l.class_id_at_loan = ?"), params.push(f.classId));
  if (f.overdueOnly) (where.push("l.due_at < ?"), params.push(todayText()));
  return withOverdue(all(`${LOAN_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.due_at, b.title`, ...params));
}

export function queryHistory(f: LoanFilter, limit = 1000): LoanRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.userId) (where.push("l.user_id = ?"), params.push(f.userId));
  if (f.classId) (where.push("l.class_id_at_loan = ?"), params.push(f.classId));
  if (f.from) (where.push("l.loaned_at >= ?"), params.push(f.from));
  if (f.to) (where.push("l.loaned_at < ?"), params.push(addDays(f.to, 1)));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push("(b.title LIKE ? ESCAPE '\\' OR c.accession_no LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return withOverdue(
    all(`${LOAN_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY l.loaned_at DESC, l.id DESC LIMIT ${limit}`, ...params)
  );
}

router.get(
  "/loans/active",
  h((req, res) => {
    res.json(queryActiveLoans(readFilter(req)));
  })
);

router.get(
  "/loans/history",
  h((req, res) => {
    res.json(queryHistory(readFilter(req), 500));
  })
);

/** 首頁資料：自己的借閱（含逾期），管理員另外有全館統計與逾期清單。 */
router.get(
  "/dashboard",
  h((req, res) => {
    const me = req.user!;
    const s = getSettings();
    const mine = queryActiveLoans({ userId: me.id });
    const out: Record<string, unknown> = {
      mine,
      loanDays: s.loanDays,
      maxLoansPerUser: s.maxLoansPerUser,
    };
    if (me.role === "admin") {
      const count = (sql: string) => get<{ c: number }>(sql)!.c;
      out.stats = {
        titles: count("SELECT COUNT(*) AS c FROM books"),
        copies: count("SELECT COUNT(*) AS c FROM copies WHERE status IN ('available','on_loan')"),
        available: count("SELECT COUNT(*) AS c FROM copies WHERE status = 'available'"),
        onLoan: count("SELECT COUNT(*) AS c FROM copies WHERE status = 'on_loan'"),
        unprinted: count("SELECT COUNT(*) AS c FROM copies WHERE label_printed = 0 AND status IN ('available','on_loan')"),
      };
      out.overdue = queryActiveLoans({ overdueOnly: true });
      out.lastBackupAt = s.lastBackupAt;
      out.backupDaysAgo = s.lastBackupAt ? diffDays(s.lastBackupAt.slice(0, 10), todayText()) : null;
    }
    res.json(out);
  })
);

export default router;
