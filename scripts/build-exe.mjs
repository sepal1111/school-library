#!/usr/bin/env node
// 建置 Windows 可攜版：
//   release/圖書借閱系統/
//     ├─ 圖書借閱系統.exe          （pkg 打包的伺服器，內含 Node 24；不開命令提示字元視窗）
//     ├─ system/static/             （前端檔案，以一般檔案形式放在 exe 旁）
//     ├─ system/ocr/                （OCR worker、tesseract.js-core wasm、eng.traineddata）
//     ├─ system/school-library-tray.exe（右下角工具列圖示，原始碼 tray/Tray.cs）
//     ├─ 使用說明.txt
//     ├─ LICENSE.txt                （專案根目錄有 LICENSE 時才會複製）
//     └─ THIRD_PARTY_NOTICES.txt
//   release/school-library-v<版本>-win-x64.zip   （上面整個資料夾，不含 bin/）
//   release/SHA256SUMS.txt
// bin/（資料庫、封面、備份）不在這裡建立，第一次執行時由程式在 exe 旁自動建立。
//
// 參數：--no-zip  只建資料夾，不產生 zip（本機測試用，比較快）
import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagesFromMetafile, writeNotices } from "./lib/notices.mjs";
import { prepareWinBase } from "./lib/win-exe-base.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// 直接用 node 執行各工具的 JS 進入點，不經過 shell（避免 Windows 上 .cmd 需要 shell 的問題）
const runNode = (script, args, env) =>
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

const appName = "圖書借閱系統";
const exeName = `${appName}.exe`;
const releaseDir = path.join(root, "release");
const outDir = path.join(releaseDir, appName);
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const makeZip = !process.argv.includes("--no-zip");
const nm = (...p) => path.join(root, "node_modules", ...p);

console.log(`建置 ${appName} v${version}\n`);

console.log("[1/8] 複製前端程式庫");
runNode(path.join(root, "scripts", "copy-vendor.mjs"), []);

console.log("[2/8] 型別檢查並用 esbuild 打包成單一檔案");
runNode(require.resolve("typescript/bin/tsc"), ["-p", "tsconfig.json", "--noEmit"]);
// 先打包成一個 CommonJS 檔再交給 pkg：部分套件在 Node 24 下會經由 "module-sync" 匯出條件載入 .mjs，
// pkg 的虛擬檔案系統處理不了 require(ESM)；esbuild 會改用一般的 CommonJS 進入點，問題就消失了。
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
const esbuild = await import("esbuild");
const serverBuild = await esbuild.build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(root, "dist", "bundle.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["node:sqlite"],
  define: { __APP_VERSION__: JSON.stringify(version) },
  metafile: true,
  logLevel: "warning",
});

console.log("[3/8] 準備 exe 基底檔（圖示、版本資訊；第一次會下載 Node 24 基底檔，需要網路）");
const basePath = await prepareWinBase({
  root,
  iconPath: path.join(root, "assets", "icon.ico"),
  version,
  productName: "幼兒園圖書借閱系統",
  description: "幼兒園圖書借閱系統",
  exeName,
  gui: true,
});

console.log("[4/8] 打包 exe");
// 保留既有的 bin/ 資料（重新建置時不要把正在使用的資料刪掉）
fs.mkdirSync(outDir, { recursive: true });
for (const entry of fs.readdirSync(outDir)) {
  if (entry === "bin") continue;
  fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
}
runNode(
  nm("@yao-pkg", "pkg", "lib-es5", "bin.js"),
  ["dist/bundle.cjs", "--targets", "node24-win-x64", "--output", path.join(outDir, exeName), "--compress", "GZip"],
  { PKG_NODE_PATH: basePath }
);

console.log("[5/8] 複製前端檔案與說明");
fs.cpSync(path.join(root, "static"), path.join(outDir, "system", "static"), { recursive: true });
fs.copyFileSync(path.join(root, "使用說明.txt"), path.join(outDir, "使用說明.txt"));
if (fs.existsSync(path.join(root, "LICENSE"))) {
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(outDir, "LICENSE.txt"));
} else {
  console.warn("  ⚠ 專案根目錄沒有 LICENSE，輸出不含 LICENSE.txt（公開發佈前必須補上）");
}

