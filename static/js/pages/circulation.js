// 借書、還書、借出清單、借閱紀錄。
import { DEL, GET, POST, qs } from "../api.js";
import { isAdmin, loanListItems, state } from "../app.js";
import { createScanner } from "../scanner.js";
import {
  $,
  beep,
  busy,
  confirmDialog,
  cover,
  download,
  dueText,
  esc,
  fmtDate,
  fmtDateTime,
  html,
  icon,
  modal,
  statusTag,
  toastErr,
  toastOk,
} from "../ui.js";

/** 掃到 ISBN 且有多冊符合時，讓使用者選是哪一冊。回傳選到的冊或 null。 */
function chooseCopy(copies, title) {
  return new Promise((resolve) => {
    let picked = null;
    const m = modal({
      title: "請選擇是哪一冊",
      body: html`
        <p class="small muted" style="margin:0 0 8px">《${title}》有 ${copies.length} 冊符合。請看書上的登錄號標籤選擇；下次直接掃描標籤會更快。</p>
        <div class="list">${copies.map(
          (c, i) => html`<div class="list-item"><div class="main"><div class="t mono">${c.accessionNo}</div>
            <div class="s">${c.borrowerName ? html`${c.borrowerName} 借閱中 · ${dueText(c)}` : "在架"}</div></div>
            <button class="btn btn-primary btn-sm" data-i="${i}">選這本</button></div>`
        )}</div>`.toString(),
      onClose: () => resolve(picked),
    });
    m.el.querySelectorAll("[data-i]").forEach((b) =>
      b.addEventListener("click", () => {
        picked = copies[Number(b.dataset.i)];
        m.close();
      })
    );
  });
}

/** 打字搜尋冊的區塊（不用掃描時使用）。 */
function searchBox(container, { status, placeholder, onPick, actionText }) {
  container.innerHTML = `
    <input type="search" placeholder="${esc(placeholder)}" aria-label="搜尋">
    <div class="list" data-results style="margin-top:6px"></div>`;
  const input = container.querySelector("input");
  const results = container.querySelector("[data-results]");
  let timer;
  let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) {
      results.innerHTML = "";
      return;
    }
    try {
      const rows = await GET(`/copies/search${qs({ q, status })}`);
      if (my !== seq) return;
      results.innerHTML = rows.length
        ? html`${rows.map(
            (c, i) => html`<div class="list-item">
              ${cover(c.coverUrl, c.title, "cover-sm")}
              <div class="main"><div class="t">${c.title}</div>
              <div class="s"><span class="mono">${c.accessionNo}</span>${c.borrowerName ? html` · ${c.borrowerName}（${c.borrowerClass}）· ${dueText(c)}` : ""}</div></div>
              <button class="btn btn-sm btn-primary" data-i="${i}">${actionText}</button></div>`
          )}`.toString()
        : `<div class="empty">找不到符合的書</div>`;
      results.querySelectorAll("[data-i]").forEach((b) =>
        b.addEventListener("click", () => busy(b, () => onPick(rows[Number(b.dataset.i)])))
      );
    } catch (err) {
      toastErr(err);
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  return { refresh: run, clear: () => ((input.value = ""), (results.innerHTML = "")) };
}

