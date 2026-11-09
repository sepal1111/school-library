// Excel 匯出：借出清單、借閱紀錄、藏書清冊。
import ExcelJS from "exceljs";
import { Router, type Response } from "express";
import { requireAdmin } from "../auth";
import { all } from "../db";
import { h } from "../http";
import { todayText } from "../utils/time";
import { STATUS_LABEL } from "./books";
import { queryActiveLoans, queryHistory, readFilter } from "./loans";

const router = Router();

interface Col {
  header: string;
  key: string;
  width: number;
}

async function sendWorkbook(res: Response, filename: string, sheetName: string, cols: Col[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "幼兒園圖書借閱系統";
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols;
  ws.addRows(rows);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const name = `${filename}_${todayText().replace(/-/g, "")}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  await wb.xlsx.write(res);
  res.end();
}

router.get(
  "/export/active.xlsx",
  requireAdmin,
  h(async (req, res) => {
    const rows = queryActiveLoans(readFilter(req)).map((r) => ({ ...r, overdue: r.overdueDays || "" }));
    await sendWorkbook(res, "借出清單", "借出清單", [
      { header: "登錄號", key: "accessionNo", width: 10 },
      { header: "書名", key: "title", width: 36 },
      { header: "借閱老師", key: "borrowerName", width: 12 },
      { header: "班級", key: "className", width: 10 },
      { header: "借出時間", key: "loanedAt", width: 20 },
      { header: "應還日期", key: "dueAt", width: 12 },
      { header: "逾期天數", key: "overdue", width: 10 },
    ], rows);
  })
);

router.get(
  "/export/history.xlsx",
  requireAdmin,
  h(async (req, res) => {
    const rows = queryHistory(readFilter(req), 100000).map((r) => ({
      ...r,
      returnedAt: r.returnedAt ?? "（借出中）",
      overdue: r.overdueDays || "",
    }));
    await sendWorkbook(res, "借閱紀錄", "借閱紀錄", [
      { header: "登錄號", key: "accessionNo", width: 10 },
      { header: "書名", key: "title", width: 36 },
      { header: "ISBN", key: "isbn", width: 16 },
      { header: "借閱老師", key: "borrowerName", width: 12 },
      { header: "借出時班級", key: "className", width: 12 },
      { header: "借出時間", key: "loanedAt", width: 20 },
      { header: "應還日期", key: "dueAt", width: 12 },
      { header: "歸還時間", key: "returnedAt", width: 20 },
      { header: "逾期天數", key: "overdue", width: 10 },
      { header: "借出操作者", key: "loanHandledBy", width: 12 },
      { header: "歸還操作者", key: "returnHandledBy", width: 12 },
    ], rows);
  })
);

router.get(
  "/export/inventory.xlsx",
  requireAdmin,
  h(async (req, res) => {
    const status = String(req.query.status ?? "");
    const valid = ["available", "on_loan", "lost", "withdrawn"].includes(status);
    const rows = all(
      `SELECT c.accession_no AS accessionNo, b.title, b.author, b.publisher, b.isbn,
              b.classification_no AS classificationNo, b.author_no AS authorNo,
              c.status, c.note,
              c.created_at AS createdAt, u.name AS borrowerName, l.due_at AS dueAt
         FROM copies c JOIN books b ON b.id = c.book_id
         LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_at IS NULL
         LEFT JOIN users u ON u.id = l.user_id
        ${valid ? "WHERE c.status = ?" : ""}
        ORDER BY c.accession_no`,
      ...(valid ? [status] : [])
    ).map((r) => ({ ...r, status: STATUS_LABEL[String(r.status)], createdAt: String(r.createdAt).slice(0, 10) }));
    await sendWorkbook(res, "藏書清冊", "藏書清冊", [
      { header: "登錄號", key: "accessionNo", width: 10 },
      { header: "書名", key: "title", width: 36 },
      { header: "作者", key: "author", width: 20 },
      { header: "出版社", key: "publisher", width: 16 },
      { header: "ISBN", key: "isbn", width: 16 },
      { header: "分類號", key: "classificationNo", width: 12 },
      { header: "作者號", key: "authorNo", width: 12 },
      { header: "狀態", key: "status", width: 8 },
      { header: "借閱老師", key: "borrowerName", width: 12 },
      { header: "應還日期", key: "dueAt", width: 12 },
      { header: "建檔日期", key: "createdAt", width: 12 },
      { header: "備註", key: "note", width: 24 },
    ], rows);
  })
);

export default router;
