#!/usr/bin/env node
// 從 CHANGELOG.md 取出某一版的說明，加上下載與升級說明，輸出成 GitHub Release 的內文。
//
//   node scripts/release-notes.mjs [版本] [--check-tag v1.2.3]
//
// 版本預設取 package.json。--check-tag 會確認 git 標籤和 package.json 的版本一致（CI 用）。
// 找不到該版的段落、或段落是空的，結束碼為 1。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
const args = process.argv.slice(2);
const tagIdx = args.indexOf("--check-tag");
const tag = tagIdx >= 0 ? args.splice(tagIdx, 2)[1] : null;
const version = args[0] ?? pkgVersion;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (tag !== null && tag !== `v${pkgVersion}`) {
  fail(`git 標籤 ${tag} 和 package.json 的版本 ${pkgVersion} 不一致。請先修改 package.json 的 version 再打標籤。`);
}

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf-8").replace(/\r\n/g, "\n");
const escaped = version.replace(/\./g, "\\.");
const m = changelog.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, "m"));
if (!m) fail(`CHANGELOG.md 裡找不到「## [${version}]」段落`);
const body = m[1].trim();
if (!body) fail(`CHANGELOG.md 的「## [${version}]」段落是空的`);

const zipName = `school-library-v${version}-win-x64.zip`;
process.stdout.write(`${body}

## 下載

下載下方的 \`${zipName}\`，解壓縮後雙擊「圖書借閱系統.exe」。詳細步驟請看 zip 裡的「使用說明.txt」。

- 系統需求：Windows 10／11 64 位元，不需要另外安裝軟體。
- 第一次執行如果出現「Windows 已保護您的電腦」，請按「其他資訊 → 仍要執行」（程式沒有數位簽章）。
- 檔案核對：在 PowerShell 執行 \`Get-FileHash ${zipName}\`，結果要和 \`SHA256SUMS.txt\` 相同。

## 從舊版升級

關閉系統 → 備份舊資料夾的 \`bin\\\` → 解壓縮新版 → 把舊的 \`bin\\\` 複製到新資料夾 → 啟動。資料會自動升級。
`);
