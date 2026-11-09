// 把前端用到的第三方程式庫複製到 static/vendor/，讓系統不需連外部 CDN。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["node_modules/@zxing/library/umd/index.min.js", "static/vendor/zxing.min.js"],
  ["node_modules/jsbarcode/dist/JsBarcode.all.min.js", "static/vendor/JsBarcode.all.min.js"],
];
fs.mkdirSync(path.join(root, "static/vendor"), { recursive: true });
for (const [from, to] of files) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.warn(`[vendor] 找不到 ${from}，略過`);
    continue;
  }
  fs.copyFileSync(src, path.join(root, to));
  console.log(`[vendor] ${to}`);
}
