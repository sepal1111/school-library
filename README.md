# 幼兒園圖書借閱系統（school-library）

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
| 條碼掃描 | USB 掃描槍、手機／平板相機即時掃描（需 HTTPS）、拍照辨識 |
| 報表 | 借出清單、逾期、借閱紀錄、藏書清冊，可以匯出 Excel |
| 帳號與權限 | 管理員與一般老師兩種角色。一般老師只能借還與查看自己的紀錄 |
| 備份 | 每次啟動自動備份（保留最近 10 份），也能一鍵備份、下載與還原 |

## 給使用者：開始使用

使用建置好的 `release/圖書借閱系統/` 資料夾（建置方式見下方「建置可攜版 exe」）。

1. 雙擊 `圖書借閱系統.exe`。會出現一個黑色視窗，並自動開啟瀏覽器。
   - 使用期間不要關閉黑色視窗，關閉它就是結束系統。
2. 第一次執行時，如果 Windows 防火牆詢問是否允許網路存取，請勾選「私人網路」再按「允許存取」。這樣手機和平板才能連線。
3. 用帳號 `admin`、密碼 `admin` 登入，系統會要求立刻改成新密碼。
4. 依序設定：
   1. 「管理 → 系統設定」：學校名稱
   2. 「管理 → 班級」：建立班級
   3. 「管理 → 老師帳號」：建立老師帳號
5. 到「新增書籍」掃描 ISBN 建檔，再到「列印條碼標籤」印出標籤貼到書上。

**手機／平板連線**：手機要和主機連同一個 Wi-Fi，用手機掃描黑色視窗上的 QR Code 即可連線。第一次連線會出現「不是私人連線」的憑證警告，選「進階 → 繼續前往」即可。

**資料位置**：所有資料都在 exe 旁邊的 `bin\` 資料夾。搬到另一台電腦時，把整個資料夾（含 `bin\`）複製過去就好。

詳細操作請看 [使用說明.txt](使用說明.txt)。

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
node scripts/build-exe.mjs
```

輸出到 `release/圖書借閱系統/`：

```
圖書借閱系統/
├─ 圖書借閱系統.exe
├─ 使用說明.txt
├─ system/   前端檔案
└─ bin/      資料（第一次執行時建立；重新建置時會保留）
```

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
├─ scripts/          建置腳本
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

- 程式碼：私人專案，未公開授權。
- jf 粉圓體：SIL Open Font License 1.1，授權全文見 [static/fonts/OFL-jf-openhuninn.txt](static/fonts/OFL-jf-openhuninn.txt)。
