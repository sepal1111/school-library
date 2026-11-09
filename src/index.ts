// 幼兒園圖書借閱系統 — 伺服器進入點。
// 啟動流程：開資料庫 → 自動備份 → 找可用埠 → 同時開 HTTP（本機用）與 HTTPS（區域網路手機用）→ 開瀏覽器。
// 可攜版（exe）沒有命令提示字元視窗：在右下角工具列顯示圖示，訊息寫到 bin/logs/server.log。
// 開發模式（npm run dev）照舊在終端機印出訊息與 QR Code。
import { exec, spawn } from "child_process";
import cookieParser from "cookie-parser";
import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import QRCode from "qrcode";
import { requireLogin } from "./auth";
import { createBackup } from "./backup";
import { closeDb, get, openDb } from "./db";
import { HttpError, errorHandler } from "./http";
import { getAppDir, getBinDir, getCoversDir, getStaticDir, isPackaged } from "./paths";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import bookRoutes from "./routes/books";
import loanRoutes from "./routes/loans";
import reportRoutes from "./routes/reports";
import systemRoutes, { sendCertHandler } from "./routes/system";
import { setServerInfo } from "./serverInfo";
import { getLogFile, setupFileLog } from "./log";
import { getHttpsOptions } from "./tls";
import { Tray, isTrayAvailable, showErrorDialog } from "./tray";
import { setUpdateListener, startUpdateChecks } from "./updateCheck";
import { getLanIps } from "./utils/network";
import { nowText } from "./utils/time";
import { VERSION } from "./version";

const BASE_PORT = Number(process.env.SCHOOL_LIB_PORT) || 8300;

function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.json({ limit: "6mb" }));

  // 不讓瀏覽器快取 API 回應
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/auth", authRoutes);
  // 憑證下載不需要登入，方便手機/平板未登入前或掃碼前直接下載安裝
  app.get(["/api/system/cert", "/cert", "/school-library.crt"], sendCertHandler);
  app.use("/api", requireLogin, adminRoutes, bookRoutes, loanRoutes, reportRoutes, systemRoutes);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "找不到這個功能")));

  app.use("/covers", requireLogin, express.static(getCoversDir(), { maxAge: "7d", fallthrough: false }));

  const staticDir = getStaticDir();
  // 字型檔約 2 MB、檔名含版本號，讓手機平板快取一年，不用每次重新下載
  app.use("/fonts", express.static(path.join(staticDir, "fonts"), { maxAge: "365d", immutable: true }));
  app.use(express.static(staticDir, { index: "index.html", maxAge: 0 }));
  // 單頁應用：其他路徑都回傳 index.html
  app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));

  app.use(errorHandler);
  return app;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "0.0.0.0");
  });
}

/** 找兩個相鄰的可用埠：HTTP 用 port，HTTPS 用 port + 1。 */
async function findPorts(): Promise<[number, number]> {
  for (let p = BASE_PORT; p < BASE_PORT + 100; p += 2) {
    if ((await isPortFree(p)) && (await isPortFree(p + 1))) return [p, p + 1];
  }
  throw new Error("找不到可用的連接埠");
}

function openBrowser(url: string): void {
  if (process.env.SCHOOL_LIB_NO_BROWSER) return;
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  // windowsHide：沒有視窗的可攜版呼叫 cmd 時，不要閃出黑色視窗
  exec(cmd, { windowsHide: true }, () => undefined);
}

function openFolder(dir: string): void {
  if (process.platform !== "win32") return;
  spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
}

/** 有終端機（開發模式、或在命令提示字元裡執行）時才印 QR Code 等只給人看的內容。 */
const hasTerminal = Boolean(process.stdout.isTTY);

// ---------- 防止重複啟動：同一份資料只能有一個伺服器在寫 ----------

const runtimeFile = () => path.join(getBinDir(), "runtime.json");

