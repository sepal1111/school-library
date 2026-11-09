// 準備一份帶有圖示與版本資訊的 Node 基底執行檔，給 pkg 使用（透過 PKG_NODE_PATH）。
//
// 為什麼不直接改 pkg 產生的 exe：pkg 把程式附加在 exe 尾端，並把「附加資料的絕對位置」寫進 exe 裡。
// 事後修改資源會讓 PE 區段變大、附加資料往後移，exe 就找不到自己的程式了。
// 所以改成先修改基底檔，再讓 pkg 把程式附加上去。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as ResEdit from "resedit";

const require = createRequire(import.meta.url);

/**
 * @param {object} o
 * @param {string} o.root        專案根目錄
 * @param {string} o.iconPath    .ico 檔
 * @param {string} o.version     例如 "1.0.0"
 * @param {string} o.productName 產品名稱（檔案內容→詳細資料）
 * @param {string} o.description 檔案描述
 * @param {string} o.exeName     原始檔名
 * @param {boolean} [o.gui]      true：不開命令提示字元視窗（Windows GUI 子系統）
 * @returns {Promise<string>}    修改後的基底檔路徑
 */
export async function prepareWinBase({ root, iconPath, version, productName, description, exeName, gui = false }) {
  const { need } = require("@yao-pkg/pkg-fetch");
  const fetched = await need({ nodeRange: "node24", platform: "win", arch: "x64" });

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(fetched), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  // 圖示：取代 Node 原本的圖示群組
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups[0]?.id ?? 1;
  const lang = groups[0]?.lang ?? 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    groupId,
    lang,
    ico.icons.map((i) => i.data)
  );

  // 版本資訊：沿用 Node 原本的 VersionInfo 結構，改寫欄位
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const nums = version.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const [major = 0, minor = 0, patch = 0] = nums;
  vi.setFileVersion(major, minor, patch, 0, 1033);
  vi.setProductVersion(major, minor, patch, 0, 1033);
  // Node 的 VersionInfo 只有 1033（英文）語系；中文欄位直接寫在同一個語系
  for (const lang of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(lang, {
      FileDescription: description,
      ProductName: productName,
      OriginalFilename: exeName,
      InternalName: path.basename(exeName, ".exe"),
      CompanyName: "",
      LegalCopyright: "",
      FileVersion: version,
      ProductVersion: version,
    });
  }
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  const buf = Buffer.from(exe.generate());
  if (gui) setGuiSubsystem(buf);
  const outDir = path.join(root, ".pkg-cache");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `node24-win-x64-${path.basename(fetched)}-patched.exe`);
  fs.writeFileSync(out, buf);
  return out;
}

/**
 * 把 PE 檔頭的 Subsystem 從 CONSOLE（3）改成 WINDOWS_GUI（2）：
 * 雙擊執行時不會開出命令提示字元視窗。Node 在沒有主控台時會把 console 輸出丟掉，
 * 但如果由其他程式用管線（pipe）啟動，標準輸出仍然可以讀到（冒煙測試靠這個）。
 */
function setGuiSubsystem(buf) {
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("不是有效的 PE 檔");
  const subsystemOffset = peOffset + 24 + 68; // PE 簽章 4 + COFF 檔頭 20，Optional Header 內第 68 位元組
  const current = buf.readUInt16LE(subsystemOffset);
  if (current !== 3 && current !== 2) throw new Error(`未預期的 Subsystem 值：${current}`);
  buf.writeUInt16LE(2, subsystemOffset);
}