// ---------- 借書 ----------
// 掃到就立即借出，不需要再按確認；掃錯時可以在「今天借出的書」取消（整筆刪除，不留紀錄）。
export async function borrowPage(el) {
  const [settings, borrowers] = await Promise.all([GET("/settings"), GET("/borrowers")]);
  let borrowerId = state.user.id;
  let active = []; // 這位老師目前借閱中的書
  const borrowerName = () => borrowers.find((b) => b.id === borrowerId)?.name ?? state.user.name;

  el.innerHTML = html`
    <div class="page-head"><div><h1>借書</h1><p>掃描書上的登錄號標籤（或書背 ISBN），掃到就立即借出。掃錯了可以在下方取消。</p></div></div>
    <div class="card">
      ${isAdmin()
        ? html`<label class="field" style="margin-bottom:12px"><span>借書的老師</span>
            <select data-borrower>${borrowers.map(
              (b) => html`<option value="${b.id}" ${b.id === state.user.id ? "selected" : ""}>${b.name}（${b.className}）</option>`
            )}</select></label>`
        : ""}
      <div data-scanner></div>
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">沒有條碼？用書名搜尋</summary>
        <div data-search style="margin-top:10px"></div></details>
    </div>
    <div class="card">
      <div class="card-head"><h2>今天借出的書 <span data-count></span></h2><span class="small muted" data-quota></span></div>
      <p class="small muted" style="margin:-4px 0 10px">掃錯或輸入錯誤時按「取消借出」，這筆借閱會直接刪除，不會留在借閱紀錄。只能取消當天的借出。</p>
      <div data-today></div>
    </div>`.toString();

  const todayEl = $("[data-today]", el);

  async function refresh() {
    active = await GET(`/loans/active${qs(isAdmin() ? { userId: borrowerId } : {})}`);
    draw();
  }

  function draw() {
    const today = active.filter((r) => r.loanedToday).sort((a, b) => (a.loanedAt < b.loanedAt ? 1 : -1));
    $("[data-count]", el).textContent = today.length ? `（${today.length} 本）` : "";
    const left = settings.maxLoansPerUser - active.length;
    $("[data-quota]", el).textContent = `${borrowerName()}已借 ${active.length} 本，還可以借 ${Math.max(0, left)} 本`;
    todayEl.innerHTML = today.length
      ? html`<div class="list">${today.map(
          (r) => html`<div class="list-item">
            <div class="main"><div class="t">${r.title}</div>
              <div class="s"><span class="mono">${r.accessionNo}</span> · ${r.loanedAt.slice(11, 16)} 借出 · 應還 ${fmtDate(r.dueAt)}</div></div>
            <button class="btn btn-sm btn-danger" data-cancel="${r.id}" data-title="${r.title}">取消借出</button></div>`
        )}</div>`.toString()
      : `<div class="empty">今天還沒有借書，請掃描條碼</div>`;
    todayEl.querySelectorAll("[data-cancel]").forEach((b) =>
      b.addEventListener("click", () => cancelLoan(Number(b.dataset.cancel), b.dataset.title))
    );
  }

  async function cancelLoan(loanId, title) {
    const ok = await confirmDialog(`取消借出《${title}》？這筆借閱會直接刪除，不會留在借閱紀錄，書會恢復在架。`, {
      okText: "取消借出",
          cancelText: "保留借出",
      danger: true,
      title: "取消借出",
    });
    if (!ok) return;
    try {
      await DEL(`/loans/${loanId}`);
      toastOk(`已取消借出《${title}》`);
      await refresh();
    } catch (err) {
      toastErr(err);
    }
  }

  /** 借出一冊；回傳顯示在相機畫面上的訊息。 */
  async function borrowCopy(c) {
    if (c.status === "on_loan" && active.some((r) => r.copyId === c.id)) {
      beep(false);
      toastErr(`${c.accessionNo}《${c.title}》已經借出了（重複掃描）`);
      return `${c.accessionNo} 已借出`;
    }
    if (c.status !== "available") {
      beep(false);
      const why = c.status === "on_loan" ? `已被${c.borrowerName}借出` : `狀態為「${{ lost: "遺失", withdrawn: "註銷" }[c.status]}」`;
      toastErr(`${c.accessionNo}《${c.title}》${why}`);
      return `✗ ${c.accessionNo} ${why}`;
    }
    if (active.length + 1 > settings.maxLoansPerUser) {
      beep(false);
      toastErr(`超過借閱上限：每人最多 ${settings.maxLoansPerUser} 本`);
      return "✗ 超過借閱上限";
    }
    const r = await POST("/loans", { userId: borrowerId, copyIds: [c.id] });
    beep(true);
    toastOk(`已借出《${c.title}》，請在 ${fmtDate(r.dueAt)} 前歸還`);
    await refresh();
    return `✓ 已借出《${c.title}》`;
  }

  async function handleCode(code) {
    try {
      const r = await GET(`/scan/${encodeURIComponent(code)}`);
      if (r.type === "copy") return await borrowCopy(r.copies[0]);
      const avail = r.copies.filter((c) => c.status === "available");
      if (!avail.length) {
        beep(false);
        toastErr(`《${r.copies[0].title}》目前沒有在架的書`);
        return "✗ 沒有在架的書";
      }
      if (avail.length === 1) return await borrowCopy(avail[0]);
      const picked = await chooseCopy(avail, avail[0].title);
      return picked ? await borrowCopy(picked) : "";
    } catch (err) {
      beep(false);
      toastErr(err);
      return `✗ ${err.message}`;
    }
  }

  // 連續快速掃描時一本一本依序處理，借閱上限才算得準
  let queue = Promise.resolve();
  const onCode = (code) => (queue = queue.then(() => handleCode(code)));

  createScanner($("[data-scanner]", el), { onCode, continuous: true });
  const sb = searchBox($("[data-search]", el), {
    status: "available",
    placeholder: "輸入書名、作者或登錄號",
    actionText: "借出",
    onPick: async (c) => {
      await onCode(c.accessionNo);
      sb.refresh();
    },
  });

  $("[data-borrower]", el)?.addEventListener("change", (e) => {
    borrowerId = Number(e.target.value);
    refresh();
  });

  await refresh();
}

