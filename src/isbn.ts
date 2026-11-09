// ISBN 格式處理與線上書目查詢（國圖 NBINet → Google Books → Open Library）。
// 查詢由主機端伺服器發出，前端不直接連外部服務。
import { createHash } from "node:crypto";

/** 清掉空白與連字號，轉大寫。 */
export function cleanIsbn(raw: string): string {
  return String(raw ?? "").replace(/[\s-]/g, "").toUpperCase();
}

function isbn13CheckOk(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isbn10CheckOk(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn10to13(s: string): string {
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}

/** 978 開頭的 ISBN-13 轉回 ISBN-10；979 開頭沒有對應的 ISBN-10，回傳 null。 */
export function isbn13to10(s: string): string | null {
  if (!/^978\d{10}$/.test(s)) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? "X" : String(c));
}

/** 回傳正規化後的 ISBN-13；格式或檢查碼錯誤時回傳 null。 */
export function normalizeIsbn(raw: string): string | null {
  const s = cleanIsbn(raw);
  if (s.length === 13 && (s.startsWith("978") || s.startsWith("979")) && isbn13CheckOk(s)) return s;
  if (s.length === 10 && isbn10CheckOk(s)) return isbn10to13(s);
  return null;
}

/** 看起來像 ISBN（不檢查檢查碼），用來判斷掃到的是 ISBN 還是登錄號。 */
export function looksLikeIsbn(raw: string): boolean {
  const s = cleanIsbn(raw);
  return /^97[89]\d{10}$/.test(s) || /^\d{9}[\dX]$/.test(s);
}

export interface LookupResult {
  source: string;
  title: string;
  author: string;
  publisher: string;
  classificationNo?: string;
  authorNo?: string;
  coverDataUrl: string | null;
}

/** 查詢過程中暫存的書目；封面候選網址最後才依序下載。 */
interface Found {
  source: string;
  title: string;
  author: string;
  publisher: string;
  classificationNo?: string;
  authorNo?: string;
  coverUrls: string[];
}

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "School-Library/1.0" } });
  } finally {
    clearTimeout(timer);
  }
}

// 讀冊生活沒有這本書的封面時，回傳的預設圖（width=600）
const TAAZE_PLACEHOLDER_MD5 = "1bc26a777f0bad3ef0bc12e1b7a9131a";

/** 下載封面並轉成 data URL；太小（多半是「無封面」佔位圖）、是預設圖或失敗時回傳 null。 */
async function downloadCover(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1500 || buf.length > 3 * 1024 * 1024) return null;
    if (createHash("md5").update(buf).digest("hex") === TAAZE_PLACEHOLDER_MD5) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const taazeCover = (isbn: string) => `https://media.taaze.tw/showLargeImageByIsbn.ashx?width=600&isbn=${isbn}`;
