// 書目與館藏冊：查詢、新增、編輯、狀態變更、標籤列印資料。
import { Router } from "express";
import { requireAdmin } from "../auth";
import { deleteCover, saveCoverDataUrl } from "../covers";
import { all, get, nextAccessionNo, run, tx } from "../db";
import { bad, h, intParam, notFound, str } from "../http";
import { lookupIsbn, normalizeIsbn } from "../isbn";
import { nowText } from "../utils/time";

const router = Router();

export const STATUS_LABEL: Record<string, string> = {
  available: "在架",
  on_loan: "借出",
  lost: "遺失",
  withdrawn: "註銷",
};

const coverUrl = (p: unknown) => (p ? `/covers/${p}` : null);

/** 把搜尋字串轉成 LIKE 條件，比對書名、作者、出版社、ISBN、登錄號。 */
function searchClause(q: string): { sql: string; params: string[] } {
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const w of words) {
    const like = `%${w.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    parts.push(
      `(b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\' OR b.publisher LIKE ? ESCAPE '\\'
        OR b.isbn LIKE ? ESCAPE '\\' OR b.classification_no LIKE ? ESCAPE '\\' OR b.author_no LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM copies c2 WHERE c2.book_id = b.id AND c2.accession_no LIKE ? ESCAPE '\\'))`
    );
    params.push(like, like, like, like, like, like, like);
  }
  return { sql: parts.join(" AND "), params };
}

// ---------- 查詢 ----------

router.get(
  "/books",
  h((req, res) => {
    const q = str(req.query.q, 100);
    const category = str(req.query.category, 50);
    const status = str(req.query.status, 20);

    const { sql: searchSql, params } = searchClause(q);
    const whereParts: string[] = [];
    if (searchSql) whereParts.push(searchSql);

    if (category) {
      if (category === "none") {
        whereParts.push("(b.classification_no IS NULL OR TRIM(b.classification_no) = '')");
      } else if (/^\d$/.test(category)) {
        whereParts.push("b.classification_no LIKE ?");
        params.push(`${category}%`);
      } else {
        whereParts.push("b.classification_no LIKE ?");
        params.push(`${category}%`);
      }
    }

    let havingClause = "";
    if (status === "available") {
      havingClause = "HAVING available > 0";
    } else if (status === "on_loan") {
      havingClause = "HAVING total > 0 AND available = 0";
    }

    const whereClause = whereParts.length ? "WHERE " + whereParts.join(" AND ") : "";

    const rows = all(
      `SELECT b.id, b.isbn, b.title, b.author, b.publisher, b.classification_no AS classificationNo, b.author_no AS authorNo,
              b.cover_path AS coverPath, b.created_at AS createdAt,
              SUM(CASE WHEN c.status IN ('available','on_loan') THEN 1 ELSE 0 END) AS total,
              SUM(CASE WHEN c.status = 'available' THEN 1 ELSE 0 END) AS available,
              SUM(CASE WHEN c.status = 'on_loan' THEN 1 ELSE 0 END) AS onLoan,
              SUM(CASE WHEN c.id IS NOT NULL AND c.label_printed = 0 AND c.status IN ('available','on_loan') THEN 1 ELSE 0 END) AS unprinted
         FROM books b LEFT JOIN copies c ON c.book_id = b.id
        ${whereClause}
        GROUP BY b.id
        ${havingClause}
        ORDER BY ${q ? "b.title" : "b.created_at DESC, b.id DESC"}
        LIMIT 300`,
      ...params
    );
    res.json(rows.map((r) => ({ ...r, coverUrl: coverUrl(r.coverPath), coverPath: undefined })));
  })
);

/** 取得分類統計（十進分類法十大類 + 未分類）。 */
router.get(
  "/categories",
  h((_req, res) => {
    const rawCounts = all<{ prefix: string; count: number }>(
      `SELECT SUBSTR(TRIM(classification_no), 1, 1) AS prefix, COUNT(*) AS count
         FROM books
        WHERE classification_no IS NOT NULL AND TRIM(classification_no) <> ''
        GROUP BY prefix`
    );
    const unclassified = get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM books WHERE classification_no IS NULL OR TRIM(classification_no) = ''`
    )!.count;
    const total = get<{ count: number }>("SELECT COUNT(*) AS count FROM books")!.count;

    res.json({
      total,
      unclassified,
      counts: Object.fromEntries(rawCounts.map((r) => [r.prefix, r.count])),
    });
  })
);