// ---------- 還書 ----------
export async function returnPage(el) {
  el.innerHTML = html`
    <div class="page-head"><div><h1>還書</h1><p>掃描要歸還的書，每掃一本就立即完成歸還。</p></div></div>
    <div class="card">
      <div data-scanner></div>
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer">沒有條碼？用書名或老師姓名搜尋</summary>
        <div data-search style="margin-top:10px"></div></details>
    </div>
    <div class="card">
      <div class="card-head"><h2>本次歸還 <span data-count></span></h2></div>
      <div data-log><div class="empty">還沒有歸還任何書</div></div>
    </div>`.toString();

  const logEl = $("[data-log]", el);
  let count = 0;

  function log(kind, text) {
    logEl.querySelector(".empty")?.remove();
    const div = document.createElement("div");
    div.className = `log-item ${kind}`;
    div.innerHTML = text;
    logEl.prepend(div);
  }

  async function doReturn(c) {
    if (c.status !== "on_loan") {
      beep(false);
      const msg = `${c.accessionNo}《${c.title}》目前${c.status === "available" ? "在架，沒有被借出" : `狀態為「${{ lost: "遺失", withdrawn: "註銷" }[c.status]}」`}`;
      log("err", html`${icon("warn")}<span>${msg}</span>`.toString());
      return `✗ ${c.accessionNo} 未借出`;
    }
    const r = await POST("/returns", { copyId: c.id });
    count++;
    $("[data-count]", el).textContent = `（${count} 本）`;
    beep(true);
    const late = r.item.overdueDays > 0;
    log(
      late ? "late" : "",
      html`${icon("check")}<div class="main"><b>${r.item.title}</b>
        <div class="small"><span class="mono">${r.item.accessionNo}</span> · ${r.item.borrowerName}（${r.item.borrowerClass}）${late ? html` · <b>逾期 ${r.item.overdueDays} 天</b>` : " · 準時歸還"}</div></div>`.toString()
    );
    return `✓ 已歸還《${r.item.title}》`;
  }

  async function onCode(code) {
    try {
      const r = await GET(`/scan/${encodeURIComponent(code)}`);
      if (r.type === "copy") return await doReturn(r.copies[0]);
      const onLoan = r.copies.filter((c) => c.status === "on_loan");
      if (!onLoan.length) {
        beep(false);
        toastErr(`《${r.copies[0].title}》沒有借出中的冊`);
        return "✗ 沒有借出中的冊";
      }
      if (onLoan.length === 1) return await doReturn(onLoan[0]);
      const picked = await chooseCopy(onLoan, onLoan[0].title);
      return picked ? await doReturn(picked) : "";
    } catch (err) {
      beep(false);
      toastErr(err);
      return `✗ ${err.message}`;
    }
  }

  createScanner($("[data-scanner]", el), { onCode, continuous: true });
  const sb = searchBox($("[data-search]", el), {
    status: "on_loan",
    placeholder: "輸入書名、登錄號或老師姓名",
    actionText: "歸還",
    onPick: async (c) => {
      try {
        await doReturn(c);
        sb.refresh();
      } catch (err) {
        toastErr(err);
      }
    },
  });
}

