#!/usr/bin/env node
// 冒煙測試：把建置好的可攜版複製到暫存資料夾，啟動 exe，逐項打 API，最後關閉並清掉暫存資料。
//
//   node scripts/smoke-test.mjs [可攜版資料夾]     預設 release/圖書借閱系統
//
// 全部通過時結束碼為 0，任何一項失敗為 1。本機與 CI 都可以跑。
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appName = "圖書借閱系統";
const srcDir = path.resolve(process.argv[2] ?? path.join(root, "release", appName));
const exeName = `${appName}.exe`;
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

if (!fs.existsSync(path.join(srcDir, exeName))) {
  console.error(`找不到 ${path.join(srcDir, exeName)}，請先執行 node scripts/build-exe.mjs`);
  process.exit(1);
}

// ---------- 準備暫存資料夾（不含 bin/，模擬第一次使用） ----------
const work = fs.mkdtempSync(path.join(os.tmpdir(), "school-library-smoke-"));
fs.cpSync(srcDir, work, { recursive: true, filter: (p) => path.relative(srcDir, p).split(path.sep)[0] !== "bin" });

// 假的 GitHub Releases API：回傳一個比較新的版本，測試「新版提示」而不連外網
const fakeRelease = http.createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ tag_name: "v99.0.0", published_at: "2099-01-01T00:00:00Z", draft: false, prerelease: false }));
});
await new Promise((r) => fakeRelease.listen(0, "127.0.0.1", r));
const fakeReleaseUrl = `http://127.0.0.1:${fakeRelease.address().port}/`;