function bookDetail(id: number) {
  const book = get(
    `SELECT id, isbn, title, author, publisher, classification_no AS classificationNo, author_no AS authorNo,
            cover_path AS coverPath, note, created_at AS createdAt, updated_at AS updatedAt
       FROM books WHERE id = ?`,
    id
  );
  if (!book) throw notFound("找不到這本書");
  const copies = all(
    `SELECT c.id, c.accession_no AS accessionNo, c.status, c.label_printed AS labelPrinted, c.note, c.created_at AS createdAt,
            l.id AS loanId, l.due_at AS dueAt, l.loaned_at AS loanedAt, u.name AS borrowerName, cl.name AS borrowerClass,
            (SELECT COUNT(*) FROM loans x WHERE x.copy_id = c.id) AS loanCount
       FROM copies c
       LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_at IS NULL
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN classes cl ON cl.id = l.class_id_at_loan
      WHERE c.book_id = ?
      ORDER BY c.accession_no`,
    id
  );
  return {
    ...book,
    coverUrl: coverUrl(book.coverPath),
    coverPath: undefined,
    copies: copies.map((c) => ({ ...c, labelPrinted: !!c.labelPrinted, statusLabel: STATUS_LABEL[String(c.status)] })),
  };
}

router.get(
  "/books/:id",
  h((req, res) => {
    res.json(bookDetail(intParam(req.params.id)));
  })
);

/** 新增書籍時先檢查 ISBN 是否已建檔。 */
router.get(
  "/isbn/:isbn/local",
  requireAdmin,
  h((req, res) => {
    const isbn = normalizeIsbn(String(req.params.isbn));
    if (!isbn) throw bad("ISBN 格式或檢查碼錯誤，請再確認一次");
    const book = get<{ id: number }>("SELECT id FROM books WHERE isbn = ?", isbn);
    res.json({ isbn, book: book ? bookDetail(book.id) : null });
  })
);

/** 線上查詢書目資料。 */
router.get(
  "/isbn/:isbn/lookup",
  requireAdmin,
  h(async (req, res) => {
    const isbn = normalizeIsbn(String(req.params.isbn));
    if (!isbn) throw bad("ISBN 格式或檢查碼錯誤，請再確認一次");
    res.json({ isbn, ...(await lookupIsbn(isbn)) });
  })
);

// ---------- 新增與編輯 ----------

function readBookBody(body: Record<string, unknown>) {
  const title = str(body?.title, 200);
  if (!title) throw bad("請輸入書名");
  const rawIsbn = str(body?.isbn, 20);
  let isbn: string | null = null;
  if (rawIsbn) {
    isbn = normalizeIsbn(rawIsbn);
    if (!isbn) throw bad("ISBN 格式或檢查碼錯誤；沒有 ISBN 的書請留空");
  }
  return {
    isbn,
    title,
    author: str(body?.author, 200),
    publisher: str(body?.publisher, 100),
    classificationNo: str(body?.classificationNo ?? body?.classification_no, 50),
    authorNo: str(body?.authorNo ?? body?.author_no, 50),
    note: str(body?.note, 500),
  };
}

function createCopies(bookId: number, count: number): string[] {
  const now = nowText();
  const nos: string[] = [];
  for (let i = 0; i < count; i++) {
    const no = nextAccessionNo();
    run("INSERT INTO copies (accession_no, book_id, created_at) VALUES (?, ?, ?)", no, bookId, now);
    nos.push(no);
  }
  return nos;
}

function readCount(v: unknown): number {
  const n = Number(v ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw bad("冊數需介於 1～50");
  return n;
}

router.post(
  "/books",
  requireAdmin,
  h((req, res) => {
    const data = readBookBody(req.body);
    const count = readCount(req.body?.copies);
    const coverData = typeof req.body?.coverData === "string" ? req.body.coverData : "";
    if (data.isbn && get("SELECT id FROM books WHERE isbn = ?", data.isbn)) throw bad("這個 ISBN 已經建檔，請改用「新增複本」");
    const result = tx(() => {
      const now = nowText();
      const r = run(
        "INSERT INTO books (isbn, title, author, publisher, classification_no, author_no, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        data.isbn,
        data.title,
        data.author,
        data.publisher,
        data.classificationNo,
        data.authorNo,
        data.note,
        now,
        now
      );
      const bookId = r.lastInsertRowid;
      if (coverData) run("UPDATE books SET cover_path = ? WHERE id = ?", saveCoverDataUrl(coverData, bookId), bookId);
      return { id: bookId, accessionNos: createCopies(bookId, count) };
    });
    res.json(result);
  })
);

router.put(
  "/books/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const old = get<{ cover_path: string | null }>("SELECT cover_path FROM books WHERE id = ?", id);
    if (!old) throw notFound("找不到這本書");
    const data = readBookBody(req.body);
    if (data.isbn && get("SELECT id FROM books WHERE isbn = ? AND id <> ?", data.isbn, id)) throw bad("這個 ISBN 已經被其他書目使用");
    let newCover: string | null | undefined;
    if (typeof req.body?.coverData === "string" && req.body.coverData) newCover = saveCoverDataUrl(req.body.coverData, id);
    else if (req.body?.removeCover === true) newCover = null;
    run(
      "UPDATE books SET isbn = ?, title = ?, author = ?, publisher = ?, classification_no = ?, author_no = ?, note = ?, updated_at = ? WHERE id = ?",
      data.isbn,
      data.title,
      data.author,
      data.publisher,
      data.classificationNo,
      data.authorNo,
      data.note,
      nowText(),
      id
    );
    if (newCover !== undefined) {
      run("UPDATE books SET cover_path = ? WHERE id = ?", newCover, id);
      deleteCover(old.cover_path);
    }
    res.json(bookDetail(id));
  })
);

