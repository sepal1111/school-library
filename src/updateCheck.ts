// 檢查 GitHub 上有沒有新版本。
// - 只查詢最新正式版的版本號，不傳送任何學校資料。
// - 沒有網路、GitHub 無回應或被關閉時直接略過，不影響其他功能。
// - 管理員可以在「系統設定」關閉；環境變數 SCHOOL_LIB_NO_UPDATE_CHECK=1 也會關閉（測試用）。
import { getSettings } from "./db";
import { VERSION } from "./version";

export const REPO = "sepal1111/school-library";
const API_URL = process.env.SCHOOL_LIB_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const INTERVAL_MS = 12 * 3600 * 1000;
const TIMEOUT_MS = 8000;

export interface UpdateInfo {
  enabled: boolean;
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  url: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  error: string | null;
}

let latest: string | null = null;
let publishedAt: string | null = null;
let checkedAt: string | null = null;
let lastError: string | null = null;
let running: Promise<void> | null = null;
let notifiedVersion: string | null = null;
let onUpdateFound: ((latest: string, url: string) => void) | null = null;

/** 發現新版本時（每個版本只通知一次）要做的事，例如在工具列跳出通知。 */
export function setUpdateListener(fn: (latest: string, url: string) => void): void {
  onUpdateFound = fn;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** 比較 a.b.c 版本號：a 比 b 新回傳正數。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isUpdateCheckEnabled(): boolean {
  if (process.env.SCHOOL_LIB_NO_UPDATE_CHECK) return false;
  return getSettings().updateCheck;
}

async function doCheck(): Promise<void> {
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `school-library/${VERSION}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { tag_name?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    if (!VERSION_RE.test(tag) || data.draft || data.prerelease) throw new Error(`無法辨識的版本：${tag || "（空白）"}`);
    latest = tag.replace(/^v/, "");
    publishedAt = typeof data.published_at === "string" ? data.published_at : null;
    lastError = null;
    if (compareVersions(latest, VERSION) > 0 && notifiedVersion !== latest) {
      notifiedVersion = latest;
      console.log(`\n有新版本 v${latest} 可以下載（目前 v${VERSION}）：${releaseUrl(latest)}\n`);
      onUpdateFound?.(latest, releaseUrl(latest));
    }
  } catch (err) {
    const e = err as Error;
    lastError =
      e.name === "TimeoutError"
        ? "連線逾時"
        : e.message === "fetch failed"
          ? "無法連線到 GitHub（可能沒有網路）"
          : e.message.startsWith("HTTP ")
            ? `GitHub 回應錯誤（${e.message}）`
            : e.message;
  } finally {
    checkedAt = new Date().toISOString();
  }
}

/** 立即檢查一次（同時只會有一個檢查在跑）。關閉時不做事。 */
export function checkForUpdate(): Promise<void> {
  if (!isUpdateCheckEnabled()) return Promise.resolve();
  running ??= doCheck().finally(() => {
    running = null;
  });
  return running;
}

/** 啟動後稍等再檢查，不拖慢啟動；之後每 12 小時檢查一次。 */
export function startUpdateChecks(): void {
  setTimeout(() => void checkForUpdate(), 3000).unref();
  setInterval(() => void checkForUpdate(), INTERVAL_MS).unref();
}

// 下載網址由程式自己組出來，不使用 API 回傳的網址
const releaseUrl = (v: string) => `https://github.com/${REPO}/releases/tag/v${v}`;

export function getUpdateInfo(): UpdateInfo {
  const hasUpdate = latest !== null && compareVersions(latest, VERSION) > 0;
  return {
    enabled: isUpdateCheckEnabled(),
    current: VERSION,
    latest,
    hasUpdate,
    url: latest ? releaseUrl(latest) : null,
    publishedAt,
    checkedAt,
    error: lastError,
  };
}
