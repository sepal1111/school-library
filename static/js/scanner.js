// 條碼輸入元件：
//  1. USB 掃描槍／鍵盤：支援掃描後即時觸發（含 Enter/Tab、滿 13 碼 ISBN 自動觸發、高速掃描自動觸發、中文注音輸入法防呆）。
//  2. 相機掃描：手機/平板觸控裝置提供相機即時掃描與拍照辨識。
import { POST } from "./api.js";
import { beep, esc, icon, modal, toastErr } from "./ui.js";

// 支援學校與幼兒園常用的所有書籍與證件條碼格式：
//  - ean_13 / ean_8：書籍 ISBN
//  - code_128 / code_39：圖書登錄號貼紙、學生證、借閱證
//  - upc_a / upc_e：外文書、進口繪本
//  - codabar / itf：部分圖書館早期編碼
//  - qr_code：數位借書條碼 / QR Code
const FORMATS = [
  "ean_13",
  "code_128",
  "code_39",
  "ean_8",
  "upc_a",
  "upc_e",
  "codabar",
  "itf",
  "qr_code",
];
const isTouch = () => matchMedia("(pointer: coarse)").matches;
export const canLiveCamera = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

// 微軟注音在中文模式下掃描數字鍵時會產生的注音符號對照表
const BOPOMOFO_DIGITS = {
  "ㄅ": "1", "ㄉ": "2", "ˇ": "3", "ˋ": "4", "ㄓ": "5",
  "ˊ": "6", "˙": "7", "ㄚ": "8", "ㄞ": "9", "ㄢ": "0", "ㄦ": "-",
};

/** 清理條碼字串：轉半形、移除空白與連字號，並還原誤開注音輸入法掃描出的符號。 */
export function cleanBarcode(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // 全形英數轉半形
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // 若包含注音數字鍵符號且無一般中文字，還原為數字
  if (/[ㄅㄉˇˋㄓˊ˙ㄚㄞㄢㄦ]/.test(s) && !/[\u4e00-\u9fa5]/.test(s)) {
    s = s.replace(/[ㄅㄉˇˋㄓˊ˙ㄚㄞㄢㄦ]/g, (ch) => BOPOMOFO_DIGITS[ch] ?? ch);
  }
  s = s.replace(/[\s-]+/g, "").toUpperCase();
  // 若為 Code 39 條碼且夾有星號符號（如 *00123*），移除星號
  if (s.startsWith("*") && s.endsWith("*") && s.length > 2) {
    s = s.slice(1, -1);
  }
  return s;
}

