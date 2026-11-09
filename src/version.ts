// 版本號只在 package.json 維護。建置 exe 時由 esbuild 的 define 把 __APP_VERSION__ 換成字串；
// 開發模式（tsx）沒有 define，直接讀 package.json。
declare const __APP_VERSION__: string | undefined;

export const VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : (require("../package.json") as { version: string }).version;
