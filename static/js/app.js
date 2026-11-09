// 前端進入點：登入狀態、路由（#/路徑）、導覽列、首頁與共用頁面。
import { GET, POST, onAuthProblem } from "./api.js";
import { $, busy, cloudArt, cover, dueText, esc, heroArt, html, icon, mascot, meadowArt, raw, sunArt, toastErr, toastOk } from "./ui.js";
import * as circ from "./pages/circulation.js";
import * as books from "./pages/books.js";
import * as admin from "./pages/admin.js";

export const state = { user: null, schoolName: "" };
export const isAdmin = () => state.user?.role === "admin";

const app = document.getElementById("app");

// ---------- 路由 ----------
const routes = [
  ["/", home],
  ["/borrow", circ.borrowPage],
  ["/return", circ.returnPage],
  ["/loans", circ.activeLoansPage],
  ["/history", circ.historyPage],
  ["/books", books.listPage],
  ["/books/new", books.newBookPage, true],
  ["/books/:id", books.detailPage],
  ["/books/:id/edit", books.editBookPage, true],
  ["/labels", books.labelsPage, true],
  ["/admin/users", admin.usersPage, true],
  ["/admin/classes", admin.classesPage, true],
  ["/admin/settings", admin.settingsPage, true],
  ["/admin/backup", admin.backupPage, true],
  ["/more", morePage],
  ["/connect", connectPage],
  ["/password", passwordPage],
];

function match(path) {
  const parts = path.split("/").filter(Boolean);
  for (const [pattern, fn, adminOnly] of routes) {
    const pp = pattern.split("/").filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) {
      return { fn, params, adminOnly };
    }
  }
  return null;
}

let cleanup = null;
let renderSeq = 0;

export function currentPath() {
  const h = location.hash.replace(/^#/, "") || "/";
  return h.split("?")[0];
}
export function currentQuery() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}
export function go(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

async function render() {
  const seq = ++renderSeq;
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
  }
  cleanup = null;
  if (!state.user) return loginPage();
  if (state.user.mustChangePassword) return passwordPage({ forced: true });

  showChrome(true);
  const path = currentPath();
  updateNav(path);
  const m = match(path);
  if (!m || (m.adminOnly && !isAdmin())) {
    app.innerHTML = `<div class="card empty">找不到這個頁面。<br><br><a class="btn" href="#/">回首頁</a></div>`;
    return;
  }
  app.innerHTML = `<div class="loading">載入中…</div>`;
  window.scrollTo(0, 0);
  try {
    const c = await m.fn(app, m.params, currentQuery());
    if (seq === renderSeq) cleanup = c;
    else if (typeof c === "function") c();
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err?.code === "LOGIN_REQUIRED" || err?.code === "MUST_CHANGE_PASSWORD") return;
    app.innerHTML = html`<div class="card"><div class="alert alert-danger">${err.message || err}</div></div>`.toString();
  }
}

// ---------- 導覽 ----------
function navItems() {
  const items = [
    ["/", "首頁", "home"],
    ["/borrow", "借書", "borrow"],
    ["/return", "還書", "return"],
    ["/books", "查書", "search"],
    ["/loans", isAdmin() ? "借出清單" : "我的借閱", "list"],
    ["/history", "借閱紀錄", "history"],
  ];
  if (isAdmin()) items.push(["/more", "管理", "settings"]);
  else items.push(["/more", "更多", "more"]);
  return items;
}

function isActive(path, target) {
  if (target === "/") return path === "/";
  if (target === "/more") return ["/more", "/admin", "/labels", "/connect", "/password"].some((p) => path.startsWith(p));
  return path === target || path.startsWith(target + "/");
}

