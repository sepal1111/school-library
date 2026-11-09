// 純離線英數字 OCR 模組：
// 支援透過鏡頭辨識書背 ISBN 數字、條碼下方英數字、圖書登錄號貼紙與學生證號。
import fs from "fs";
import path from "path";
import { createWorker, Worker } from "tesseract.js";
import { HttpError } from "../http";
import { getOcrDir, isPackaged } from "../paths";

let workerPromise: Promise<Worker> | null = null;

/**
 * 找出 OCR 需要的檔案。缺檔時回傳原因。
 * tesseract.js 沒有監聽背景執行緒的 error 事件，找不到 worker 檔會讓整個程式結束，
 * 所以一定要在建立 worker 之前先確認檔案都在。
 */
function resolveOcrFiles(): { workerPath?: string; langPath: string } | { missing: string } {
  const dir = getOcrDir();
  if (!fs.existsSync(path.join(dir, "eng.traineddata"))) return { missing: path.join(dir, "eng.traineddata") };
  if (!isPackaged()) return { langPath: dir };

  const workerPath = path.join(dir, "worker.cjs");
  if (!fs.existsSync(workerPath)) return { missing: workerPath };
  if (!fs.existsSync(path.join(dir, "node_modules", "tesseract.js-core", "package.json"))) {
    return { missing: path.join(dir, "node_modules", "tesseract.js-core") };
  }
  return { workerPath, langPath: dir };
}

export async function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    const files = resolveOcrFiles();
    if ("missing" in files) {
      console.warn(`OCR 無法使用，缺少檔案：${files.missing}`);
      throw new HttpError(503, "辨識功能無法使用（缺少辨識檔案），請改用條碼掃描或手動輸入");
    }
    workerPromise = (async () => {
      // langPath 指向本機資料夾、cacheMethod: "none"：只讀本機的 eng.traineddata，不從網路下載，也不寫快取檔
      const worker = await createWorker("eng", 1, {
        ...(files.workerPath ? { workerPath: files.workerPath } : {}),
        langPath: files.langPath,
        cacheMethod: "none",
        gzip: false,
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-:/. ",
      });
      return worker;
    })();
    // 初始化失敗時清掉，下次再試
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export function extractCandidates(text: string): string[] {
  const candidates = new Set<string>();

  // 1. 抓 ISBN-13 (978... / 979...)
  const pureDigits = text.replace(/[^0-9Xx]/g, "");
  const isbns = pureDigits.match(/(?:978|979)\d{10}/g);
  if (isbns) {
    for (const isbn of isbns) candidates.add(isbn);
  }

  // 2. 抓 10 碼 ISBN
  const isbn10 = pureDigits.match(/\d{9}[\dX]/gi);
  if (isbn10) {
    for (const i of isbn10) candidates.add(i.toUpperCase());
  }

  // 3. 抓英數字單詞（登錄號、標籤、學號）
  const tokens = text
    .split(/[\s,;:，；、|/]+/)
    .map((s) => s.replace(/[^A-Za-z0-9-]/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 32);

  for (const t of tokens) {
    const clean = t.replace(/-/g, "").toUpperCase();
    if (clean.length >= 2) {
      candidates.add(clean);
      candidates.add(t.toUpperCase());
    }
  }

  return Array.from(candidates);
}

export async function recognizeAlphanumeric(imageSource: string | Buffer): Promise<{ rawText: string; candidates: string[] }> {
  let worker: Worker;
  try {
    worker = await getOcrWorker();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn("OCR 初始化失敗：", err);
    throw new HttpError(503, "辨識功能暫時無法使用，請改用條碼掃描或手動輸入");
  }
  let img = imageSource;
  if (typeof img === "string" && img.startsWith("data:")) {
    const base64 = img.replace(/^data:image\/\w+;base64,/, "");
    img = Buffer.from(base64, "base64");
  }
  const ret = await worker.recognize(img);
  const rawText = ret.data?.text || "";
  const candidates = extractCandidates(rawText);
  return { rawText, candidates };
}