// ---------- 篩選列 ----------
async function filterBar(query, { dates = false, keyword = false, overdue = false } = {}) {
  const parts = [];
  if (isAdmin()) {
    const [classes, borrowers] = await Promise.all([GET("/classes"), GET("/borrowers")]);
    parts.push(html`<label class="field"><span>班級</span><select name="classId"><option value="">全部班級</option>${classes.map(
      (c) => html`<option value="${c.id}" ${query.get("classId") == c.id ? "selected" : ""}>${c.name}</option>`
    )}</select></label>`);
    parts.push(html`<label class="field"><span>老師</span><select name="userId"><option value="">全部老師</option>${borrowers.map(
      (b) => html`<option value="${b.id}" ${query.get("userId") == b.id ? "selected" : ""}>${b.name}（${b.className}）</option>`
    )}</select></label>`);
  }
  if (dates) {
    parts.push(html`<label class="field"><span>借出日期（起）</span><input type="date" name="from" value="${query.get("from") || ""}"></label>`);
    parts.push(html`<label class="field"><span>借出日期（迄）</span><input type="date" name="to" value="${query.get("to") || ""}"></label>`);
  }
  if (keyword) parts.push(html`<label class="field"><span>關鍵字</span><input type="search" name="q" placeholder="書名、登錄號、老師" value="${query.get("q") || ""}"></label>`);
  if (overdue) parts.push(html`<label class="check" style="align-self:end;min-height:44px"><input type="checkbox" name="overdue" value="1" ${query.get("overdue") === "1" ? "checked" : ""}>只看逾期</label>`);
  return parts.length ? html`<form class="form-grid" data-filter>${parts}</form>` : "";
}

function readFilterForm(el) {
  const form = $("[data-filter]", el);
  if (!form) return {};
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) if (v) o[k] = v;
  return o;
}

function syncHash(path, params) {
  const s = qs(params);
  history.replaceState(null, "", `#${path}${s}`);
}

// ---------- 借出清單 ----------
export async function activeLoansPage(el, _params, query) {
  const filter = await filterBar(query, { overdue: true });
  el.innerHTML = html`
    <div class="page-head">
      <div><h1>${isAdmin() ? "借出清單" : "我借閱中的書"}</h1><p>目前借出、尚未歸還的書。</p></div>
      ${isAdmin() ? html`<button class="btn" data-export>${icon("download")}匯出 Excel</button>` : ""}
    </div>
    ${filter ? html`<div class="card">${filter}</div>` : ""}
    <div class="card"><div data-table></div></div>`.toString();

  async function load() {
    const params = readFilterForm(el);
    syncHash("/loans", params);
    const rows = await GET(`/loans/active${qs(params)}`);
    const t = $("[data-table]", el);
    if (!rows.length) {
      t.innerHTML = `<div class="empty">沒有符合的借閱</div>`;
      return;
    }
    t.innerHTML = html`<div class="small muted" style="margin-bottom:8px">共 ${rows.length} 本${rows.some((r) => r.overdueDays) ? `，其中 ${rows.filter((r) => r.overdueDays).length} 本逾期` : ""}</div>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>登錄號</th><th>書名</th>${isAdmin() ? html`<th>借閱老師</th><th>班級</th>` : ""}<th>借出日</th><th>應還日</th><th>狀態</th><th></th>
      </tr></thead><tbody>${rows.map(
        (r) => html`<tr class="${r.overdueDays ? "overdue" : ""}">
          <td class="mono nowrap">${r.accessionNo}</td>
          <td><a href="#/books/${r.bookId}">${r.title}</a></td>
          ${isAdmin() ? html`<td class="nowrap">${r.borrowerName}</td><td class="nowrap">${r.className}</td>` : ""}
          <td class="nowrap">${fmtDate(r.loanedAt)}</td>
          <td class="nowrap">${fmtDate(r.dueAt)}</td>
          <td class="nowrap">${r.overdueDays ? html`<span class="tag tag-danger">逾期 ${r.overdueDays} 天</span>` : html`<span class="tag tag-on_loan">借出中</span>`}</td>
          <td class="actions nowrap">${r.loanedToday && (isAdmin() || r.userId === state.user.id)
            ? html`<button class="btn btn-sm btn-danger" data-cancel="${r.id}" data-title="${r.title}">取消借出</button> `
            : ""}<button class="btn btn-sm" data-return="${r.copyId}" data-title="${r.title}">歸還</button></td>
        </tr>`
      )}</tbody></table></div>`.toString();
    t.querySelectorAll("[data-cancel]").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await confirmDialog(`取消借出《${b.dataset.title}》？這筆借閱會直接刪除，不會留在借閱紀錄，書會恢復在架。`, {
          okText: "取消借出",
          cancelText: "保留借出",
          danger: true,
          title: "取消借出",
        });
        if (!ok) return;
        try {
          await DEL(`/loans/${b.dataset.cancel}`);
          toastOk("已取消借出，不會列入紀錄");
          load();
        } catch (err) {
          toastErr(err);
        }
      })
    );
    t.querySelectorAll("[data-return]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await confirmDialog(`確定歸還《${b.dataset.title}》？`, { okText: "歸還" }))) return;
        try {
          await POST("/returns", { copyId: Number(b.dataset.return) });
          toastOk("已歸還");
          load();
        } catch (err) {
          toastErr(err);
        }
      })
    );
  }

  $("[data-filter]", el)?.addEventListener("change", load);
  $("[data-export]", el)?.addEventListener("click", () => download(`/api/export/active.xlsx${qs(readFilterForm(el))}`));
  await load();
}