function isbn13CheckOk(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isbn10CheckOk(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn10to13(s) {
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}

/** 前端正規化 ISBN-13（支援 ISBN-10 自動轉 13 碼）；非合法 ISBN 回傳 null。 */
export function normalizeIsbnClient(raw) {
  const s = cleanBarcode(raw);
  if (s.length === 13 && (s.startsWith("978") || s.startsWith("979")) && isbn13CheckOk(s)) return s;
  if (s.length === 10 && isbn10CheckOk(s)) return isbn10to13(s);
  return null;
}

let detectorPromise;
/** 瀏覽器內建的條碼辨識（Android Chrome、桌機 Chrome 有；iOS Safari 沒有）。 */
function getNativeDetector() {
  detectorPromise ??= (async () => {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new window.BarcodeDetector({ formats }) : null;
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

function zxingReader() {
  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13,
    Z.BarcodeFormat.CODE_128,
    Z.BarcodeFormat.CODE_39,
    Z.BarcodeFormat.EAN_8,
    Z.BarcodeFormat.UPC_A,
    Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.ITF,
    Z.BarcodeFormat.QR_CODE,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  return new Z.BrowserMultiFormatReader(hints, 150);
}

/** 繞過 ZXing 對 HTMLCanvasElement 的 naturalWidth 缺陷，直接從 ImageData 建立 BinaryBitmap 解碼 */
function decodeCanvasWithZXing(canvas, zxing) {
  try {
    const Z = window.ZXing;
    const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
    const bin = new Z.HybridBinarizer(lum);
    const bmp = new Z.BinaryBitmap(bin);
    const res = zxing.reader.decode(bmp, zxing.hints);
    return res?.getText() || null;
  } catch {
    return null;
  }
}

function keyCodeToChar(code) {
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (code === "Minus" || code === "NumpadSubtract") return "-";
  return "";
}

/**
 * 建立條碼輸入區。
 * @param {HTMLElement} container
 * @param {{ placeholder?: string, onCode: (code: string) => Promise<string|void>|string|void, continuous?: boolean, autofocus?: boolean, enableCamera?: boolean }} opts
 */
export function createScanner(container, opts) {
  const touch = isTouch();
  // 預設在手機/觸控平板上開啟相機按鈕；或由 opts.enableCamera 明確指定
  const showCam = opts.enableCamera ?? touch;
  const live = canLiveCamera();

  container.innerHTML = `
    <div class="scanbox">
      <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"
             placeholder="${esc(opts.placeholder || "掃描條碼或輸入登錄號")}" aria-label="條碼">
      <button class="btn btn-primary" type="button" data-go>確定</button>
      ${showCam ? `<button class="btn" type="button" data-cam>${icon("camera")}<span>${live ? "相機掃描" : "拍照辨識"}</span></button>` : ""}
      <input type="file" accept="image/*" capture="environment" hidden data-file>
    </div>
    ${showCam && !live ? `<div class="scan-hint">提示：目前非 HTTPS 連線無法啟動即時相機，可點按相機以「拍照辨識」；或至「手機連線」頁安裝憑證啟用即時相機。</div>` : ""}`;

  const input = container.querySelector("input[type=text]");
  const fileInput = container.querySelector("[data-file]");

  let keyBuf = "";
  let lastKeyAt = 0;
  let fastCount = 0;
  let scanTimer = null;
  let lastSubCode = "";
  let lastSubAt = 0;
  let composing = false;

  function resetInputState() {
    clearTimeout(scanTimer);
    scanTimer = null;
    keyBuf = "";
    fastCount = 0;
    if (composing) {
      composing = false;
      input.blur();
    }
    input.value = "";
    if (!isTouch() && document.activeElement !== input) input.focus();
  }

  const submit = async (rawCode, { isAuto = false } = {}) => {
    const cleaned = cleanBarcode(rawCode);
    if (!cleaned) return;
    const now = Date.now();
    // 防止同一次掃描因自動觸發 + 掃描槍尾端 Enter 在極短時間內重複送出
    if (isAuto && cleaned === lastSubCode && now - lastSubAt < 280) {
      resetInputState();
      return;
    }
    lastSubCode = cleaned;
    lastSubAt = now;
    resetInputState();

    // 支援一次貼上多組條碼（以空白、逗號、換行分隔）
    const parts = String(rawCode || "")
      .split(/[\r\n,;，；、]+/)
      .map(cleanBarcode)
      .filter(Boolean);
    const codes = parts.length > 1 ? parts : [cleaned];
    let lastMsg;
    for (const c of codes) {
      lastMsg = await opts.onCode(c);
    }
    return lastMsg;
  };

  function checkAutoTrigger() {
    clearTimeout(scanTimer);
    const val = cleanBarcode(input.value) || (fastCount >= 6 ? keyBuf : "");
    if (!val) return;

    // 1. 滿 13 碼合法 ISBN-13（或非 978/979 開頭的合法 10 碼 ISBN）立即觸發搜尋，不需再按確認
    if (
      (val.length === 13 && (val.startsWith("978") || val.startsWith("979")) && isbn13CheckOk(val)) ||
      (val.length === 10 && !val.startsWith("978") && !val.startsWith("979") && isbn10CheckOk(val))
    ) {
      submit(val, { isAuto: true });
      return;
    }

    // 2. 掃描槍高速輸入（連續字元間隔短）時，停頓 100ms 後自動觸發（涵蓋無 Enter 尾碼的掃描槍或登錄號條碼）
    if (fastCount >= 4 && val.length >= 4) {
      scanTimer = setTimeout(() => {
        const finalVal = cleanBarcode(input.value) || keyBuf;
        if (finalVal) submit(finalVal, { isAuto: true });
      }, 100);
    }
  }

  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    checkAutoTrigger();
  });

  input.addEventListener("keydown", (e) => {
    const now = Date.now();
    const dt = now - lastKeyAt;
    lastKeyAt = now;

    if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter" || (e.key === "Tab" && (input.value.trim() || keyBuf.length >= 4))) {
      e.preventDefault();
      const candidate = cleanBarcode(input.value) || keyBuf;
      if (candidate) submit(candidate, { isAuto: fastCount >= 4 });
      return;
    }

    const ch = keyCodeToChar(e.code);
    if (ch) {
      if (dt < 85) {
        fastCount++;
        keyBuf += ch;
      } else {
        fastCount = 1;
        keyBuf = ch;
      }
      // 若處於中文輸入法組字狀態，掃描槍高速輸入滿 13 碼 ISBN 時直接由實體鍵碼觸發
      if (fastCount >= 12 && keyBuf.length === 13 && (keyBuf.startsWith("978") || keyBuf.startsWith("979")) && isbn13CheckOk(keyBuf)) {
        e.preventDefault();
        submit(keyBuf, { isAuto: true });
      } else if (fastCount >= 4) {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
          const finalVal = cleanBarcode(input.value) || keyBuf;
          if (finalVal && fastCount >= 4) submit(finalVal, { isAuto: true });
        }, 110);
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      keyBuf = "";
      fastCount = 0;
    }
  });

  input.addEventListener("input", () => {
    checkAutoTrigger();
  });

  input.addEventListener("paste", () => {
    setTimeout(() => {
      const val = input.value.trim();
      if (val) submit(val, { isAuto: false });
    }, 20);
  });

  container.querySelector("[data-go]").addEventListener("click", () => submit(input.value, { isAuto: false }));
  container.querySelector("[data-cam]")?.addEventListener("click", () => {
    if (live) openCamera((code) => submit(code, { isAuto: true }), opts.continuous);
    else fileInput?.click();
  });
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const code = await decodeImageFile(file);
      if (!code) {
        beep(false);
        toastErr("照片中找不到條碼，請靠近一點、讓條碼清楚對焦後再拍一次");
        return;
      }
      await submit(code, { isAuto: true });
    } catch (err) {
      toastErr(err);
    }
  });

  if (opts.autofocus !== false && !isTouch()) setTimeout(() => input.focus(), 50);
  return { input, focus: () => input.focus() };
}

