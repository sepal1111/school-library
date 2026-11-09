// 共用的畫面工具：跳脫、圖示、提示訊息、對話框、格式化。

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** 標記樣板：自動跳脫插入值；用 raw() 包住的值不跳脫（已組好的 HTML）。 */
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += renderValue(values[i]);
  });
  return new Raw(out);
}
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);
function renderValue(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

// ---------- 圖示（線條風格，24x24） ----------
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  borrow: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  return: '<path d="M12 20V8"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  book: '<path d="M4 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-4a3 3 0 0 0-3 3"/><path d="M20 5v13h-5"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  label: '<path d="M4 6h16v12H4z"/><path d="M7 9v6M10 9v6M12 9v6M15 9v6M17 9v6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  class: '<path d="M3 21V9l9-5 9 5v12"/><path d="M9 21v-6h6v6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  backup: '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  barcode: '<path d="M4 5v14M7 5v14M10 5v14M13 5v14M16 5v14M20 5v14"/>',
};
export function icon(name, cls = "") {
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`
  );
}

// ---------- 提示訊息 ----------
export function toast(msg, type = "") {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === "err" ? 5000 : 2800);
}
export const toastOk = (m) => toast(m, "ok");
export const toastErr = (e) => toast(e?.message || String(e), "err");

/** 短促提示音：成功一聲高音，失敗兩聲低音（掃描時不用一直看螢幕）。 */
let audioCtx;
export function beep(ok = true) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const play = (freq, at) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.15, audioCtx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + at + 0.15);
      o.start(audioCtx.currentTime + at);
      o.stop(audioCtx.currentTime + at + 0.16);
    };
    if (ok) play(1320, 0);
    else (play(330, 0), play(260, 0.18));
  } catch {
    /* 不支援音效就略過 */
  }
}

// ---------- 對話框 ----------
/**
 * 開啟對話框。content 為 HTML；回傳 { el, close }。
 * onClose 在關閉時呼叫（含按背景或 Esc）。
 */
export function modal({ title, body, foot = "", wide = false, onClose }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="關閉">${icon("close")}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
    </div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    wrap.remove();
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("mousedown", (e) => e.target === wrap && close());
  wrap.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.body.appendChild(wrap);
  const first = wrap.querySelector("input:not([type=hidden]), select, textarea");
  if (first && !matchMedia("(pointer: coarse)").matches) first.focus();
  return { el: wrap, close };
}

export function confirmDialog(message, { okText = "確定", cancelText = "取消", danger = false, title = "請確認" } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title,
      body: `<p style="margin:4px 0 8px">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>${esc(cancelText)}</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(result),
    });
    m.el.querySelector("[data-ok]").addEventListener("click", () => {
      result = true;
      m.close();
    });
    m.el.querySelector("[data-ok]").focus();
  });
}

/** 表單對話框：fields 為 HTML；送出時呼叫 onSubmit(FormData)，丟錯會顯示錯誤並保持開啟。 */
export function formDialog({ title, fields, submitText = "儲存", onSubmit, wide = false }) {
  const m = modal({
    title,
    wide,
    body: `<form class="stack" id="dlgForm">${fields}<button type="submit" hidden></button></form>`,
    foot: `<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-submit type="button">${esc(submitText)}</button>`,
  });
  const form = m.el.querySelector("#dlgForm");
  const btn = m.el.querySelector("[data-submit]");
  const submit = async (e) => {
    e?.preventDefault();
    btn.disabled = true;
    try {
      await onSubmit(new FormData(form), form);
      m.close();
    } catch (err) {
      toastErr(err);
    } finally {
      btn.disabled = false;
    }
  };
  form.addEventListener("submit", submit);
  btn.addEventListener("click", submit);
  return m;
}

// ---------- 格式化 ----------
export function fmtDate(s) {
  if (!s) return "";
  return s.slice(0, 10).replace(/-/g, "/");
}
export function fmtDateTime(s) {
  if (!s) return "";
  return s.slice(0, 16).replace(/-/g, "/");
}
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS = { available: "在架", on_loan: "借出", lost: "遺失", withdrawn: "註銷" };
export function statusTag(status) {
  return html`<span class="tag tag-${status}">${STATUS[status] || status}</span>`;
}

