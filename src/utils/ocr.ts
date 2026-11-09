// 純離線英數字 OCR 模組：
// 支援透過鏡頭辨識書背 ISBN 數字、條碼下方英數字、圖書登錄號貼紙與學生證號。
import { createWorker, Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

export async function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cachePath = process.cwd();
      const worker = await createWorker("eng", 1, { cachePath });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-:/. ",
      });
      return worker;
    })();
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
  const worker = await getOcrWorker();
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