/** 只有從未借出過的書目可以刪除（修正建檔錯誤用），其餘請用註銷。 */
router.delete(
  "/books/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const book = get<{ cover_path: string | null }>("SELECT cover_path FROM books WHERE id = ?", id);
    if (!book) throw notFound("找不到這本書");
    if (get("SELECT l.id FROM loans l JOIN copies c ON c.id = l.copy_id WHERE c.book_id = ? LIMIT 1", id)) {
      throw bad("這本書有借閱紀錄，不能刪除，請改用「註銷」");
    }
    tx(() => {
      run("DELETE FROM copies WHERE book_id = ?", id);
      run("DELETE FROM books WHERE id = ?", id);
    });
    deleteCover(book.cover_path);
    res.json({ ok: true });
  })
);

router.post(
  "/books/:id/copies",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    if (!get("SELECT id FROM books WHERE id = ?", id)) throw notFound("找不到這本書");
    const count = readCount(req.body?.count);
    const accessionNos = tx(() => createCopies(id, count));
    res.json({ accessionNos });
  })
);

// ---------- 單冊 ----------

router.patch(
  "/copies/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const copy = get<{ status: string; book_id: number }>("SELECT status, book_id FROM copies WHERE id = ?", id);
    if (!copy) throw notFound("找不到這一冊");
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!["available", "lost", "withdrawn"].includes(status)) throw bad("狀態不正確");
      if (copy.status === "on_loan") throw bad("這一冊目前借出中，請先辦理歸還，再變更狀態");
      run("UPDATE copies SET status = ? WHERE id = ?", status, id);
    }
    if (req.body?.note !== undefined) run("UPDATE copies SET note = ? WHERE id = ?", str(req.body.note, 200), id);
    res.json(bookDetail(copy.book_id));
  })
);

router.delete(
  "/copies/:id",
  requireAdmin,
  h((req, res) => {
    const id = intParam(req.params.id);
    const copy = get<{ book_id: number }>("SELECT book_id FROM copies WHERE id = ?", id);
    if (!copy) throw notFound("找不到這一冊");
    if (get("SELECT id FROM loans WHERE copy_id = ? LIMIT 1", id)) throw bad("這一冊有借閱紀錄，不能刪除，請改用「註銷」");
    run("DELETE FROM copies WHERE id = ?", id);
    res.json({ ok: true });
  })
);

// ---------- 標籤 ----------

/** 取得要列印標籤的冊。mode：unprinted（尚未列印）、range（登錄號範圍）、books（指定書目）、copies（指定冊）。 */
router.get(
  "/labels",
  requireAdmin,
  h((req, res) => {
    const mode = String(req.query.mode ?? "unprinted");
    const base = `SELECT c.id, c.accession_no AS accessionNo, c.label_printed AS labelPrinted, b.title
                    FROM copies c JOIN books b ON b.id = c.book_id
                   WHERE c.status IN ('available','on_loan')`;
    let rows;
    if (mode === "range") {
      const from = str(req.query.from, 20).toUpperCase();
      const to = str(req.query.to, 20).toUpperCase();
      if (!from || !to) throw bad("請輸入登錄號範圍");
      rows = all(`${base} AND c.accession_no BETWEEN ? AND ? ORDER BY c.accession_no`, from, to);
    } else if (mode === "books" || mode === "copies") {
      const ids = String(req.query.ids ?? "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 500);
      if (!ids.length) throw bad("請選擇要列印的書");
      const col = mode === "books" ? "c.book_id" : "c.id";
      rows = all(`${base} AND ${col} IN (${ids.map(() => "?").join(",")}) ORDER BY c.accession_no`, ...ids);
    } else {
      rows = all(`${base} AND c.label_printed = 0 ORDER BY c.accession_no`);
    }
    res.json(rows.map((r) => ({ ...r, labelPrinted: !!r.labelPrinted })));
  })
);

router.post(
  "/labels/mark-printed",
  requireAdmin,
  h((req, res) => {
    const ids = (Array.isArray(req.body?.copyIds) ? req.body.copyIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    tx(() => {
      for (const id of ids) run("UPDATE copies SET label_printed = 1 WHERE id = ?", id);
    });
    res.json({ count: ids.length });
  })
);

export default router;