const basePort = 18300 + 2 * Math.floor(Math.random() * 200);
const child = spawn(path.join(work, exeName), [], {
  cwd: os.tmpdir(), // 刻意不在 exe 資料夾啟動，確認不依賴工作目錄
  env: { ...process.env, SCHOOL_LIB_NO_BROWSER: "1", SCHOOL_LIB_PORT: String(basePort), SCHOOL_LIB_UPDATE_URL: fakeReleaseUrl },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
let exited = false;
child.on("exit", () => (exited = true));

// ---------- 小工具 ----------
let cookie = "";
let base = "";
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}
async function json(method, url, body, expect = 200) {
  const res = await api(method, url, body);
  const data = await res.json().catch(() => null);
  if (res.status !== expect) throw new Error(`${method} ${url} → ${res.status}（預期 ${expect}）${JSON.stringify(data)}`);
  return data;
}
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false, timeout: 5000 }, (res) => (res.resume(), resolve(res.statusCode))).on("error", reject);
  });
}
/** 這次測試啟動的工具列圖示程式（只看暫存資料夾裡的那一個）。 */
function trayPids() {
  const trayPath = path.join(work, "system", "school-library-tray.exe").replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process -Filter "Name='school-library-tray.exe'" | Where-Object { $_.ExecutablePath -eq '${trayPath}' } | ForEach-Object { $_.ProcessId }`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf-8" });
  return out.split(/\s+/).filter(Boolean);
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}${note ? `：${note}` : ""}（${Date.now() - t} ms）`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ❌ ${name}：${err.message}`);
  }
}

// ---------- 測試 ----------
console.log(`冒煙測試 v${version}：${srcDir}\n暫存：${work}\n`);
try {
  await check("啟動", async () => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const m = log.match(/本機使用：\s*(http:\/\/localhost:\d+)/);
      if (m) {
        base = m[1];
        break;
      }
      if (exited) throw new Error(`exe 已結束\n${log}`);
      if (Date.now() > deadline) throw new Error(`60 秒內沒有啟動\n${log}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    assert(log.includes(`v${version}`), `輸出沒有顯示版本 v${version}`);
    return base;
  });
  if (!base) throw new Error("無法啟動，略過其餘測試");

  await check("不開命令提示字元視窗、寫入記錄檔", () => {
    const buf = fs.readFileSync(path.join(work, exeName));
    const subsystem = buf.readUInt16LE(buf.readUInt32LE(0x3c) + 24 + 68);
    assert(subsystem === 2, `exe 的 Subsystem 是 ${subsystem}（應為 2，Windows GUI）`);
    const logFile = path.join(work, "bin", "logs", "server.log");
    assert(fs.existsSync(logFile), "沒有 bin/logs/server.log");
    const text = fs.readFileSync(logFile, "utf-8");
    assert(text.includes(`v${version}`) && text.includes("本機使用"), "記錄檔內容不完整");
  });

  if (process.platform === "win32") {
    await check("工具列圖示", async () => {
      const deadline = Date.now() + 10000;
      while (!log.includes("已在右下角工具列顯示圖示") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert(log.includes("已在右下角工具列顯示圖示"), "沒有啟動工具列圖示");
      await new Promise((r) => setTimeout(r, 1000));
      assert(trayPids().length === 1, `工具列圖示程式數量：${trayPids().length}`);
    });

    await check("exe 版本資訊", () => {
      const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Item -LiteralPath '${path.join(work, exeName).replace(/'/g, "''")}').VersionInfo | ForEach-Object { $_.ProductVersion + '|' + $_.ProductName }`;
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf-8" }).trim();
      assert(out === `${version}|幼兒園圖書借閱系統`, `版本資訊不符：${out}`);
      return out;
    });
  }

  await check("首頁與前端檔案", async () => {
    for (const u of ["/", "/js/app.js", "/vendor/zxing.min.js", "/vendor/JsBarcode.all.min.js", "/fonts/jf-openhuninn-2.1.woff2"]) {
      const res = await api("GET", u);
      assert(res.status === 200, `${u} → ${res.status}`);
      await res.arrayBuffer();
    }
  });

  await check("HTTPS", async () => {
    const httpsUrl = base.replace("http://", "https://").replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`);
    const status = await httpsGet(httpsUrl + "/");
    assert(status === 200, `HTTPS → ${status}`);
  });

  const newPw = `Smoke-${crypto.randomBytes(6).toString("hex")}`;
  await check("登入 admin 並強制改密碼", async () => {
    const r = await json("POST", "/api/auth/login", { username: "admin", password: "admin" });
    assert(r.user?.mustChangePassword, "預設管理員應該要求改密碼");
    await json("GET", "/api/system/info", undefined, 403);
    await json("POST", "/api/auth/change-password", { oldPassword: "admin", newPassword: newPw });
  });

  await check("系統資訊", async () => {
    const info = await json("GET", "/api/system/info");
    assert(info.version === version, `version = ${info.version}`);
  });

  await check("Excel 匯出", async () => {
    const res = await api("GET", "/api/export/inventory.xlsx");
    const buf = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200 && buf.subarray(0, 2).toString() === "PK", `狀態 ${res.status}，不是 xlsx`);
    return `${buf.length} bytes`;
  });

  await check("備份", async () => {
    const r = await json("POST", "/api/backups");
    assert(/^library-manual-/.test(r.name), `備份檔名 ${r.name}`);
    return r.name;
  });

  await check("OCR 辨識（離線）", async () => {
    const img = fs.readFileSync(path.join(root, "scripts", "fixtures", "ocr-sample.png")).toString("base64");
    const r = await json("POST", "/api/scan/ocr", { image: `data:image/png;base64,${img}` });
    assert(r.candidates?.includes("9789573317241"), `辨識結果：${JSON.stringify(r.rawText)}`);
    assert(!fs.existsSync(path.join(os.tmpdir(), "eng.traineddata")), "OCR 在工作資料夾寫了快取檔");
    return JSON.stringify(r.rawText.trim());
  });

  await check("新版提示", async () => {
    const u = await json("POST", "/api/system/update/check");
    assert(u.current === version && u.latest === "99.0.0" && u.hasUpdate, `檢查結果：${JSON.stringify(u)}`);
    assert(u.url === "https://github.com/sepal1111/school-library/releases/tag/v99.0.0", `下載網址：${u.url}`);
    const d = await json("GET", "/api/dashboard");
    assert(d.update?.latest === "99.0.0", "首頁沒有新版提示");
    await json("PUT", "/api/settings", { updateCheck: false });
    assert(!("update" in (await json("GET", "/api/dashboard"))), "關閉後首頁仍有新版提示");
  });

  await check("執行中仍正常", async () => {
    assert(!exited, `exe 已結束\n${log}`);
    await json("GET", "/api/auth/me");
  });
} finally {
  // Windows 上 child.kill() 就是 TerminateProcess
  child.kill();
  fakeRelease.close();
  await new Promise((r) => (exited ? r() : child.once("exit", r)));
  if (process.platform === "win32" && base) {
    // 伺服器被強制結束時，圖示也要自己消失，不能留在工具列
    await check("伺服器結束後圖示跟著結束", async () => {
      const deadline = Date.now() + 5000;
      while (trayPids().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
      const left = trayPids();
      if (left.length) execFileSync("taskkill.exe", ["/F", ...left.flatMap((p) => ["/PID", p])]);
      assert(!left.length, "工具列圖示程式沒有結束");
    });
  }
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(work, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
if (failed) {
  console.log("\n--- exe 輸出 ---\n" + log);
  process.exit(1);
}
