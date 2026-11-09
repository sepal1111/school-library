// 從 esbuild 的 metafile 找出實際打包進去的 npm 套件，產生第三方授權聲明。
import fs from "node:fs";
import path from "node:path";

const LICENSE_FILE_RE = /^(licen[sc]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** 從 metafile 的 inputs 路徑找出 node_modules 套件資料夾。 */
export function packagesFromMetafile(root, metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = input.replace(/\\/g, "/").split("/");
    const i = parts.lastIndexOf("node_modules");
    if (i < 0) continue;
    const nameParts = parts[i + 1]?.startsWith("@") ? parts.slice(i + 1, i + 3) : parts.slice(i + 1, i + 2);
    dirs.add(path.join(root, ...parts.slice(0, i + 1), ...nameParts));
  }
  return [...dirs];
}

function readPackage(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
  const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "見授權全文";
  const texts = fs
    .readdirSync(dir)
    .filter((f) => LICENSE_FILE_RE.test(f))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf-8").trim());
  return { name: pkg.name, version: pkg.version, license, homepage: pkg.homepage ?? "", texts };
}

/**
 * @param {object} o
 * @param {string[]} o.packageDirs 套件資料夾
 * @param {Array<{name: string, license: string, homepage?: string, text?: string, note?: string}>} o.extras 非 npm 套件的元件
 * @param {string} o.outFile
 */
export function writeNotices({ packageDirs, extras, outFile }) {
  const seen = new Map();
  for (const dir of packageDirs) {
    const p = readPackage(dir);
    const key = `${p.name}@${p.version}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  const pkgs = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const missing = pkgs.filter((p) => p.texts.length === 0).map((p) => `${p.name}@${p.version}`);

  const sep = "=".repeat(78);
  const out = [
    "第三方元件授權聲明 THIRD-PARTY NOTICES",
    "",
    "本程式包含下列第三方元件，各依其授權條款散布。",
    "This software includes the following third-party components, distributed under their own licenses.",
    "",
    "元件清單 / Components:",
    ...extras.map((e) => `  - ${e.name}  (${e.license})`),
    ...pkgs.map((p) => `  - ${p.name}@${p.version}  (${p.license})`),
    "",
  ];
  for (const e of extras) {
    out.push(sep, `${e.name}  (${e.license})`, e.homepage ?? "", e.note ?? "", sep, "", e.text?.trim() ?? "", "");
  }
  for (const p of pkgs) {
    out.push(sep, `${p.name}@${p.version}  (${p.license})`, p.homepage, sep, "");
    out.push(p.texts.length ? p.texts.join("\n\n") : `授權：${p.license}（套件未附授權全文）`, "");
  }
  // Windows 記事本友善：CRLF ＋ UTF-8 BOM
  fs.writeFileSync(outFile, "﻿" + out.join("\n").replace(/\n/g, "\r\n"));
  return { count: pkgs.length + extras.length, missing };
}