// ---------- 借閱紀錄 ----------
export async function historyPage(el, _params, query) {
  const filter = await filterBar(query, { dates: true, keyword: true });
  el.innerHTML = html`
    <div class="page-head">
      <div><h1>${isAdmin() ? "借閱紀錄" : "我的借閱紀錄"}</h1><p>所有借出與歸還的紀錄（最新的在最上面，畫面最多顯示 500 筆）。</p></div>
      ${isAdmin() ? html`<button class="btn" data-export>${icon("download")}匯出 Excel</button>` : ""}
    </div>
    <div class="card">${filter}</div>
    <div class="card"><div data-table></div></div>`.toString();

  async function load() {
    const params = readFilterForm(el);
    syncHash("/history", params);
    const rows = await GET(`/loans/history${qs(params)}`);
    const t = $("[data-table]", el);
    if (!rows.length) {
      t.innerHTML = `<div class="empty">沒有符合的紀錄</div>`;
      return;
    }
    t.innerHTML = html`<div class="small muted" style="margin-bottom:8px">共 ${rows.length} 筆${rows.length >= 500 ? "（只顯示最近 500 筆，完整資料請匯出 Excel）" : ""}</div>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>登錄號</th><th>書名</th>${isAdmin() ? html`<th>借閱老師</th><th>班級</th>` : ""}<th>借出</th><th>應還</th><th>歸還</th>
      </tr></thead><tbody>${rows.map(
        (r) => html`<tr>
          <td class="mono nowrap">${r.accessionNo}</td>
          <td><a href="#/books/${r.bookId}">${r.title}</a></td>
          ${isAdmin() ? html`<td class="nowrap">${r.borrowerName}</td><td class="nowrap">${r.className}</td>` : ""}
          <td class="nowrap">${fmtDateTime(r.loanedAt)}</td>
          <td class="nowrap">${fmtDate(r.dueAt)}</td>
          <td class="nowrap">${r.returnedAt
            ? html`${fmtDateTime(r.returnedAt)}${r.overdueDays ? html` <span class="tag tag-lost">逾期 ${r.overdueDays} 天</span>` : ""}`
            : r.overdueDays
              ? html`<span class="tag tag-danger">逾期未還</span>`
              : html`<span class="tag tag-on_loan">借出中</span>`}</td>
        </tr>`
      )}</tbody></table></div>`.toString();
  }

  let timer;
  const form = $("[data-filter]", el);
  form.addEventListener("change", load);
  form.addEventListener("input", (e) => {
    if (e.target.name !== "q") return;
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  $("[data-export]", el)?.addEventListener("click", () => download(`/api/export/history.xlsx${qs(readFilterForm(el))}`));
  await load();
}

export { statusTag, loanListItems };