console.log("[6/8] 準備 OCR 檔案（system/ocr/）");
// tesseract.js 用 worker_threads 開一個獨立的 worker 檔，這個檔案不能放進 pkg，
// 所以另外打包成 system/ocr/worker.cjs；它在執行期用 require 載入旁邊 node_modules 裡的 tesseract.js-core（wasm）。
const ocrDir = path.join(outDir, "system", "ocr");
const workerBuild = await esbuild.build({
  entryPoints: [nm("tesseract.js", "src", "worker-script", "node", "index.js")],
  outfile: path.join(ocrDir, "worker.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["tesseract.js-core", "tesseract.js-core/*"],
  metafile: true,
  logLevel: "warning",
});
const coreDst = path.join(ocrDir, "node_modules", "tesseract.js-core");
fs.mkdirSync(coreDst, { recursive: true });
for (const f of fs.readdirSync(nm("tesseract.js-core"))) {
  // 只要 .js 載入器與 .wasm；.wasm.js 是給瀏覽器用的內嵌版本，不需要
  const keep = f === "package.json" || f === "LICENSE" || f.endsWith(".wasm") || (f.endsWith(".js") && !f.endsWith(".wasm.js"));
  if (keep) fs.copyFileSync(nm("tesseract.js-core", f), path.join(coreDst, f));
}
fs.copyFileSync(path.join(root, "assets", "ocr", "eng.traineddata"), path.join(ocrDir, "eng.traineddata"));

console.log("[7/8] 編譯工具列圖示（system/school-library-tray.exe）");
// 用 Windows 內建 .NET Framework 4 的 C# 編譯器，不需要另外安裝工具
const csc = path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
if (!fs.existsSync(csc)) throw new Error(`找不到 C# 編譯器：${csc}（需要在 Windows 上建置）`);
const iconPath = path.join(root, "assets", "icon.ico");
execFileSync(
  csc,
  [
    "-nologo",
    "-codepage:65001",
    "-optimize+",
    "-target:winexe",
    `-win32icon:${iconPath}`,
    `-resource:${iconPath},AppIcon.ico`,
    "-r:System.Windows.Forms.dll",
    "-r:System.Drawing.dll",
    `-out:${path.join(outDir, "system", "school-library-tray.exe")}`,
    path.join(root, "tray", "Tray.cs"),
  ],
  { cwd: root, stdio: "inherit" }
);

console.log("[8/8] 第三方授權聲明" + (makeZip ? "、zip 與 SHA256" : ""));
const nodeLicense = path.join(path.dirname(process.execPath), "LICENSE");
const notices = writeNotices({
  packageDirs: [
    ...packagesFromMetafile(root, serverBuild.metafile),
    ...packagesFromMetafile(root, workerBuild.metafile),
    nm("tesseract.js-core"), // 以檔案形式放在 system/ocr/
    nm("@zxing", "library"), // 前端 static/vendor/
    nm("jsbarcode"), // 前端 static/vendor/
  ],
  extras: [
    {
      name: "Node.js（內嵌於 exe）",
      license: "MIT 及其相依元件授權",
      homepage: "https://nodejs.org/",
      text: fs.existsSync(nodeLicense) ? fs.readFileSync(nodeLicense, "utf-8") : "見 https://github.com/nodejs/node/blob/main/LICENSE",
    },
    {
      name: "Tesseract 英文語言檔 eng.traineddata（system/ocr/）",
      license: "Apache-2.0",
      homepage: "https://github.com/tesseract-ocr/tessdata",
      note: "Apache License 2.0 全文同下方 tesseract.js-core。",
    },
    {
      name: "jf 粉圓體 jf-openhuninn 2.1（system/static/fonts/）",
      license: "SIL Open Font License 1.1",
      homepage: "https://github.com/justfont/open-huninn-font",
      text: fs.readFileSync(path.join(root, "static", "fonts", "OFL-jf-openhuninn.txt"), "utf-8"),
    },
  ],
  outFile: path.join(outDir, "THIRD_PARTY_NOTICES.txt"),
});
console.log(`  授權聲明：${notices.count} 個元件`);
if (notices.missing.length) console.warn(`  ⚠ 下列套件沒有附授權全文：${notices.missing.join(", ")}`);

if (makeZip) {
  const zipName = `school-library-v${version}-win-x64.zip`;
  const zipPath = path.join(releaseDir, zipName);
  const zip = new AdmZip();
  // 不含 bin/（執行期資料）
  zip.addLocalFolder(outDir, appName, (p) => !/^bin([\\/]|$)/.test(p));
  zip.writeZip(zipPath);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), `${sha}  ${zipName}\n`);
  console.log(`  ${zipName}（${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB）`);
  console.log(`  SHA256 ${sha}`);
}

console.log(`\n完成 v${version}：${outDir}`);
console.log("整個資料夾可以複製到其他電腦或隨身碟使用；資料存在資料夾內的 bin\\。");
