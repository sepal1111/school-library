# 幼兒園圖書借閱系統（school-library）

[![Build](https://github.com/sepal1111/school-library/actions/workflows/build.yml/badge.svg)](https://github.com/sepal1111/school-library/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/sepal1111/school-library)](https://github.com/sepal1111/school-library/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

管理幼兒園的教學用圖書，記錄老師借書、還書，隨時知道每本書在誰手上。

- 在一台 Windows 電腦上執行，同一個 Wi-Fi 內的電腦、手機、平板都能用瀏覽器操作。
- 可攜版：整個資料夾複製到其他電腦或隨身碟就能用，不需要安裝。
- 除了 ISBN 線上查詢，其他功能都不需要網際網路。

適用規模：藏書 500 冊以內、約 10 位老師。借閱對象只有老師，不提供幼兒借閱、預約、罰款或通知功能。

## 主要功能

| 功能 | 說明 |
|---|---|
| 借書 | 掃描書上的條碼就立即借出。掃錯時可以「取消借出」（限當天），不會留下紀錄 |
| 還書 | 每掃一本就立即歸還，並顯示是否逾期 |
| 新增書籍 | 掃描 ISBN 自動查詢書名、作者、出版社與封面（國家圖書館 NBINet → Google Books → Open Library）；查不到時手動輸入，也能拍照補封面 |
| 條碼標籤 | 自動產生登錄號（例如 `K0001`），以 Code 128 列印 A4 標籤，可以從第 N 格開始印 |
| 條碼掃描 | USB 掃描槍、手機／平板相機即時掃描（需 HTTPS）、拍照辨識；條碼讀不到時可以辨識書上的 ISBN 或登錄號文字（離線 OCR） |
| 報表 | 借出清單、逾期、借閱紀錄、藏書清冊，可以匯出 Excel |
| 帳號與權限 | 管理員與一般老師兩種角色。一般老師只能借還與查看自己的紀錄 |
| 備份 | 每次啟動自動備份（保留最近 10 份），也能一鍵備份、下載與還原 |

## 下載

到 [Releases](https://github.com/sepal1111/school-library/releases/latest) 下載 `school-library-v<版本>-win-x64.zip`，約 50 MB。

- 系統需求：Windows 10 或 11（64 位元）。不需要另外安裝 Node.js 或其他軟體。
- 下載後可以用 Release 頁面附的 `SHA256SUMS.txt` 核對檔案。在 PowerShell 執行 `Get-FileHash 檔名.zip`，結果要和 `SHA256SUMS.txt` 裡的值相同。

## 給使用者：開始使用

1. 在 zip 上按右鍵 →「解壓縮全部」，放到固定的資料夾，例如 `D:\圖書借閱系統`。不要直接在 zip 裡執行。
2. 雙擊 `圖書借閱系統.exe`。會出現一個黑色視窗，並自動開啟瀏覽器。
   - 第一次執行時，Windows 可能顯示「Windows 已保護您的電腦」。這是因為程式沒有數位簽章，請按「其他資訊 → 仍要執行」。
   - 使用期間不要關閉黑色視窗，關閉它就是結束系統。
3. 第一次執行時，如果 Windows 防火牆詢問是否允許網路存取，請勾選「私人網路」再按「允許存取」。這樣手機和平板才能連線。
4. 用帳號 `admin`、密碼 `admin` 登入，系統會要求立刻改成新密碼。
5. 依序設定：
   1. 「管理 → 系統設定」：學校名稱
   2. 「管理 → 班級」：建立班級
   3. 「管理 → 老師帳號」：建立老師帳號
6. 到「新增書籍」掃描 ISBN 建檔，再到「列印條碼標籤」印出標籤貼到書上。

**手機／平板連線**：手機要和主機連同一個 Wi-Fi，用手機掃描黑色視窗上的 QR Code 即可連線。第一次連線會出現「不是私人連線」的憑證警告，選「進階 → 繼續前往」即可。

**資料位置**：所有資料都在 exe 旁邊的 `bin\` 資料夾。搬到另一台電腦時，把整個資料夾（含 `bin\`）複製過去就好。

**升級到新版**：

1. 關閉黑色視窗。
2. 先備份舊資料夾裡的 `bin\`。
3. 把新版解壓縮到新資料夾，再把舊的 `bin\` 整個複製過去。
4. 啟動新版，資料會自動升級。

升級後不要再用舊版開啟同一份資料，舊版會拒絕開啟較新版本的資料。各版變更請看 [CHANGELOG.md](CHANGELOG.md)。

詳細操作請看 [使用說明.txt](使用說明.txt)。

**問題回報**：請到 [Issues](https://github.com/sepal1111/school-library/issues) 回報。安全性問題請依照 [SECURITY.md](SECURITY.md) 私下回報。

## 給開發者

### 技術架構

| 層 | 技術 |
|---|---|
| 後端 | Node.js 24、Express、TypeScript |
| 資料庫 | SQLite（Node 內建 `node:sqlite`，不需要原生模組） |
| 前端 | 原生 HTML／CSS／JavaScript（ES modules），以手機操作為優先 |
| 條碼 | `BarcodeDetector`，不支援時改用 ZXing 辨識；JsBarcode 產生標籤 |
| 字型 | jf 粉圓體 v2.1（SIL OFL 1.1） |
| 封裝 | esbuild 打包成單一檔案，再用 `@yao-pkg/pkg` 做成 Windows exe |
| HTTPS | 自簽憑證（`selfsigned`），供手機相機掃描使用 |

### 開發

需要 Node.js 24 以上。

```bash
npm install
```

`npm install` 會把 ZXing、JsBarcode 複製到 `static/vendor/`。

```bash
npm run dev
```

開發模式會自動重新載入。資料存在專案根目錄的 `bin/`。

```bash
npx tsc --noEmit
```

型別檢查。

### 建置可攜版 exe

```bash
npm run release:win
```

建置後自動跑冒煙測試。也可以分開執行：

```bash
node scripts/build-exe.mjs
```

```bash
node scripts/smoke-test.mjs
```

`build-exe.mjs` 加上 `--no-zip` 只建資料夾，不產生 zip，速度比較快。

輸出：

```
release/
├─ 圖書借閱系統/
│  ├─ 圖書借閱系統.exe          有圖示與版本資訊
│  ├─ 使用說明.txt
│  ├─ LICENSE.txt               專案根目錄有 LICENSE 時才會複製
│  ├─ THIRD_PARTY_NOTICES.txt   從實際打包的套件自動產生
│  ├─ system/                   前端檔案（static/）與 OCR 辨識檔案（ocr/）
│  └─ bin/                      資料（第一次執行時建立；重新建置時會保留）
├─ school-library-v<版本>-win-x64.zip   上面的資料夾，不含 bin/
└─ SHA256SUMS.txt
```

- 版本號只改 `package.json`，exe、主控台、備份檔都會跟著變。
- 冒煙測試會把可攜版複製到暫存資料夾、從其他工作目錄啟動 exe，測試首頁、HTTPS、登入、Excel 匯出、備份與 OCR，結束後清掉暫存資料。
- exe 圖示是 `assets/icon.ico`。建置時先把圖示與版本資訊寫進 Node 基底檔（放在 `.pkg-cache/`），再交給 pkg 打包。

### 持續整合與發佈新版本

`.github/workflows/build.yml` 在 Windows 上執行：

| 觸發 | 做什麼 |
|---|---|
| push 到 `main`、PR、手動執行 | 型別檢查 → 建置 → 冒煙測試 → 把 zip 上傳成 workflow artifact（保留 14 天） |
| push 標籤 `v*` | 以上全部，再建立 GitHub Release **草稿**，附上 zip 與 `SHA256SUMS.txt` |

發佈新版本的步驟：

1. 修改 `package.json` 的 `version`。
2. 在 `CHANGELOG.md` 把「未發佈」的內容移到新的 `## [x.y.z] - 日期` 段落。
3. commit 並 push 到 `main`，確認 Build 通過。
4. 打標籤並推送：

   ```bash
   git tag v1.0.0
   ```

   ```bash
   git push origin v1.0.0
   ```

5. 到 GitHub 的 Releases 找到草稿，下載 zip 實際測試，沒問題再按「Publish release」。

標籤和 `package.json` 的版本不一致、或 `CHANGELOG.md` 沒有該版段落時，建置會失敗，不會產生草稿。Release 說明由 `scripts/release-notes.mjs` 從 `CHANGELOG.md` 取出，並加上下載與升級說明。

### 環境變數

| 變數 | 用途 |
|---|---|
| `SCHOOL_LIB_PORT` | 起始連接埠，預設 8300。HTTP 用這個埠，HTTPS 用下一個埠；被占用時自動往後找 |
| `SCHOOL_LIB_DB_PATH` | 指定資料庫檔案位置（測試用） |
| `SCHOOL_LIB_NO_BROWSER=1` | 啟動時不自動開啟瀏覽器 |

同一份資料只能有一個伺服器執行（以 `bin/runtime.json` 判斷）。重複啟動時會直接開啟已在執行的系統。

### 目錄結構

```
school-library/
├─ src/              後端
│  ├─ index.ts         進入點（啟動、連接埠、HTTPS、QR Code）
│  ├─ db.ts            資料表、設定、登錄號產生
│  ├─ auth.ts          登入與權限
│  ├─ isbn.ts          ISBN 驗證與線上查詢
│  ├─ backup.ts        備份與還原
│  └─ routes/          API（auth、admin、books、loans、reports、system）
├─ static/           前端
│  ├─ js/app.js        路由、登入、首頁
│  ├─ js/scanner.js    條碼掃描
│  ├─ js/pages/        借還書、書籍、管理頁面
│  ├─ css/app.css      樣式
│  ├─ fonts/           jf 粉圓體
│  └─ vendor/          ZXing、JsBarcode（自動複製，不進版控）
├─ assets/           exe 圖示 icon.ico、OCR 英文語言檔 ocr/eng.traineddata
├─ scripts/          建置（build-exe.mjs）、冒煙測試（smoke-test.mjs）、Release 說明（release-notes.mjs）
├─ .github/          GitHub Actions、Issue 範本
├─ release/          建置輸出（不進版控）
└─ bin/              執行期資料（不進版控）
```

完整的資料模型、權限與各功能規則請看 [開發規格.md](開發規格.md)。

## 預設設定

在「管理 → 系統設定」可以修改：

- 借期 30 天
- 每人最多借 10 本
- 登錄號字首 `K`

## 授權

- 程式碼：[MIT License](LICENSE)。
- 第三方元件：各依其授權條款散布，建置時會自動產生 `THIRD_PARTY_NOTICES.txt` 放進可攜版。OCR 用的 tesseract.js、tesseract.js-core、eng.traineddata 與前端的 ZXing 是 Apache-2.0。
- jf 粉圓體：SIL Open Font License 1.1，授權全文見 [static/fonts/OFL-jf-openhuninn.txt](static/fonts/OFL-jf-openhuninn.txt)。