/** 開啟相機對話框持續辨識。continuous 為 true 時掃到後不關閉，可連續掃多本。 */
async function openCamera(submit, continuous) {
  const m = modal({
    title: "相機掃描",
    body: `<div class="camera-box">
             <video playsinline webkit-playsinline autoplay muted></video>
             <div class="aim" data-aim></div>
             <div class="last" data-last>把條碼或下方英數字對準框內</div>
           </div>
           <div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0 0; gap:8px;">
             <span class="small muted" data-hint>支援條碼或下方英數字文字</span>
             <div style="display:flex; gap:6px;">
               <button class="btn btn-sm btn-secondary" type="button" data-ocr title="點擊直接辨識框內英數字">🔤 辨識英數字</button>
               <button class="btn btn-sm" type="button" data-torch style="display:none;" title="開啟/關閉補光燈">🔦 補光燈</button>
             </div>
           </div>
           <p class="small muted" style="margin:4px 0 0">${continuous ? "可以連續掃描多本，完成後按「完成」。" : ""}</p>`,
    foot: `<button class="btn btn-primary" data-close>${continuous ? "完成" : "取消"}</button>`,
    onClose: () => stop(),
  });
  const video = m.el.querySelector("video");
  const aim = m.el.querySelector("[data-aim]");
  const last = m.el.querySelector("[data-last]");
  const torchBtn = m.el.querySelector("[data-torch]");
  const ocrBtn = m.el.querySelector("[data-ocr]");
  let stream = null;
  let timer = null;
  let ocrTimer = null;
  let stopped = false;
  let lastCode = "";
  let lastAt = 0;
  let torchOn = false;
  let ocrRunning = false;

  function stop() {
    stopped = true;
    clearInterval(timer);
    clearInterval(ocrTimer);
    if (stream) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      stream = null;
    }
  }

  function flashAim() {
    aim?.classList.add("hit");
    setTimeout(() => aim?.classList.remove("hit"), 350);
  }

  async function found(code) {
    const cleaned = cleanBarcode(code);
    if (!cleaned) return;
    const now = Date.now();
    if (cleaned === lastCode && now - lastAt < 2500) return; // 短時間不重複觸發
    lastCode = cleaned;
    lastAt = now;
    beep(true);
    flashAim();
    if (navigator.vibrate) navigator.vibrate(60);
    if (!continuous) {
      m.close();
      await submit(cleaned);
      return;
    }
    last.textContent = `${cleaned} 處理中…`;
    const msg = await submit(cleaned);
    if (!stopped) last.textContent = msg || cleaned;
  }

  // 截取目前中心畫面呼叫後端純離線 OCR 辨識英數字
  async function runOcr({ manual = false } = {}) {
    if (ocrRunning || stopped || video.readyState < 2 || !video.videoWidth) return;
    ocrRunning = true;
    if (manual) last.textContent = "正在辨識英數字…";
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // 裁切畫面中心 75% 寬、50% 高
      const cropW = Math.round(vw * 0.75);
      const cropH = Math.round(vh * 0.5);
      const startX = Math.round((vw - cropW) / 2);
      const startY = Math.round((vh - cropH) / 2);

      const ocrCanvas = document.createElement("canvas");
      ocrCanvas.width = cropW;
      ocrCanvas.height = cropH;
      const ocrCtx = ocrCanvas.getContext("2d");
      ocrCtx.drawImage(video, startX, startY, cropW, cropH, 0, 0, cropW, cropH);

      const dataUrl = ocrCanvas.toDataURL("image/jpeg", 0.9);
      const r = await POST("/scan/ocr", { image: dataUrl });

      if (r?.code) {
        last.textContent = `辨識到：${r.code}`;
        await found(r.code);
        return;
      }
      if (manual) {
        last.textContent = r?.rawText ? `辨識文字：${r.rawText.trim().slice(0, 25)}` : "未在框內辨識到清楚的登錄號或 ISBN";
      }
    } catch {
      if (manual) last.textContent = "辨識失敗，請讓文字更靠近中央並重新對焦";
    } finally {
      ocrRunning = false;
    }
  }

  ocrBtn?.addEventListener("click", () => runOcr({ manual: true }));

  try {
    // 優先以高畫質取得鏡頭，確保條碼細紋與文字清晰
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { min: 640, ideal: 1920 },
          height: { min: 480, ideal: 1080 },
        },
        audio: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    }

    if (stopped) return stop();
    video.srcObject = stream;
    await video.play().catch(() => {});

    // 啟用鏡頭連續自動對焦與手電筒（若硬體支援）
    const track = stream.getVideoTracks()[0];
    if (track) {
      const caps = track.getCapabilities?.() || {};
      const adv = {};
      if (caps.focusMode?.includes("continuous")) adv.focusMode = "continuous";
      if (Object.keys(adv).length) {
        try { await track.applyConstraints({ advanced: [adv] }); } catch {}
      }
      if (caps.torch) {
        torchBtn.style.display = "inline-flex";
        torchBtn.addEventListener("click", async () => {
          torchOn = !torchOn;
          try {
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            torchBtn.classList.toggle("btn-active", torchOn);
          } catch {}
        });
      }
    }

    let nativeDetector = await getNativeDetector();
    const zxing = zxingReader();

    // 離屏 Canvas 用於雙向掃描（0 度與 90 度旋轉）
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rotCanvas = document.createElement("canvas");
    const rotCtx = rotCanvas.getContext("2d", { willReadFrequently: true });

    let scanning = false;
    timer = setInterval(async () => {
      if (scanning || stopped || video.readyState < 2 || !video.videoWidth) return;
      scanning = true;
      try {
        // 1. 原生 BarcodeDetector（硬體加速）
        if (nativeDetector) {
          try {
            const codes = await nativeDetector.detect(video);
            if (codes?.[0]?.rawValue) {
              await found(codes[0].rawValue);
              return;
            }
          } catch {
            nativeDetector = null; // 出錯時降級為純 ZXing
          }
        }

        // 2. 將影格畫到 Canvas（最長邊 1000px，保留清晰度並兼具高速運算）
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const maxSide = 1000;
        const scale = Math.min(1, maxSide / Math.max(vw, vh));
        const cw = Math.round(vw * scale);
        const ch = Math.round(vh * scale);
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        ctx.drawImage(video, 0, 0, cw, ch);

        // 3. ZXing 直接從 ImageData BinaryBitmap 辨識常規方向（修正原本 naturalWidth 崩潰問題）
        const c1 = decodeCanvasWithZXing(canvas, zxing);
        if (c1) {
          await found(c1);
          return;
        }

        // 4. 旋轉 90 度辨識（解決手機直立拿但條碼橫排、或手機橫拿條碼直排時 1D 掃描線掃不到的問題）
        if (rotCanvas.width !== ch || rotCanvas.height !== cw) {
          rotCanvas.width = ch;
          rotCanvas.height = cw;
        }
        rotCtx.save();
        rotCtx.translate(ch / 2, cw / 2);
        rotCtx.rotate((90 * Math.PI) / 180);
        rotCtx.drawImage(canvas, -cw / 2, -ch / 2);
        rotCtx.restore();

        if (nativeDetector) {
          try {
            const codes = await nativeDetector.detect(rotCanvas);
            if (codes?.[0]?.rawValue) {
              await found(codes[0].rawValue);
              return;
            }
          } catch {}
        }

        const c2 = decodeCanvasWithZXing(rotCanvas, zxing);
        if (c2) {
          await found(c2);
          return;
        }
      } catch {
        /* 單次影格解析略過 */
      } finally {
        scanning = false;
      }
    }, 150);

    // 每 1.8 秒若條碼未辨識成功，自動觸發背景英數字 OCR 輔助
    ocrTimer = setInterval(() => {
      if (!stopped && Date.now() - lastAt > 1800) {
        runOcr({ manual: false });
      }
    }, 1800);
  } catch (err) {
    m.close();
    const name = err?.name || "";
    if (name === "NotAllowedError") toastErr("瀏覽器不允許使用相機，請在網址列的設定中允許相機權限");
    else if (name === "NotFoundError") toastErr("找不到相機");
    else toastErr("無法開啟相機：" + (err?.message || name));
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("無法讀取照片"));
    img.src = src;
  });
}