function updateNav(path) {
  $("#topnav").innerHTML = navItems()
    .map(([p, label]) => `<a href="#${p}" class="${isActive(path, p) ? "active" : ""}">${esc(label)}</a>`)
    .join("");
  const tabs = [
    ["/", "首頁", "home"],
    ["/borrow", "借書", "borrow"],
    ["/return", "還書", "return"],
    ["/books", "查書", "search"],
    ["/more", "更多", "more"],
  ];
  $("#tabbar").innerHTML = tabs
    .map(([p, label, ic]) => `<a href="#${p}" class="${isActive(path, p) || (p === "/more" && ["/loans", "/history"].includes(path)) ? "active" : ""}"><span class="tab-ic">${icon(ic)}</span><span>${esc(label)}</span></a>`)
    .join("");
  $("#who").innerHTML = html`<span class="who-name">${state.user.name}（${state.user.className}）</span><a href="#" data-logout>登出</a>`.toString();
  $("#who [data-logout]").onclick = (e) => {
    e.preventDefault();
    logout();
  };
}

function showChrome(on) {
  $("#topbar").hidden = !on;
  $("#tabbar").hidden = !on;
  $("#schoolName").textContent = state.schoolName ? `${state.schoolName} ` : "";
  document.title = `${state.schoolName ? state.schoolName + " " : ""}圖書借閱系統`;
}

export async function logout() {
  try {
    await POST("/auth/logout");
  } catch {
    /* ignore */
  }
  state.user = null;
  location.hash = "/";
  render();
}

// ---------- 登入 ----------
function loginPage() {
  showChrome(false);
  app.innerHTML = `
    <div class="login-wrap">
      ${loginScene()}
      <form class="card login-card stack" id="loginForm">
        ${mascot("logo")}
        <h1>${esc(state.schoolName || "幼兒園")}圖書借閱</h1>
        <p class="sub">老師好！請登入後開始借書、還書</p>
        <label class="field"><span>帳號</span><input type="text" name="username" autocomplete="username" autocapitalize="off" required></label>
        <label class="field"><span>密碼</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary btn-lg btn-block" type="submit">登入</button>
        <p class="small muted" style="text-align:center;margin:6px 0 0">忘記密碼請洽管理員重設</p>
      </form>
    </div>`;
  const form = $("#loginForm");
  form.username.focus();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector("button"), async () => {
      try {
        const r = await POST("/auth/login", { username: form.username.value, password: form.password.value });
        state.user = r.user;
        render();
      } catch (err) {
        toastErr(err);
        form.password.select();
      }
    });
  });
}

/** 登入頁背景：太陽、雲、草地（純裝飾）。 */
function loginScene() {
  return `${sunArt("login-sun")}${cloudArt("login-cloud c1")}${cloudArt("login-cloud c2")}<div class="login-scene">${meadowArt()}</div>`;
}

function passwordPage(opts = {}) {
  const forced = opts.forced === true;
  showChrome(!forced);
  const body = `
      <form class="card ${forced ? "login-card" : ""} stack" id="pwForm" style="max-width:420px">
        ${forced ? `<div class="logo round">${icon("key")}</div>` : ""}
        <h1>${forced ? "請設定新密碼" : "修改密碼"}</h1>
        ${forced ? `<p class="sub">第一次登入或密碼已被重設，請設定自己的密碼。</p>` : ""}
        <label class="field"><span>目前的密碼</span><input type="password" name="oldPassword" autocomplete="current-password" required></label>
        <label class="field"><span>新密碼 <span class="hint">至少 6 個字元</span></span><input type="password" name="newPassword" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>再輸入一次新密碼</span><input type="password" name="confirm" autocomplete="new-password" required></label>
        <button class="btn btn-primary btn-lg btn-block" type="submit">儲存新密碼</button>
        ${forced ? `<button class="btn btn-ghost btn-block" type="button" data-logout>改用其他帳號登入</button>` : ""}
      </form>`;
  app.innerHTML = forced ? `<div class="login-wrap">${loginScene()}${body}</div>` : body;
  const form = $("#pwForm");
  form.oldPassword.focus();
  form.querySelector("[data-logout]")?.addEventListener("click", logout);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (form.newPassword.value !== form.confirm.value) return toastErr("兩次輸入的新密碼不一樣");
    busy(form.querySelector("button[type=submit]"), async () => {
      try {
        const r = await POST("/auth/change-password", { oldPassword: form.oldPassword.value, newPassword: form.newPassword.value });
        state.user = r.user;
        toastOk("密碼已更新");
        go("/");
      } catch (err) {
        toastErr(err);
      }
    });
  });
}