function readRuntime(): { pid: number; localUrl: string } | null {
  try {
    return JSON.parse(fs.readFileSync(runtimeFile(), "utf-8"));
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/auth/me`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) > 0);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => (req.destroy(), resolve(false)));
  });
}

async function main(): Promise<void> {
  if (isPackaged()) setupFileLog(path.join(getBinDir(), "logs"));
  console.log(`\n幼兒園圖書借閱系統 v${VERSION}`);

  const existing = readRuntime();
  if (existing && existing.pid !== process.pid && isAlive(existing.pid) && (await probe(existing.localUrl))) {
    console.log(`系統已經在執行中：${existing.localUrl}，直接開啟瀏覽器。`);
    openBrowser(existing.localUrl);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  const { createdAdmin } = openDb();
  const bookCount = get<{ c: number }>("SELECT COUNT(*) AS c FROM books")!.c;
  if (bookCount > 0) {
    try {
      const name = createBackup("auto");
      console.log(`已自動備份：bin\\backups\\${name}`);
    } catch (err) {
      console.warn("自動備份失敗：", (err as Error).message);
    }
  }

  const app = buildApp();
  const [httpPort, httpsPort] = await findPorts();
  const httpServer = http.createServer(app);
  const httpsServer = https.createServer(await getHttpsOptions(), app);
  await new Promise<void>((r) => httpServer.listen(httpPort, "0.0.0.0", r));
  await new Promise<void>((r) => httpsServer.listen(httpsPort, "0.0.0.0", r));

  const lanIps = getLanIps();
  const localUrl = `http://localhost:${httpPort}`;
  const lanHttpsUrl = lanIps[0] ? `https://${lanIps[0]}:${httpsPort}` : null;
  setServerInfo({
    version: VERSION,
    httpPort,
    httpsPort,
    localUrl,
    lanHttpsUrl,
    lanHttpUrl: lanIps[0] ? `http://${lanIps[0]}:${httpPort}` : null,
    lanIps,
  });
  fs.writeFileSync(runtimeFile(), JSON.stringify({ pid: process.pid, localUrl, startedAt: nowText() }, null, 2));

  console.log("────────────────────────────────────────");
  console.log(`本機使用：  ${localUrl}`);
  if (lanHttpsUrl) {
    console.log(`手機/平板： ${lanHttpsUrl}`);
    if (hasTerminal) {
      console.log("（第一次連線會出現憑證警告，選「繼續前往」即可）\n");
      console.log(await QRCode.toString(lanHttpsUrl, { type: "terminal", small: true }));
    }
  } else {
    console.log("找不到區域網路連線，目前只能在這台電腦使用。");
  }
  if (createdAdmin) {
    console.log("第一次啟動：已建立管理員帳號 admin，密碼 admin（登入後會要求修改密碼）。");
  }
  console.log("────────────────────────────────────────");

  let closing = false;
  let tray: Tray | null = null;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log("正在關閉系統…");
    try {
      const rt = readRuntime();
      if (rt?.pid === process.pid) fs.unlinkSync(runtimeFile());
    } catch {
      /* ignore */
    }
    tray?.stop();
    httpServer.close();
    httpsServer.close();
    closeDb();
    console.log("系統已關閉。");
    // 留一點時間讓工具列圖示收到 exit 指令
    setTimeout(() => process.exit(0), tray ? 300 : 0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

  if (isTrayAvailable()) {
    const EVENT_LABEL = { open: "開啟系統", phone: "手機／平板連線", folder: "開啟程式資料夾", quit: "結束服務" };
    tray = new Tray((event) => {
      console.log(`工具列圖示：${EVENT_LABEL[event]}`);
      if (event === "open") openBrowser(localUrl);
      else if (event === "phone") openBrowser(`${localUrl}/#/connect`);
      else if (event === "folder") openFolder(getAppDir());
      else if (event === "quit") shutdown();
    });
    tray.start();
    tray.setTooltip(`圖書借閱系統 v${VERSION}：執行中`);
    tray.notify(
      "圖書借閱系統已啟動",
      createdAdmin
        ? "第一次使用：帳號 admin、密碼 admin。\n要開啟或結束系統，請按右下角工具列的圖示。"
        : "要開啟或結束系統，請按右下角工具列的圖示。"
    );
    setUpdateListener((latest) => tray?.notify("有新版本可以下載", `新版本 v${latest}，請到系統首頁查看。`));
    console.log("已在右下角工具列顯示圖示。");
  } else {
    console.log("使用期間請不要關閉這個視窗；關閉視窗即結束系統。\n");
  }

  openBrowser(localUrl);
  startUpdateChecks();
}

main().catch((err) => {
  console.error("啟動失敗：", err);
  if (isTrayAvailable()) {
    // 沒有視窗可以看錯誤訊息，改用對話框
    const log = getLogFile();
    showErrorDialog(
      "圖書借閱系統無法啟動",
      `${(err as Error)?.message ?? err}${log ? `\n\n詳細記錄：${log}` : ""}`
    );
    setTimeout(() => process.exit(1), 500);
  } else if (isPackaged() && hasTerminal) {
    console.log("\n按 Enter 關閉視窗…");
    process.stdin.once("data", () => process.exit(1));
  } else {
    process.exit(1);
  }
});