/** 辨識照片中的條碼或英數字；若條碼未讀出則自動執行 OCR。 */
export async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const detector = await getNativeDetector();
    if (detector) {
      try {
        const codes = await detector.detect(img);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        /* 改用 ZXing */
      }
    }
    const reader = zxingReader();
    for (const max of [1400, 1000, 2000, 700]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const c1 = decodeCanvasWithZXing(canvas, reader);
      if (c1) return c1;

      // 旋轉 90 度
      const rot = document.createElement("canvas");
      rot.width = canvas.height;
      rot.height = canvas.width;
      const rctx = rot.getContext("2d");
      rctx.translate(rot.width / 2, rot.height / 2);
      rctx.rotate((90 * Math.PI) / 180);
      rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      const c2 = decodeCanvasWithZXing(rot, reader);
      if (c2) return c2;
    }

    // 條碼未辨識出時，自動轉入後端 OCR 辨識英數字（如印出的登錄號或 ISBN）
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const ret = await POST("/scan/ocr", { image: dataUrl });
      if (ret?.code) return ret.code;
    } catch {}

    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 把圖片檔或 data URL 縮小成 JPEG data URL（封面用，長邊 600px）。 */
export async function resizeImage(src, maxSide = 600, quality = 0.85) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    if (src instanceof Blob) URL.revokeObjectURL(url);
  }
}