// ---------- 首頁 ----------
export function loanListItems(rows, { showBorrower = false } = {}) {
  if (!rows.length) return html`<div class="empty">目前沒有借閱中的書</div>`;
  return html`<div class="list">${rows.map(
    (r) => html`
      <div class="list-item ${r.overdueDays > 0 ? "overdue" : ""}">
        <div class="main">
          <div class="t"><a href="#/books/${r.bookId}" style="color:inherit;text-decoration:none">${r.title}</a></div>
          <div class="s"><span class="mono">${r.accessionNo}</span>${showBorrower ? html` · ${r.borrowerName}（${r.className}）` : ""} · ${dueText(r)}</div>
        </div>
        ${r.overdueDays > 0 ? html`<span class="tag tag-danger">逾期</span>` : ""}
      </div>`
  )}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "早安";
  if (h < 18) return "午安";
  return "晚安";
}

function todayLabel() {
  const d = new Date();
  const week = "日一二三四五六"[d.getDay()];
  return `今天是 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${week}，一起來讀故事吧`;
}

async function home(el) {
  const d = await GET("/dashboard");
  const overdueMine = d.mine.filter((r) => r.overdueDays > 0).length;
  const s = d.stats;
  el.innerHTML = html`
    <section class="hero">
      <div class="hero-text">
        <h1>${state.user.name}，${greeting()}！</h1>
        <p class="hello-day">${todayLabel()}</p>
        <div class="chips">
          <span class="chip">${state.user.className}</span>
          <span class="chip">借期 ${d.loanDays} 天</span>
          <span class="chip">每人最多 ${d.maxLoansPerUser} 本</span>
        </div>
      </div>
      ${heroArt("hero-art")}
    </section>
    <div class="big-actions">
      <a class="big-action borrow" href="#/borrow"><span class="ba-icon">${icon("borrow")}</span><span class="ba-text"><b>借書</b><small>掃描書上的條碼借出</small></span></a>
      <a class="big-action return" href="#/return"><span class="ba-icon">${icon("return")}</span><span class="ba-text"><b>還書</b><small>把書放回書櫃前掃一下</small></span></a>
    </div>

    ${isAdmin() && d.backupDaysAgo === null && s.titles > 0
      ? html`<div class="alert" style="margin-top:14px">${icon("warn")}<span>還沒有備份過資料。</span><a class="btn btn-sm" href="#/admin/backup">前往備份</a></div>`
      : ""}
    ${isAdmin() && d.backupDaysAgo !== null && d.backupDaysAgo > 30
      ? html`<div class="alert" style="margin-top:14px">${icon("warn")}<span>已經 ${d.backupDaysAgo} 天沒有備份。</span><a class="btn btn-sm" href="#/admin/backup">前往備份</a></div>`
      : ""}
    ${isAdmin() && d.update
      ? html`<div class="alert alert-info" style="margin-top:14px" data-update-alert>${icon("download")}<span>有新版本 v${d.update.latest} 可以下載（目前 v${d.update.current}）。升級前請先備份。</span><a class="btn btn-sm" href="${d.update.url}" target="_blank" rel="noopener">查看新版本</a></div>`
      : ""}

    <div class="card" style="margin-top:14px">
      <div class="card-head"><h2>我借閱中的書（${d.mine.length}）</h2>${overdueMine ? html`<span class="tag tag-danger">${overdueMine} 本逾期</span>` : ""}</div>
      ${loanListItems(d.mine)}
    </div>

    ${isAdmin()
      ? html`
        <div class="stats" style="margin-top:14px">
          <div class="stat"><span class="stat-ic">${icon("book")}</span><div><b>${s.titles}</b><span>書目（種）</span></div></div>
          <div class="stat"><span class="stat-ic">${icon("list")}</span><div><b>${s.copies}</b><span>館藏（冊）</span></div></div>
          <div class="stat"><span class="stat-ic">${icon("check")}</span><div><b>${s.available}</b><span>在架</span></div></div>
          <div class="stat"><span class="stat-ic">${icon("borrow")}</span><div><b>${s.onLoan}</b><span>借出中</span></div></div>
          <div class="stat ${d.overdue.length ? "warn" : ""}"><span class="stat-ic">${icon("warn")}</span><div><b>${d.overdue.length}</b><span>逾期</span></div></div>
        </div>
        ${s.unprinted > 0
          ? html`<div class="alert alert-info" style="margin-top:14px">${icon("label")}<span>有 ${s.unprinted} 冊還沒列印條碼標籤。</span><a class="btn btn-sm" href="#/labels">列印標籤</a></div>`
          : ""}
        <div class="card" style="margin-top:14px">
          <div class="card-head"><h2>全館逾期清單（${d.overdue.length}）</h2><a class="btn btn-sm" href="#/loans?overdue=1">查看全部借出</a></div>
          ${d.overdue.length ? loanListItems(d.overdue, { showBorrower: true }) : html`<div class="empty">沒有逾期的書</div>`}
        </div>
        ${s.titles === 0
          ? html`<div class="card" style="margin-top:14px"><h2>開始使用</h2>
              <ol class="steps">
                <li><a href="#/admin/classes">建立班級</a>（「純行政」已預先建立）</li>
                <li><a href="#/admin/users">建立老師帳號</a></li>
                <li><a href="#/books/new">新增書籍</a>：掃描書背 ISBN 自動帶入書目</li>
                <li><a href="#/labels">列印條碼標籤</a>並貼到書上</li>
              </ol></div>`
          : ""}`
      : ""}`.toString();
}

// ---------- 更多 ----------
function morePage(el) {
  const link = (href, ic, label) => html`<a href="#${href}">${icon(ic)}<span>${label}</span><span class="chev">${icon("chev")}</span></a>`;
  el.innerHTML = html`
    <div class="page-head"><div><h1>${isAdmin() ? "管理" : "更多"}</h1><p>${state.user.name}（${state.user.className}）</p></div></div>
    <div class="menu-title">借閱</div>
    <div class="card menu-list">
      ${link("/loans", "list", isAdmin() ? "借出清單" : "我借閱中的書")}
      ${link("/history", "history", isAdmin() ? "借閱紀錄" : "我的借閱紀錄")}
    </div>
    ${isAdmin()
      ? html`
        <div class="menu-title">館藏</div>
        <div class="card menu-list">
          ${link("/books/new", "plus", "新增書籍")}
          ${link("/labels", "label", "列印條碼標籤")}
        </div>
        <div class="menu-title">系統管理</div>
        <div class="card menu-list">
          ${link("/admin/users", "users", "老師帳號")}
          ${link("/admin/classes", "class", "班級")}
          ${link("/admin/settings", "settings", "系統設定")}
          ${link("/admin/backup", "backup", "備份與還原")}
        </div>`
      : ""}
    <div class="menu-title">其他</div>
    <div class="card menu-list">
      ${link("/connect", "phone", "手機／平板連線")}
      ${link("/password", "key", "修改密碼")}
      <a href="#" data-logout>${icon("logout")}<span>登出</span></a>
    </div>`.toString();
  el.querySelector("[data-logout]").onclick = (e) => {
    e.preventDefault();
    logout();
  };
}

async function connectPage(el) {
  const info = await GET("/system/info");
  el.innerHTML = html`
    <div class="page-head"><div><h1>手機／平板連線</h1><p>同一個 Wi-Fi 網路內的手機、平板都可以連進來借還書。</p></div></div>
    <div class="card">
      ${info.lanHttpsUrl
        ? html`<div class="qr-box">
            <img src="${info.qr}" alt="連線 QR Code">
            <div>
              <p style="margin:0 0 6px">用手機相機掃描左邊的 QR Code，或在瀏覽器輸入：</p>
              <p class="mono" style="font-size:1.15rem;margin:0 0 10px;word-break:break-all"><b>${info.lanHttpsUrl}</b></p>
              <p class="small muted" style="margin:0">這台電腦本機網址：${info.localUrl}</p>
            </div>
          </div>`
        : html`<div class="alert">${icon("warn")}這台電腦目前沒有連上區域網路，只能在本機使用。</div>`}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>安裝安全憑證（啟用相機掃碼）</h2>
        <a class="btn btn-sm btn-primary" href="/api/system/cert" download="school-library.crt">${icon("download")}下載系統安全憑證 (.crt)</a>
      </div>
      <p class="small muted" style="margin:0 0 10px">
        手機瀏覽器必須在完全受信任的 HTTPS 連線下才允許開啟即時相機鏡頭。若進入網站後相機無法開啟或顯示不安全，可下載憑證安裝到手機中。
      </p>
      <div class="grid grid-2">
        <div style="background:var(--surface-2);padding:14px;border-radius:var(--radius-sm)">
          <b>🍎 iOS (iPhone / iPad) 安裝步驟：</b>
          <ol class="steps small" style="margin-top:6px">
            <li>用 Safari 開啟上方網址，點「下載系統安全憑證」並允許下載描述檔。</li>
            <li>至手機「設定 → 已下載描述檔」點選安裝。</li>
            <li>至「設定 → 一般 → 關於本機 → 憑證信任設定」，將 <b>School Library CA</b> 開啟「完全信任」。</li>
          </ol>
        </div>
        <div style="background:var(--surface-2);padding:14px;border-radius:var(--radius-sm)">
          <b>🤖 Android 安裝步驟：</b>
          <ol class="steps small" style="margin-top:6px">
            <li>點「下載系統安全憑證」儲存 <code>school-library.crt</code>。</li>
            <li>至手機「設定 → 安全性與隱私 → 更多安全性設定 → 加密與憑證」。</li>
            <li>選擇「從儲存裝置安裝 → CA 憑證」，選取剛下載的憑證確認安裝即可。</li>
          </ol>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>第一次連線（免安裝憑證方式）</h2>
      <ol class="steps">
        <li>手機必須和這台電腦連在<b>同一個 Wi-Fi</b>。</li>
        <li>瀏覽器若顯示「連線不是私人連線」警告：
          <br><b>Android（Chrome）</b>：點「進階」→「繼續前往」。
          <br><b>iPhone／iPad（Safari）</b>：點「顯示詳細資訊」→「瀏覽此網站」→ 再按一次「瀏覽此網站」。
        </li>
        <li>若未安裝憑證，部分手機系統限制即時預覽相機，仍可使用<b>「拍照辨識」</b>或外接條碼掃描槍借還書。</li>
      </ol>
    </div>
    <div class="card">
      <h2>連不上時</h2>
      <ul class="steps">
        <li>確認主機電腦上的借閱系統視窗沒有被關閉。</li>
        <li>主機第一次執行時，Windows 防火牆會詢問是否允許存取，請勾選「私人網路」並按「允許」。</li>
        <li>如果學校 Wi-Fi 有「用戶端隔離」，手機之間無法互連，需請資訊組協助。</li>
      </ul>
    </div>`.toString();
}

// ---------- 啟動 ----------
onAuthProblem((err) => {
  if (err.code === "LOGIN_REQUIRED") state.user = null;
  else if (err.code === "MUST_CHANGE_PASSWORD" && state.user) state.user.mustChangePassword = true;
  render();
});

window.addEventListener("hashchange", render);

(async function start() {
  try {
    const r = await GET("/auth/me");
    state.user = r.user;
    state.schoolName = r.schoolName || "";
  } catch (err) {
    app.innerHTML = html`<div class="card" style="margin-top:40px"><div class="alert alert-danger">${err.message}</div></div>`.toString();
    return;
  }
  render();
})();

export { raw, cover };