const openLibraryCover = (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;

/** 清掉編目資料裡的子欄位代碼（$$Q…）、結尾的標點與多餘空白。 */
function cleanMarc(v: unknown): string {
  return String(v ?? "")
    .split("$$")[0]
    .replace(/\s+/g, " ")
    .replace(/[\s/:;,，=]+$/, "")
    .trim();
}

/** 「好餓的毛毛蟲 : 50週年紀念版 / 艾瑞.卡爾文」→「好餓的毛毛蟲：50週年紀念版」；並列題名（= 英文書名）不要。 */
function cleanNbinetTitle(raw: string): string {
  let t = raw.split(" / ")[0];
  t = t.split("=")[0];
  t = cleanMarc(t);
  return t.replace(/\s*[:：]\s*/g, "：");
}

const NBINET_URL = "https://nbinet.primo.exlibrisgroup.com/primaws/rest/pub/pnxs";
const NBINET_VID = "886NCL_NBINET:NBINET";

interface PrimoDoc {
  pnx?: {
    display?: { title?: string[]; creator?: string[]; publisher?: string[]; lds02?: string[]; callnumber?: string[] };
    addata?: { btitle?: string[]; au?: string[]; addau?: string[]; pub?: string[]; isbn?: string[]; callnumber?: string[]; lcc?: string[] };
  };
  delivery?: {
    bestlocation?: { callNumber?: string; mainLocation?: string };
    holding?: Array<{ callNumber?: string; mainLocation?: string }>;
    link?: Array<{ linkType?: string; linkURL?: string }>;
  };
}

/** 從 PrimoDoc（包含 Alma 聯合目錄館藏 delivery 及 display）解析分類號與作者號。 */
function parseCallNumbers(docs: PrimoDoc[]): { classificationNo: string; authorNo: string } {
  let classificationNo = "";
  let authorNo = "";

  for (const doc of docs) {
    // 1. 各圖書館館藏實際索書號（如 delivery.bestlocation, delivery.holding 的 callNumber：「859.6 7788」、「400 4111」）
    const locs = [doc.delivery?.bestlocation, ...(doc.delivery?.holding || [])].filter(Boolean);
    for (const loc of locs) {
      const raw = String(loc?.callNumber || "").trim();
      if (!raw) continue;
      // 支援常見格式：「859.6 7788」、「859.6/7788」、「859.6/8344-2」
      const parts = raw.split(/[\s/]+/).filter(Boolean);
      // 中文分類號通常為 3 位數字開頭（如 859.6、336、400）
      if (parts.length >= 1 && /^\d{3}(\.\d+)?$/.test(parts[0])) {
        if (!classificationNo) classificationNo = parts[0];
        if (parts.length >= 2 && !authorNo) {
          // 作者號通常為 3-5 位數字或帶符號（如 7788, 4111, 8437）
          authorNo = parts[1].replace(/[:：;].*$/, "");
        }
      }
      if (classificationNo && authorNo) return { classificationNo, authorNo };
    }

    // 2. 檢索 display.lds02（國圖/編目專用的中文圖書分類號）
    const lds02 = doc.pnx?.display?.lds02?.[0];
    if (lds02 && !classificationNo) {
      const clean = cleanMarc(lds02);
      if (/^\d{3}(\.\d+)?$/.test(clean)) classificationNo = clean;
    }

    // 3. 檢索 callnumber / lcc 欄位
    const rawCalls = [
      ...(doc.pnx?.addata?.callnumber || []),
      ...(doc.pnx?.display?.callnumber || []),
      ...(doc.pnx?.addata?.lcc || []),
    ].map(cleanMarc).filter(Boolean);
    for (const call of rawCalls) {
      const parts = call.split(/[\s/]+/).filter(Boolean);
      if (parts.length >= 1 && !classificationNo && /^\d{3}(\.\d+)?$/.test(parts[0])) {
        classificationNo = parts[0];
      }
      if (parts.length >= 2 && !authorNo) {
        authorNo = parts[1];
      }
    }
    if (classificationNo && authorNo) break;
  }

  return { classificationNo, authorNo };
}

async function nbinetSearch(q: string): Promise<PrimoDoc[]> {
  const res = await fetchWithTimeout(
    `${NBINET_URL}?vid=${encodeURIComponent(NBINET_VID)}&q=${encodeURIComponent(q)}&lang=zh-tw`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { docs?: PrimoDoc[] };
  return data.docs ?? [];
}

/** 國家圖書館「全國圖書書目資訊網」(NBINet)，台灣出版品的書目最完整。 */
async function fromNbinet(isbn: string): Promise<Found | null> {
  // 較舊的書目常以 ISBN-10 登錄，兩種都要查
  const isbn10 = isbn13to10(isbn);
  const keys = isbn10 ? [isbn, isbn10] : [isbn];
  let docs: PrimoDoc[] = [];
  for (const k of keys) {
    docs = await nbinetSearch(`isbn,exact,${k}`);
    if (docs.length) break;
  }
  // 精確查詢沒有結果時改用全文查詢（ISBN 欄位格式不一，例如帶連字號或「(平裝)」）。
  // 全文查詢可能比對到附註裡的號碼，所以只留下 ISBN 欄位真的相符的書目。
  if (!docs.length) {
    const same = (d: PrimoDoc) => (d.pnx?.addata?.isbn ?? []).some((v) => keys.some((k) => cleanIsbn(v).includes(k)));
    for (const k of keys) {
      docs = (await nbinetSearch(`any,contains,${k}`)).filter(same);
      if (docs.length) break;
    }
  }
  if (!docs.length) return null;

  let title = "";
  let author = "";
  let publisher = "";
  const coverUrls: string[] = [];
  // 同一個 ISBN 可能有好幾筆館藏書目，逐筆補齊缺少的欄位
  let classificationNo = "";
  let authorNo = "";
  for (const doc of docs) {
    const disp = doc.pnx?.display ?? {};
    const add = doc.pnx?.addata ?? {};
    if (!title) title = cleanNbinetTitle(add.btitle?.[0] ?? disp.title?.[0] ?? "");
    if (!author) {
      const names = [...(add.au ?? []), ...(add.addau ?? [])].map(cleanMarc).filter(Boolean);
      if (!names.length) names.push(...(disp.creator ?? []).map(cleanMarc).filter(Boolean));
      // 「Carle, Eric」已經包含在「卡爾 (Carle, Eric)」裡就不重複列
      const unique = [...new Set(names)];
      author = unique.filter((n) => !unique.some((o) => o !== n && o.includes(n))).join("、");
    }
    if (!publisher) {
      // addata.pub 是「上誼文化實業」；display.publisher 是「臺北市 : 上誼文化實業」
      publisher = cleanMarc(add.pub?.[0] ?? "");
      if (!publisher && disp.publisher?.[0]) {
        const parts = disp.publisher[0].split(":");
        publisher = cleanMarc(parts.length >= 2 ? parts[1] : parts[0]);
      }
    }
    for (const l of doc.delivery?.link ?? []) {
      // Google 的 callback 網址是給網頁用的 JSONP，不是圖片；讀冊的封面另外用大尺寸網址查
      const u = l.linkURL ?? "";
      if (l.linkType === "thumbnail" && u && !u.includes("callback=") && !u.includes("media.taaze.tw")) coverUrls.push(u);
    }
  }

  // 從所有相符館藏中擷取分類號與作者號
  const callInfo = parseCallNumbers(docs);
  classificationNo = callInfo.classificationNo;
  authorNo = callInfo.authorNo;

  // 若依 ISBN 查到的書目缺少分類號，以書名進行深度二次檢索
  if (title && (!classificationNo || !authorNo)) {
    try {
      // 先用書名完整查詢
      const titleClean = title.split(/[：:]/)[0].trim();
      const titleDocs = await nbinetSearch(`title,exact,${titleClean}`);
      const tCallInfo = parseCallNumbers(titleDocs);
      if (!classificationNo) classificationNo = tCallInfo.classificationNo;
      if (!authorNo) authorNo = tCallInfo.authorNo;

      // 若仍無分類號，改用書名 contains 檢索
      if (!classificationNo && titleClean.length >= 2) {
        const titleContainsDocs = await nbinetSearch(`title,contains,${titleClean}`);
        const cCallInfo = parseCallNumbers(titleContainsDocs);
        if (!classificationNo) classificationNo = cCallInfo.classificationNo;
        if (!authorNo) authorNo = cCallInfo.authorNo;
      }
    } catch {
      /* 容錯忽略 */
    }
  }

  if (!title) return null;
  return { source: "國家圖書館 NBINet", title, author, publisher, classificationNo, authorNo, coverUrls };
}

async function fromGoogle(isbn: string): Promise<Found | null> {
  const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: Array<{
      volumeInfo?: {
        title?: string;
        subtitle?: string;
        authors?: string[];
        publisher?: string;
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      };
    }>;
  };
  const info = data.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const img = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
  return {
    source: "Google Books",
    title: info.subtitle ? `${info.title}：${info.subtitle}` : info.title,
    author: (info.authors ?? []).join("、"),
    publisher: info.publisher ?? "",
    coverUrls: img ? [img.replace(/^http:/, "https:").replace("&edge=curl", "")] : [],
  };
}

async function fromOpenLibrary(isbn: string): Promise<Found | null> {
  const key = `ISBN:${isbn}`;
  const res = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`);
  if (!res.ok) return null;
  const data = (await res.json()) as Record<
    string,
    {
      title?: string;
      subtitle?: string;
      authors?: Array<{ name?: string }>;
      publishers?: Array<{ name?: string }>;
      cover?: { medium?: string; large?: string };
    }
  >;
  const info = data[key];
  if (!info?.title) return null;
  const coverUrl = info.cover?.medium ?? info.cover?.large;
  return {
    source: "Open Library",
    title: info.subtitle ? `${info.title}：${info.subtitle}` : info.title,
    author: (info.authors ?? []).map((a) => a.name).filter(Boolean).join("、"),
    publisher: info.publishers?.[0]?.name ?? "",
    coverUrls: coverUrl ? [coverUrl] : [],
  };
}

/**
 * 書目依序查詢：國圖 NBINet（台灣書）→ Google Books → Open Library（外文書）。
 * 封面依序嘗試：讀冊生活 → 各來源附的封面網址 → Open Library 封面服務。
 */
export interface LookupResponse {
  /** 查到的書目；都查不到時是 null。 */
  result: LookupResult | null;
  /** 連線失敗的來源（只有在都查不到時才回傳）。 */
  errors: string[];
  /** 有正常回應、但沒有這本書的來源。 */
  searched: string[];
  /** 查不到書目時，仍嘗試用 ISBN 找到的封面。 */
  coverDataUrl: string | null;
}

async function firstCover(urls: string[]): Promise<string | null> {
  for (const url of new Set(urls)) {
    const data = await downloadCover(url);
    if (data) return data;
  }
  return null;
}

export async function lookupIsbn(isbn: string): Promise<LookupResponse> {
  const errors: string[] = [];
  const searched: string[] = [];
  let found: Found | null = null;
  for (const [name, fn] of [
    ["國家圖書館 NBINet", fromNbinet],
    ["Google Books", fromGoogle],
    ["Open Library", fromOpenLibrary],
  ] as const) {
    try {
      found = await fn(isbn);
      if (found) break;
      searched.push(name);
    } catch (err) {
      const e = err as Error;
      const why = e.name === "AbortError" ? "連線逾時" : e.message === "RATE_LIMIT" ? "查詢次數暫時超過限制" : "無法連線";
      errors.push(`${name}：${why}`);
    }
  }
  if (!found) {
    // 書目查不到，封面網站可能還是有，先帶入封面，書名再手動輸入
    const coverDataUrl = await firstCover([taazeCover(isbn), openLibraryCover(isbn)]);
    return { result: null, errors, searched, coverDataUrl };
  }

  const coverDataUrl = await firstCover([taazeCover(isbn), ...found.coverUrls, openLibraryCover(isbn)]);
  // 有一個來源查到就不用顯示其他來源的錯誤
  return {
    result: {
      source: found.source,
      title: found.title,
      author: found.author,
      publisher: found.publisher,
      classificationNo: found.classificationNo || "",
      authorNo: found.authorNo || "",
      coverDataUrl,
    },
    errors: [],
    searched: [],
    coverDataUrl,
  };
}
