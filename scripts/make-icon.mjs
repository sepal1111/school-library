// 把 assets/icon.png 轉成多尺寸的 assets/icon.ico（exe 圖示與工具列圖示共用）。
// 用法：node scripts/make-icon.mjs [來源.png] [輸出.ico]
// 換圖示時：替換 assets/icon.png（建議 256×256 以上的正方形），執行 npm run icon，再建置。
//
// 16～128 用 32 位元 BMP（.NET 讀 PNG 格式的小尺寸會出錯），256 用 PNG 壓縮。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(process.argv[2] ?? path.join(root, "assets", "icon.png"));
const out = path.resolve(process.argv[3] ?? path.join(root, "assets", "icon.ico"));
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const PNG_FROM = 256;

const img = PNG.sync.read(fs.readFileSync(src));
if (img.width !== img.height) console.warn(`⚠ 圖片不是正方形（${img.width}×${img.height}），會被壓扁`);
if (img.width < 256) console.warn(`⚠ 圖片只有 ${img.width}×${img.height}，256 尺寸會放大而略為模糊`);

// 預乘 alpha 的浮點 RGBA，避免透明邊緣變黑
const toFloat = ({ width, height, data }) => {
  const f = new Float64Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    f[i * 4] = data[i * 4] * a;
    f[i * 4 + 1] = data[i * 4 + 1] * a;
    f[i * 4 + 2] = data[i * 4 + 2] * a;
    f[i * 4 + 3] = a;
  }
  return { width, height, f };
};

// Mitchell–Netravali 濾波；縮小時放寬取樣範圍，等同面積平均
const mitchell = (x) => {
  const B = 1 / 3, C = 1 / 3;
  x = Math.abs(x);
  if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
  if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
  return 0;
};

function resample1D(srcLen, dstLen) {
  const scale = dstLen / srcLen;
  const stretch = Math.max(1, 1 / scale);
  const support = 2 * stretch;
  const taps = [];
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.ceil(center - support), hi = Math.floor(center + support);
    const w = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const v = mitchell((j - center) / stretch);
      if (v === 0) continue;
      w.push([Math.min(srcLen - 1, Math.max(0, j)), v]);
      sum += v;
    }
    taps.push(w.map(([j, v]) => [j, v / sum]));
  }
  return taps;
}

function resize({ width, height, f }, size) {
  const tx = resample1D(width, size), ty = resample1D(height, size);
  const mid = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < size; x++)
      for (const [j, w] of tx[x])
        for (let c = 0; c < 4; c++) mid[(y * size + x) * 4 + c] += f[(y * width + j) * 4 + c] * w;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = [0, 0, 0, 0];
      for (const [j, w] of ty[y]) for (let c = 0; c < 4; c++) p[c] += mid[(j * size + x) * 4 + c] * w;
      const a = Math.min(1, Math.max(0, p[3]));
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = a > 0 ? Math.round(Math.min(255, Math.max(0, p[c] / a))) : 0;
      rgba[o + 3] = Math.round(a * 255);
    }
  return rgba;
}

function bmpEntry(rgba, size) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // 含 AND 遮罩的高度
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = ((size - 1 - y) * size + x) * 4; // BMP 由下往上
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[(size - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  return Buffer.concat([header, pixels, mask]);
}

function pngEntry(rgba, size) {
  const png = new PNG({ width: size, height: size });
  rgba.copy(png.data);
  return PNG.sync.write(png, { colorType: 6 });
}

const base = toFloat(img);
const entries = SIZES.map((size) => {
  const rgba = resize(base, size);
  return { size, data: size >= PNG_FROM ? pngEntry(rgba, size) : bmpEntry(rgba, size) };
});

const dir = Buffer.alloc(6 + 16 * entries.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(entries.length, 4);
let offset = dir.length;
entries.forEach(({ size, data }, i) => {
  const o = 6 + i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, o);
  dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
fs.writeFileSync(out, Buffer.concat([dir, ...entries.map((e) => e.data)]));
console.log(`✔ ${path.relative(root, out)}：${SIZES.join("、")}（${offset} bytes）`);
