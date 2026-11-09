#!/usr/bin/env node
// 建置 Windows 可攜版：
//   release/圖書借閱系統/
//     ├─ 圖書借閱系統.exe   （pkg 打包的伺服器，內含 Node 24，使用內建 node:sqlite）
//     ├─ system/static/      （前端檔案，以一般檔案形式放在 exe 旁）
//     └─ 使用說明.txt
// bin/（資料庫、封面、備份）不在這裡建立，第一次執行時由程式在 exe 旁自動建立。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";
const npm = isWin ? "npm.cmd" : "npm";
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: isWin });

const appName = "圖書借閱系統";
const outDir = path.join(root, "release", appName);

console.log("[1/4] 複製前端程式庫");
run(npm, ["run", "vendor"]);

console.log("[2/4] 型別檢查並用 esbuild 打包成單一檔案");
run(npx, ["tsc", "-p", "tsconfig.json", "--noEmit"]);
// 先打包成一個 CommonJS 檔再交給 pkg：部分套件在 Node 24 下會經由 "module-sync" 匯出條件載入 .mjs，
// pkg 的虛擬檔案系統處理不了 require(ESM)；esbuild 會改用一般的 CommonJS 進入點，問題就消失了。
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(root, "dist", "bundle.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["node:sqlite"],
  logLevel: "warning",
});

console.log("[3/4] 打包 exe（第一次會下載 Node 24 基底檔，需要網路）");
// 保留既有的 bin/ 資料（重新建置時不要把正在使用的資料刪掉）
fs.mkdirSync(outDir, { recursive: true });
for (const entry of fs.readdirSync(outDir)) {
  if (entry === "bin") continue;
  fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
}
run(npx, ["pkg", "dist/bundle.cjs", "--targets", "node24-win-x64", "--output", path.join(outDir, `${appName}.exe`), "--compress", "GZip"]);

console.log("[4/4] 複製前端檔案與說明");
fs.cpSync(path.join(root, "static"), path.join(outDir, "system", "static"), { recursive: true });
fs.copyFileSync(path.join(root, "使用說明.txt"), path.join(outDir, "使用說明.txt"));

console.log(`\n完成：${outDir}`);
console.log("整個資料夾可以複製到其他電腦或隨身碟使用；資料存在資料夾內的 bin\\。");