/** 封面：有圖顯示圖；沒圖顯示彩色書皮和書名（顏色依書名固定，同一本書每次都一樣）。 */
export function cover(url, title, cls = "") {
  if (url) return html`<div class="cover ${raw(cls)}"><img src="${url}" alt="" loading="lazy"></div>`;
  // FNV-1a 雜湊，讓相近的書名也能分到不同顏色
  let h = 2166136261;
  for (const ch of String(title ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return html`<div class="cover ${raw(cls)}"><div class="cover-ph c${h % 6}">${title}</div></div>`;
}

// ---------- 插圖 ----------
/** 吉祥物：會笑的小書。 */
export const mascot = (cls = "") =>
  raw(`<svg class="${cls}" viewBox="0 0 64 56" aria-hidden="true">
    <ellipse cx="32" cy="52" rx="22" ry="3" fill="#f0dfc2"/>
    <path d="M6 10c9-5 18-4 26 2v36c-8-6-17-7-26-2z" fill="#ffd76a" stroke="#3b2f25" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M58 10c-9-5-18-4-26 2v36c8-6 17-7 26-2z" fill="#ffb070" stroke="#3b2f25" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="19" cy="24" r="2.2" fill="#3b2f25"/><circle cx="45" cy="24" r="2.2" fill="#3b2f25"/>
    <path d="M26 31c3 3 9 3 12 0" fill="none" stroke="#3b2f25" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="14" cy="30" r="3" fill="#ff8fab" opacity=".7"/><circle cx="50" cy="30" r="3" fill="#ff8fab" opacity=".7"/>
  </svg>`);

export const sunArt = (cls = "") =>
  raw(`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <g stroke="#ffb703" stroke-width="6" stroke-linecap="round">
      <path d="M50 4v12M50 84v12M4 50h12M84 50h12M17 17l9 9M74 74l9 9M17 83l9-9M74 26l9-9"/>
    </g>
    <circle cx="50" cy="50" r="24" fill="#ffc83d" stroke="#f4a300" stroke-width="3"/>
    <circle cx="42" cy="47" r="2.6" fill="#7a4b00"/><circle cx="58" cy="47" r="2.6" fill="#7a4b00"/>
    <path d="M42 56c4 4 12 4 16 0" fill="none" stroke="#7a4b00" stroke-width="3" stroke-linecap="round"/>
  </svg>`);

export const cloudArt = (cls = "") =>
  raw(`<svg class="${cls}" viewBox="0 0 120 60" aria-hidden="true">
    <path d="M28 52a18 18 0 0 1 2-36 24 24 0 0 1 44-6 20 20 0 0 1 22 18 12 12 0 0 1-2 24z" fill="#fff" stroke="#cfe3f3" stroke-width="3" stroke-linejoin="round"/>
  </svg>`);

/** 登入頁下方的草地與小花。 */
export const meadowArt = () =>
  raw(`<svg viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 220V120c200-70 400-70 600 0s400 60 600-10v110z" fill="#a8dd87"/>
    <path d="M0 220v-50c260-50 520-40 780 0s300 20 420-10v60z" fill="#74c552"/>
    <g fill="#fff"><circle cx="160" cy="170" r="6"/><circle cx="420" cy="190" r="6"/><circle cx="880" cy="180" r="6"/><circle cx="1080" cy="196" r="6"/></g>
    <g fill="#ffc83d"><circle cx="160" cy="170" r="2.6"/><circle cx="880" cy="180" r="2.6"/></g>
    <g fill="#ff8fab"><circle cx="420" cy="190" r="2.6"/><circle cx="1080" cy="196" r="2.6"/></g>
  </svg>`);

export function dueText(r) {
  if (r.overdueDays > 0) return html`<span class="due">逾期 ${r.overdueDays} 天</span>（應還 ${fmtDate(r.dueAt)}）`;
  return html`應還 ${fmtDate(r.dueAt)}`;
}

/** 防連點：執行期間停用按鈕。 */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
  }
}

/** 觸發檔案下載（以連結方式，瀏覽器會帶 cookie）。 */
export function download(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
