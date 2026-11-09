// 查書、書籍詳細、新增／編輯書籍、條碼標籤列印。
import { DEL, GET, PATCH, POST, PUT, qs } from "../api.js";
import { go, isAdmin, state } from "../app.js";
import { createScanner, normalizeIsbnClient, resizeImage } from "../scanner.js";
import {
  $,
  beep,
  busy,
  confirmDialog,
  cover,
  dueText,
  esc,
  fmtDate,
  formDialog,
  html,
  icon,
  raw,
  statusTag,
  toastErr,
  toastOk,
} from "../ui.js";

// 中文圖書十大分類對照
export const CCL_CATEGORIES = [
  { code: "0", name: "總類" },
  { code: "1", name: "哲學類" },
  { code: "2", name: "宗教類" },
  { code: "3", name: "自然科學" },
  { code: "4", name: "應用科學" },
  { code: "5", name: "社會科學" },
  { code: "6", name: "史地類" },
  { code: "7", name: "世界史地" },
  { code: "8", name: "語言文學" },
  { code: "9", name: "藝術類" },
];

// ---------- 查書（館藏列表） ----------
export async function listPage(el, _p, query) {
  let activeCat = query.get("category") || "";
  let activeStatus = query.get("status") || "";

  el.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>館藏列表</h1>
        <p>依圖書分類瀏覽或輸入書名、作者、出版社、ISBN、分類號或登錄號。</p>
      </div>
      ${isAdmin() ? html`<a class="btn btn-primary" href="#/books/new">${icon("plus")}新增書籍</a>` : ""}
    </div>

    <!-- 十大分類快速導覽標籤 -->
    <div class="category-pills" data-cat-pills>
      <div class="loading" style="padding:10px">載入分類中…</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="row" style="gap:10px;align-items:center">
        <input type="search" data-q placeholder="搜尋書名、作者、ISBN、分類號…" value="${query.get("q") || ""}" aria-label="搜尋" style="flex:1">
        <select data-status-filter style="max-width:140px">
          <option value="" ${!activeStatus ? "selected" : ""}>所有在館狀態</option>
          <option value="available" ${activeStatus === "available" ? "selected" : ""}>只看在架可借</option>
          <option value="on_loan" ${activeStatus === "on_loan" ? "selected" : ""}>只看全部借出</option>
        </select>
      </div>
    </div>

    <div data-summary class="small muted" style="margin:0 2px 10px"></div>
    <div data-list></div>`.toString();

  const input = $("[data-q]", el);
  const statusSel = $("[data-status-filter]", el);
  const catPillsEl = $("[data-cat-pills]", el);
  let timer;
  let seq = 0;

  // 載入分類統計標籤
  async function loadCategories() {
    try {
      const stats = await GET("/categories");
      const pills = [
        { code: "", name: "全部分類", count: stats.total },
        ...CCL_CATEGORIES.map((c) => ({ ...c, count: stats.counts[c.code] || 0 })),
        { code: "none", name: "未分類", count: stats.unclassified || 0 },
      ];

      catPillsEl.innerHTML = pills
        .map(
          (p) =>
            `<button class="cat-pill ${activeCat === p.code ? "active" : ""}" type="button" data-cat="${p.code}">
               <span>${esc(p.name)}</span><span class="count">${p.count}</span>
             </button>`
        )
        .join("");

      catPillsEl.querySelectorAll("[data-cat]").forEach((btn) =>
        btn.addEventListener("click", () => {
          activeCat = btn.dataset.cat;
          catPillsEl.querySelectorAll(".cat-pill").forEach((b) => b.classList.toggle("active", b.dataset.cat === activeCat));
          load().catch(toastErr);
        })
      );
    } catch {
      catPillsEl.innerHTML = "";
    }
  }

  async function load() {
    const q = input.value.trim();
    activeStatus = statusSel.value;
    const params = {};
    if (q) params.q = q;
    if (activeCat) params.category = activeCat;
    if (activeStatus) params.status = activeStatus;

    history.replaceState(null, "", `#/books${qs(params)}`);
    const my = ++seq;
    const rows = await GET(`/books${qs(params)}`);
    if (my !== seq) return;

    let catName = "";
    if (activeCat === "none") catName = "未分類";
    else if (activeCat) {
      const cObj = CCL_CATEGORIES.find((c) => c.code === activeCat);
      catName = cObj ? `${cObj.code} ${cObj.name}` : activeCat;
    }

    const filterText = [catName, activeStatus === "available" ? "在架可借" : activeStatus === "on_loan" ? "全部借出" : ""].filter(Boolean).join(" · ");
    $("[data-summary]", el).textContent = q
      ? `找到 ${rows.length} 種書${filterText ? `（${filterText}）` : ""}`
      : rows.length
        ? `共 ${rows.length} 種書${filterText ? `（${filterText}）` : "（最新建檔的在前面）"}`
        : "";

    $("[data-list]", el).innerHTML = rows.length
      ? html`<div class="book-grid">${rows.map(
          (b) => html`<a class="book-card" href="#/books/${b.id}">
            ${cover(b.coverUrl, b.title)}
            <div class="body">
              <div class="title">${b.title}</div>
              <div class="meta">${b.author || " "}</div>
              ${b.classificationNo || b.authorNo ? html`<div class="book-callno">${b.classificationNo} ${b.authorNo}</div>` : ""}
              <div style="margin-top:auto;padding-top:4px">${
                b.total === 0
                  ? html`<span class="tag tag-withdrawn">無可借冊</span>`
                  : b.available > 0
                    ? html`<span class="tag tag-available">在架 ${b.available}／${b.total}</span>`
                    : html`<span class="tag tag-on_loan">全部借出</span>`
              }</div>
            </div></a>`
        )}</div>`.toString()
      : `<div class="card empty">${q || activeCat || activeStatus ? "找不到符合的書" : isAdmin() ? '還沒有任何書，請先<a href="#/books/new">新增書籍</a>' : "還沒有任何書"}</div>`;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load().catch(toastErr), 250);
  });
  statusSel.addEventListener("change", () => load().catch(toastErr));

  if (!matchMedia("(pointer: coarse)").matches) input.focus();
  loadCategories();
  await load();
}

// ---------- 書籍詳細 ----------
export async function detailPage(el, params, query) {
  const id = Number(params.id);
  let book = await GET(`/books/${id}`);

  function draw() {
    const admin = isAdmin();
    const circulating = book.copies.filter((c) => c.status === "available" || c.status === "on_loan");
    const avail = book.copies.filter((c) => c.status === "available").length;
    const hasLoans = book.copies.some((c) => c.loanCount > 0);
    const created = query.get("created");
    el.innerHTML = html`
      <div class="page-head"><a class="btn btn-ghost" href="#/books">${icon("back")}查書</a></div>
      ${created
        ? html`<div class="alert alert-ok" style="margin-bottom:14px">${icon("check")}<span>已新增 ${created.split(",").length} 冊：<span class="mono">${created.replace(/,/g, "、")}</span>。請列印條碼標籤貼到書上。</span>
            <a class="btn btn-sm btn-primary" href="#/labels?mode=accession&ids=${created}">列印這幾冊的標籤</a></div>`
        : ""}
      <div class="card">
        <div class="book-head">
          ${cover(book.coverUrl, book.title, "cover-md")}
          <div class="info">
            <h1>${book.title}</h1>
            <dl>
              <dt>作者</dt><dd>${book.author || "—"}</dd>
              <dt>出版社</dt><dd>${book.publisher || "—"}</dd>
              <dt>ISBN</dt><dd class="mono">${book.isbn || "（無）"}</dd>
              <dt>分類號</dt><dd class="mono">${book.classificationNo || "—"}</dd>
              <dt>作者號</dt><dd class="mono">${book.authorNo || "—"}</dd>
              <dt>館藏</dt><dd>${circulating.length} 冊，在架 ${avail} 冊</dd>
              ${book.note ? html`<dt>備註</dt><dd>${book.note}</dd>` : ""}
            </dl>
            ${admin
              ? html`<div class="row" style="margin-top:14px">
                  <a class="btn btn-sm" href="#/books/${book.id}/edit">${icon("edit")}編輯</a>
                  <button class="btn btn-sm" data-addcopy>${icon("plus")}新增複本</button>
                  <a class="btn btn-sm" href="#/labels?mode=books&ids=${book.id}">${icon("label")}列印標籤</a>
                  ${hasLoans ? "" : html`<button class="btn btn-sm btn-danger" data-delbook>${icon("trash")}刪除書目</button>`}
                </div>`
              : ""}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>每一冊的狀態</h2></div>
        ${book.copies.length
          ? html`<div class="table-wrap"><table class="table"><thead><tr>
              <th>登錄號</th><th>狀態</th><th>借閱情形</th>${admin ? html`<th>標籤</th><th>備註</th><th></th>` : ""}
            </tr></thead><tbody>${book.copies.map(
              (c) => html`<tr>
                <td class="mono nowrap">${c.accessionNo}</td>
                <td class="nowrap">${statusTag(c.status)}</td>
                <td>${c.borrowerName ? html`${c.borrowerName}（${c.borrowerClass}）<div class="small ${c.dueAt < new Date().toISOString().slice(0, 10) ? "" : "muted"}">${dueText({ dueAt: c.dueAt, overdueDays: overdue(c.dueAt) })}</div>` : html`<span class="muted">—</span>`}</td>
                ${admin
                  ? html`<td class="nowrap">${c.labelPrinted ? html`<span class="small muted">已印</span>` : html`<span class="tag tag-lost">未印</span>`}</td>
                    <td class="small">${c.note}</td>
                    <td class="actions">
                      ${c.status === "available" ? html`<button class="btn btn-sm" data-act="lost" data-id="${c.id}">遺失</button><button class="btn btn-sm" data-act="withdrawn" data-id="${c.id}">註銷</button>` : ""}
                      ${c.status === "lost" || c.status === "withdrawn" ? html`<button class="btn btn-sm" data-act="available" data-id="${c.id}">恢復在架</button>` : ""}
                      <button class="btn btn-sm" data-note="${c.id}">備註</button>
                      ${c.loanCount === 0 ? html`<button class="btn btn-sm btn-danger" data-delcopy="${c.id}" aria-label="刪除">${icon("trash")}</button>` : ""}
                    </td>`
                  : ""}
              </tr>`
            )}</tbody></table></div>`
          : html`<div class="empty">這本書目前沒有任何一冊</div>`}
      </div>`.toString();
    bind();
  }

  function overdue(dueAt) {
    if (!dueAt) return 0;
    const today = new Date();
    const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const [y, m, d] = dueAt.split("-").map(Number);
    return Math.max(0, Math.round((t - Date.UTC(y, m - 1, d)) / 86400000));
  }

  function bind() {
    $("[data-addcopy]", el)?.addEventListener("click", () =>
      formDialog({
        title: "新增複本",
        fields: `<p class="muted" style="margin:0">《${esc(book.title)}》再買了幾本？系統會為每一本產生新的登錄號。</p>
          <label class="field"><span>冊數</span><input type="number" name="count" min="1" max="50" value="1" required></label>`,
        submitText: "新增",
        onSubmit: async (fd) => {
          const r = await POST(`/books/${id}/copies`, { count: Number(fd.get("count")) });
          toastOk(`已新增 ${r.accessionNos.length} 冊`);
          go(`/books/${id}?created=${r.accessionNos.join(",")}`);
        },
      })
    );
    $("[data-delbook]", el)?.addEventListener("click", async () => {
      if (!(await confirmDialog(`確定刪除《${book.title}》和它的所有冊？刪除後無法復原。`, { okText: "刪除", danger: true }))) return;
      try {
        await DEL(`/books/${id}`);
        toastOk("已刪除");
        go("/books");
      } catch (err) {
        toastErr(err);
      }
    });
    el.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const act = b.dataset.act;
        const label = { lost: "標記為遺失", withdrawn: "註銷", available: "恢復為在架" }[act];
        const c = book.copies.find((x) => x.id === Number(b.dataset.id));
        if (!(await confirmDialog(`確定把 ${c.accessionNo} ${label}？`, { okText: label, danger: act !== "available" }))) return;
        try {
          book = await PATCH(`/copies/${c.id}`, { status: act });
          toastOk("已更新");
          draw();
        } catch (err) {
          toastErr(err);
        }
      })
    );
    el.querySelectorAll("[data-note]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = book.copies.find((x) => x.id === Number(b.dataset.note));
        formDialog({
          title: `${c.accessionNo} 備註`,
          fields: `<label class="field"><span>備註</span><input type="text" name="note" maxlength="200" value="${esc(c.note)}" placeholder="例如：封面破損、缺頁"></label>`,
          onSubmit: async (fd) => {
            book = await PATCH(`/copies/${c.id}`, { note: fd.get("note") });
            draw();
          },
        });
      })
    );
    el.querySelectorAll("[data-delcopy]").forEach((b) =>
      b.addEventListener("click", async () => {
        const c = book.copies.find((x) => x.id === Number(b.dataset.delcopy));
        if (!(await confirmDialog(`確定刪除 ${c.accessionNo}？（只用在建檔錯誤時；登錄號不會再被使用）`, { okText: "刪除", danger: true }))) return;
        try {
          await DEL(`/copies/${c.id}`);
          book = await GET(`/books/${id}`);
          toastOk("已刪除");
          draw();
        } catch (err) {
          toastErr(err);
        }
      })
    );
  }

  draw();
}

// ---------- 書目表單（新增與編輯共用） ----------
function bookForm({ data = {}, isNew, source = "" }) {
  return html`
    <form class="card stack" data-bookform>
      ${source}
      <div class="row" style="align-items:flex-start;gap:20px;flex-wrap:nowrap">
        <div style="width:160px;flex:none">
          <div data-coverbox>${cover(data.coverUrl, data.title || "無封面", "cover-md")}</div>
          <div class="stack" style="margin-top:8px">
            <button class="btn btn-sm btn-block" type="button" data-shoot>${icon("camera")}拍封面</button>
            <button class="btn btn-sm btn-block" type="button" data-pick>${icon("photo")}選擇圖片</button>
            <button class="btn btn-sm btn-block btn-ghost" type="button" data-nocover>移除封面</button>
          </div>
          <input type="file" accept="image/*" capture="environment" hidden data-shootfile>
          <input type="file" accept="image/*" hidden data-pickfile>
        </div>
        <div class="form-grid" style="flex:1;min-width:0">
          <label class="field full"><span>書名 *</span><input type="text" name="title" maxlength="200" required value="${data.title || ""}"></label>
          <label class="field"><span>作者</span><input type="text" name="author" maxlength="200" value="${data.author || ""}"></label>
          <label class="field"><span>出版社</span><input type="text" name="publisher" maxlength="100" value="${data.publisher || ""}"></label>
          <label class="field"><span>ISBN <span class="hint">沒有可留空</span></span><input type="text" name="isbn" inputmode="numeric" maxlength="20" value="${data.isbn || ""}"></label>
          <label class="field"><span>分類號</span><input type="text" name="classificationNo" class="mono" maxlength="50" value="${data.classificationNo || ""}" placeholder="例如：859.6"></label>
          <label class="field"><span>作者號</span><input type="text" name="authorNo" class="mono" maxlength="50" value="${data.authorNo || ""}" placeholder="例如：8344"></label>
          ${isNew ? html`<label class="field"><span>冊數 <span class="hint">同一本書買了幾本</span></span><input type="number" name="copies" min="1" max="50" value="1" required></label>` : ""}
          <label class="field full"><span>備註</span><input type="text" name="note" maxlength="500" value="${data.note || ""}"></label>
        </div>
      </div>
      <div class="row row-end">
        <a class="btn" href="${isNew ? "#/books" : `#/books/${data.id}`}">取消</a>
        <button class="btn btn-primary btn-lg" type="submit">${icon("check")}${isNew ? "儲存並產生登錄號" : "儲存"}</button>
      </div>
    </form>`;
}

/** 綁定書目表單的封面操作與送出。onSave(body) 負責呼叫 API。 */
function bindBookForm(el, { initialCover, title, onSave }) {
  const form = $("[data-bookform]", el);
  let coverData = initialCover?.startsWith("data:") ? initialCover : null; // 新的封面（data URL）
  let removed = false;
  const box = $("[data-coverbox]", form);
  const show = (url) => (box.innerHTML = cover(url, form.title.value || title || "無封面", "cover-md").toString());

  async function useFile(file) {
    if (!file) return;
    try {
      coverData = await resizeImage(file);
      removed = false;
      show(coverData);
    } catch (err) {
      toastErr(err);
    }
  }
  const shoot = $("[data-shootfile]", form);
  const pick = $("[data-pickfile]", form);
  $("[data-shoot]", form).addEventListener("click", () => shoot.click());
  $("[data-pick]", form).addEventListener("click", () => pick.click());
  shoot.addEventListener("change", () => (useFile(shoot.files[0]), (shoot.value = "")));
  pick.addEventListener("change", () => (useFile(pick.files[0]), (pick.value = "")));
  $("[data-nocover]", form).addEventListener("click", () => {
    coverData = null;
    removed = true;
    show(null);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector("button[type=submit]"), async () => {
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      if (body.copies) body.copies = Number(body.copies);
      if (coverData) body.coverData = coverData;
      if (removed) body.removeCover = true;
      try {
        await onSave(body);
      } catch (err) {
        toastErr(err);
      }
    });
  });
}

// ---------- 新增書籍（支援連續掃描多本書、自動線上查詢、批次建立） ----------
export async function newBookPage(el) {
  el.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>新增書籍</h1>
        <p>直接使用條碼掃描槍連續掃描書背 ISBN，系統會自動在背景查詢書目，不需每本按確認。</p>
      </div>
    </div>
    <div class="card" data-scan-card>
      <div class="card-head">
        <h2>連續掃描 ISBN</h2>
        <button class="btn btn-sm btn-ghost" data-noisbn>${icon("plus")}手動新增無 ISBN 書籍</button>
      </div>
      <div data-scanner></div>
      <div class="small muted" style="margin-top:8px">
        提示：掃描槍掃描後會自動觸發查詢；可一本接一本連續掃描，所有待確認的書籍都會即時列在下方。
      </div>
    </div>

    <div class="batch-bar" data-batch-bar hidden>
      <div class="row" style="align-items:center;gap:12px">
        <span style="font-weight:800;font-size:1.1rem" data-batch-summary>共 0 本待建檔書籍</span>
        <span class="small muted">請確認資料正確，可修改書名、冊數或拍照補充封面</span>
      </div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-clear-all>清空清單</button>
        <button class="btn btn-primary btn-lg" data-save-all>${icon("check")}全部儲存並產生登錄號</button>
      </div>
    </div>

    <div class="stack" data-books-list></div>
    <div data-manual-dialog-box></div>`.toString();

  const scannerBox = $("[data-scanner]", el);
  const batchBar = $("[data-batch-bar]", el);
  const batchSummary = $("[data-batch-summary]", el);
  const saveAllBtn = $("[data-save-all]", el);
  const clearAllBtn = $("[data-clear-all]", el);
  const booksListEl = $("[data-books-list]", el);
  const manualBox = $("[data-manual-dialog-box]", el);

  // 待新增書籍項目清單
  // 結構：{ key, isbn, title, author, publisher, copies, note, coverUrl, status: 'loading'|'ready'|'existing'|'error', errorMsg, sourceMsg, existingBook }
  let items = [];
  let itemSeq = 0;

  function updateBatchBar() {
    const readyItems = items.filter((it) => it.status === "ready" || it.status === "existing");
    if (!items.length) {
      batchBar.hidden = true;
      return;
    }
    batchBar.hidden = false;
    const loadingCount = items.filter((it) => it.status === "loading").length;
    batchSummary.textContent = `待處理共 ${items.length} 本${loadingCount ? `（${loadingCount} 本查詢中…）` : ""}`;
    saveAllBtn.disabled = loadingCount > 0 || !readyItems.length;
  }

  function renderItem(item) {
    const existingDom = booksListEl.querySelector(`[data-item-key="${item.key}"]`);
    const div = existingDom || document.createElement("div");
    div.className = "card batch-card stack";
    div.dataset.itemKey = item.key;

    if (item.status === "loading") {
      div.innerHTML = html`
        <div class="row" style="align-items:center;justify-content:space-between">
          <div class="row" style="align-items:center;gap:10px">
            <span class="tag tag-available mono">${item.isbn || "無 ISBN"}</span>
            <b>正在線上查詢書目資料…</b>
          </div>
          <button class="btn btn-sm btn-ghost" data-remove="${item.key}" title="移除">${icon("close")}</button>
        </div>
        <div class="loading" style="padding:16px 0"></div>`.toString();
      div.querySelector("[data-remove]")?.addEventListener("click", () => removeItem(item.key));
      if (!existingDom) booksListEl.prepend(div);
      return div;
    }

    if (item.status === "existing") {
      const b = item.existingBook;
      div.innerHTML = html`
        <div class="alert alert-info">
          ${icon("book")}
          <div style="flex:1">
            <b>這本書已經建檔！</b>目前已有 ${b.copies?.filter((c) => c.status === "available" || c.status === "on_loan").length || 0} 冊。若為新進圖書，可直接設定新增複本冊數。
          </div>
          <button class="btn btn-sm btn-ghost" data-remove="${item.key}" title="移除">${icon("close")}</button>
        </div>
        <div class="row" style="align-items:flex-start;gap:16px">
          ${cover(b.coverUrl || item.coverUrl, b.title, "cover-md")}
          <div class="stack" style="flex:1;min-width:200px">
            <h2>${b.title}</h2>
            <div class="muted">${b.author || ""}${b.publisher ? ` · ${b.publisher}` : ""} · <span class="mono">ISBN: ${item.isbn}</span></div>
            <div class="row" style="align-items:center;gap:12px;margin-top:6px">
              <label class="field" style="max-width:180px">
                <span>新增冊數</span>
                <input type="number" min="1" max="50" value="${item.copies || 1}" data-copies-input>
              </label>
              <a class="btn btn-sm" href="#/books/${b.id}" target="_blank" style="margin-top:22px">查看已建檔書目</a>
            </div>
          </div>
        </div>`.toString();

      div.querySelector("[data-remove]")?.addEventListener("click", () => removeItem(item.key));
      div.querySelector("[data-copies-input]")?.addEventListener("input", (e) => {
        item.copies = Math.max(1, Math.min(50, Number(e.target.value) || 1));
      });
      if (!existingDom) booksListEl.prepend(div);
      return div;
    }

    // 正常待新增狀態 (ready)
    div.innerHTML = html`
      ${item.sourceMsg ? html`<div class="alert alert-ok">${icon("check")}<span>${item.sourceMsg}</span></div>` : ""}
      ${item.errorMsg ? html`<div class="alert">${icon("warn")}<span>${item.errorMsg}</span></div>` : ""}
      <div class="row" style="align-items:flex-start;gap:20px;flex-wrap:nowrap">
        <div style="width:160px;flex:none">
          <div data-coverbox>${cover(item.coverUrl, item.title || "無封面", "cover-md")}</div>
          <div class="stack" style="margin-top:8px">
            <button class="btn btn-sm btn-block" type="button" data-shoot>${icon("camera")}拍封面</button>
            <button class="btn btn-sm btn-block" type="button" data-pick>${icon("photo")}選圖</button>
            ${item.coverUrl ? html`<button class="btn btn-sm btn-block btn-ghost" type="button" data-nocover>移除封面</button>` : ""}
          </div>
          <input type="file" accept="image/*" capture="environment" hidden data-shootfile>
          <input type="file" accept="image/*" hidden data-pickfile>
        </div>
        <div class="form-grid" style="flex:1;min-width:0">
          <label class="field full">
            <span>書名 *</span>
            <input type="text" name="title" maxlength="200" required value="${item.title || ""}" placeholder="例如：好餓的毛毛蟲">
          </label>
          <label class="field">
            <span>作者</span>
            <input type="text" name="author" maxlength="200" value="${item.author || ""}">
          </label>
          <label class="field">
            <span>出版社</span>
            <input type="text" name="publisher" maxlength="100" value="${item.publisher || ""}">
          </label>
          <label class="field">
            <span>ISBN</span>
            <input type="text" name="isbn" class="mono" inputmode="numeric" maxlength="20" value="${item.isbn || ""}" placeholder="沒有可留空">
          </label>
          <label class="field">
            <span>分類號</span>
            <input type="text" name="classificationNo" class="mono" maxlength="50" value="${item.classificationNo || ""}" placeholder="例如：859.6">
          </label>
          <label class="field">
            <span>作者號</span>
            <input type="text" name="authorNo" class="mono" maxlength="50" value="${item.authorNo || ""}" placeholder="例如：8344">
          </label>
          <label class="field">
            <span>冊數</span>
            <input type="number" name="copies" min="1" max="50" value="${item.copies || 1}" required>
          </label>
          <label class="field full">
            <span>備註</span>
            <input type="text" name="note" maxlength="500" value="${item.note || ""}" placeholder="可留空">
          </label>
        </div>
      </div>
      <div class="row row-end" style="margin-top:10px">
        <button class="btn btn-sm btn-danger" type="button" data-remove="${item.key}">${icon("trash")}移除</button>
      </div>`.toString();

    // 綁定輸入
    const titleInput = div.querySelector("[name=title]");
    const authorInput = div.querySelector("[name=author]");
    const publisherInput = div.querySelector("[name=publisher]");
    const isbnInput = div.querySelector("[name=isbn]");
    const classInput = div.querySelector("[name=classificationNo]");
    const authorNoInput = div.querySelector("[name=authorNo]");
    const copiesInput = div.querySelector("[name=copies]");
    const noteInput = div.querySelector("[name=note]");

    titleInput.addEventListener("input", (e) => {
      item.title = e.target.value.trim();
      titleInput.classList.remove("input-err");
    });
    authorInput.addEventListener("input", (e) => (item.author = e.target.value.trim()));
    publisherInput.addEventListener("input", (e) => (item.publisher = e.target.value.trim()));
    isbnInput.addEventListener("input", (e) => (item.isbn = e.target.value.trim()));
    classInput?.addEventListener("input", (e) => (item.classificationNo = e.target.value.trim()));
    authorNoInput?.addEventListener("input", (e) => (item.authorNo = e.target.value.trim()));
    copiesInput.addEventListener("input", (e) => {
      item.copies = Math.max(1, Math.min(50, Number(e.target.value) || 1));
    });
    noteInput.addEventListener("input", (e) => (item.note = e.target.value.trim()));

    div.querySelector("[data-remove]")?.addEventListener("click", () => removeItem(item.key));

    // 封面操作
    const coverBox = div.querySelector("[data-coverbox]");
    const shootFile = div.querySelector("[data-shootfile]");
    const pickFile = div.querySelector("[data-pickfile]");

    async function updateCover(file) {
      if (!file) return;
      try {
        const cUrl = await resizeImage(file);
        item.coverUrl = cUrl;
        coverBox.innerHTML = cover(cUrl, item.title || "無封面", "cover-md").toString();
        renderItem(item);
      } catch (err) {
        toastErr(err);
      }
    }

    div.querySelector("[data-shoot]")?.addEventListener("click", () => shootFile.click());
    div.querySelector("[data-pick]")?.addEventListener("click", () => pickFile.click());
    shootFile?.addEventListener("change", () => (updateCover(shootFile.files[0]), (shootFile.value = "")));
    pickFile?.addEventListener("change", () => (updateCover(pickFile.files[0]), (pickFile.value = "")));
    div.querySelector("[data-nocover]")?.addEventListener("click", () => {
      item.coverUrl = null;
      renderItem(item);
    });

    if (!existingDom) booksListEl.prepend(div);
    return div;
  }

  function removeItem(key) {
    items = items.filter((it) => it.key !== key);
    const dom = booksListEl.querySelector(`[data-item-key="${key}"]`);
    if (dom) dom.remove();
    updateBatchBar();
  }

  clearAllBtn.addEventListener("click", async () => {
    if (!items.length) return;
    if (await confirmDialog("確定要清空目前所有待新增的書籍清單嗎？", { okText: "清空", danger: true })) {
      items = [];
      booksListEl.innerHTML = "";
      updateBatchBar();
    }
  });

  // 掃描處理流程：不中斷連續掃描
  async function onCode(code) {
    const rawCode = String(code || "").trim();
    if (!rawCode) return;

    // 若同一 ISBN 已在待處理列表中，將冊數 +1 並閃爍突顯
    const existingItem = items.find((it) => it.isbn && it.isbn === rawCode);
    if (existingItem) {
      existingItem.copies = (existingItem.copies || 1) + 1;
      beep(true);
      toastOk(`ISBN ${rawCode} 已在清單中，冊數累計為 ${existingItem.copies} 冊`);
      const dom = renderItem(existingItem);
      dom?.classList.remove("batch-bump");
      void dom?.offsetWidth;
      dom?.classList.add("batch-bump");
      dom?.scrollIntoView({ behavior: "smooth", block: "center" });
      updateBatchBar();
      return `✓ 冊數增加至 ${existingItem.copies}`;
    }

    // 建立新項目並立即在畫面上呈現查詢狀態
    const newItem = {
      key: "it_" + ++itemSeq,
      isbn: rawCode,
      title: "",
      author: "",
      publisher: "",
      classificationNo: "",
      authorNo: "",
      copies: 1,
      note: "",
      coverUrl: null,
      status: "loading",
      errorMsg: "",
      sourceMsg: "",
      existingBook: null,
    };
    items.unshift(newItem);
    renderItem(newItem);
    updateBatchBar();

    // 背景非同步查詢
    (async () => {
      try {
        const local = await GET(`/isbn/${encodeURIComponent(rawCode)}/local`);
        newItem.isbn = local.isbn;

        if (local.book) {
          newItem.status = "existing";
          newItem.existingBook = local.book;
          newItem.title = local.book.title;
          newItem.author = local.book.author;
          newItem.publisher = local.book.publisher;
          newItem.classificationNo = local.book.classificationNo || "";
          newItem.authorNo = local.book.authorNo || "";
          newItem.coverUrl = local.book.coverUrl;
          beep(true);
          renderItem(newItem);
          updateBatchBar();
          return;
        }

        // 線上資料庫查書
        let found = null;
        let errors = [];
        let searched = [];
        let coverData = null;
        try {
          const r = await GET(`/isbn/${local.isbn}/lookup`);
          found = r.result;
          errors = r.errors ?? [];
          searched = r.searched ?? [];
          coverData = r.coverDataUrl ?? found?.coverDataUrl ?? null;
        } catch (err) {
          errors = [err.message];
        }

        let coverUrl = null;
        if (coverData) {
          try {
            coverUrl = await resizeImage(coverData);
          } catch {
            coverUrl = null;
          }
        }

        newItem.status = "ready";
        newItem.coverUrl = coverUrl;

        if (found) {
          beep(true);
          newItem.title = found.title || "";
          newItem.author = found.author || "";
          newItem.publisher = found.publisher || "";
          newItem.classificationNo = found.classificationNo || "";
          newItem.authorNo = found.authorNo || "";
          newItem.sourceMsg = `已自動從 ${found.source} 帶入資料${coverUrl ? "" : "（未找到封面，可拍照補上）"}`;
        } else {
          beep(false);
          if (!searched.length && errors.length) {
            newItem.errorMsg = `線上查詢連線失敗（${errors.join("；")}），請手動確認書名`;
          } else {
            newItem.errorMsg = `線上資料庫查無此書，請手動輸入書名等資料`;
          }
        }
        renderItem(newItem);
        updateBatchBar();
      } catch (err) {
        beep(false);
        newItem.status = "ready";
        newItem.errorMsg = err.message || "查詢失敗，請手動填寫";
        renderItem(newItem);
        updateBatchBar();
      }
    })();

    return `已掃描 ${rawCode}，查詢中…`;
  }

  createScanner(scannerBox, {
    onCode,
    continuous: true,
    placeholder: "掃描條碼或輸入 ISBN（支援連續掃描多本）",
  });

  // 手動新增無 ISBN 書籍
  $("[data-noisbn]", el).addEventListener("click", () => {
    const manualItem = {
      key: "it_" + ++itemSeq,
      isbn: "",
      title: "",
      author: "",
      publisher: "",
      classificationNo: "",
      authorNo: "",
      copies: 1,
      note: "",
      coverUrl: null,
      status: "ready",
      errorMsg: "",
      sourceMsg: "",
      existingBook: null,
    };
    items.unshift(manualItem);
    const dom = renderItem(manualItem);
    updateBatchBar();
    dom?.scrollIntoView({ behavior: "smooth", block: "start" });
    const titleInput = dom?.querySelector("[name=title]");
    if (titleInput) titleInput.focus();
  });

  // 全部儲存按鈕
  saveAllBtn.addEventListener("click", () =>
    busy(saveAllBtn, async () => {
      if (!items.length) return;

      // 檢查書名是否都有填寫
      let hasError = false;
      for (const item of items) {
        if (item.status === "ready" && !item.title.trim()) {
          hasError = true;
          const dom = booksListEl.querySelector(`[data-item-key="${item.key}"]`);
          const t = dom?.querySelector("[name=title]");
          if (t) {
            t.classList.add("input-err");
            dom?.scrollIntoView({ behavior: "smooth", block: "center" });
            t.focus();
          }
          break;
        }
      }

      if (hasError) {
        toastErr("請填寫完整的書籍名稱");
        return;
      }

      let createdCount = 0;
      let newCopiesCount = 0;
      const allAccessionNos = [];
      let lastBookId = null;

      const itemsToSave = [...items];
      try {
        for (const item of itemsToSave) {
          if (item.status === "existing") {
            const r = await POST(`/books/${item.existingBook.id}/copies`, { count: item.copies || 1 });
            newCopiesCount += r.accessionNos.length;
            allAccessionNos.push(...r.accessionNos);
            lastBookId = item.existingBook.id;
            removeItem(item.key);
          } else if (item.status === "ready") {
            const body = {
              title: item.title.trim(),
              author: item.author?.trim() || "",
              publisher: item.publisher?.trim() || "",
              isbn: item.isbn?.trim() || "",
              classificationNo: item.classificationNo?.trim() || "",
              authorNo: item.authorNo?.trim() || "",
              copies: item.copies || 1,
              note: item.note?.trim() || "",
            };
            if (item.coverUrl && item.coverUrl.startsWith("data:")) {
              body.coverData = item.coverUrl;
            }
            const r = await POST("/books", body);
            createdCount++;
            allAccessionNos.push(...r.accessionNos);
            lastBookId = r.id;
            removeItem(item.key);
          }
        }

        toastOk(`儲存完成！共新增 ${createdCount} 種書目，產生 ${allAccessionNos.length} 冊登錄號`);
        if (allAccessionNos.length && lastBookId) {
          go(`/labels?mode=accession&ids=${allAccessionNos.join(",")}`);
        } else {
          go("/books");
        }
      } catch (err) {
        toastErr(err);
        updateBatchBar();
      }
    })
  );
}

// ---------- 編輯書籍 ----------
export async function editBookPage(el, params) {
  const book = await GET(`/books/${params.id}`);
  el.innerHTML = html`<div class="page-head"><div><h1>編輯書目</h1></div></div>${bookForm({ data: book, isNew: false })}`.toString();
  bindBookForm(el, {
    initialCover: book.coverUrl,
    title: book.title,
    onSave: async (body) => {
      await PUT(`/books/${book.id}`, body);
      toastOk("已儲存");
      go(`/books/${book.id}`);
    },
  });
}

// ---------- 條碼標籤 ----------
const PAGE_W = 210;
const PAGE_H = 297;

function renderSheets(labels, s, startPos, { preview }) {
  const perPage = s.labelCols * s.labelRows;
  const slots = [...Array(startPos - 1).fill(null), ...labels];
  const pages = [];
  for (let i = 0; i < slots.length; i += perPage) pages.push(slots.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const barH = Math.max(6, s.labelHeightMm - (s.labelShowSchool && state.schoolName ? 9 : 6.5));
  return pages.map((items, pi) => {
    const page = document.createElement("div");
    page.className = `label-page ${preview ? "label-preview-outline" : ""}`;
    page.style.width = `${PAGE_W}mm`;
    page.style.height = `${PAGE_H}mm`;
    for (let pos = 0; pos < perPage; pos++) {
      const item = items[pos];
      const cell = document.createElement("div");
      cell.className = "label-cell";
      const col = pos % s.labelCols;
      const row = Math.floor(pos / s.labelCols);
      cell.style.left = `${s.labelPageLeftMm + col * (s.labelWidthMm + s.labelGapXMm)}mm`;
      cell.style.top = `${s.labelPageTopMm + row * (s.labelHeightMm + s.labelGapYMm)}mm`;
      cell.style.width = `${s.labelWidthMm}mm`;
      cell.style.height = `${s.labelHeightMm}mm`;
      if (item) {
        if (s.labelShowSchool && state.schoolName) {
          const sc = document.createElement("div");
          sc.className = "l-school";
          sc.textContent = state.schoolName;
          cell.appendChild(sc);
        }
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        try {
          window.JsBarcode(svg, item.accessionNo, { format: "CODE128", width: 2, height: 50, margin: 0, fontSize: 16, textMargin: 1, font: "monospace" });
          const w = svg.getAttribute("width");
          const h = svg.getAttribute("height");
          svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.removeAttribute("style");
          svg.style.height = `${barH}mm`;
          svg.style.maxWidth = "100%";
        } catch {
          /* 理論上不會發生 */
        }
        cell.appendChild(svg);
        const t = document.createElement("div");
        t.className = "l-title";
        t.textContent = item.title;
        cell.appendChild(t);
      } else if (preview) {
        cell.classList.add(pi === 0 && pos < startPos - 1 ? "preview-skip" : "preview-empty");
      }
      page.appendChild(cell);
    }
    return page;
  });
}

export async function labelsPage(el, _params, query) {
  const s = await GET("/settings");
  const perPage = s.labelCols * s.labelRows;
  let mode = query.get("mode") || "unprinted";
  const ids = query.get("ids") || "";
  let labels = [];

  el.innerHTML = html`
    <div class="page-head">
      <div><h1>列印條碼標籤</h1><p>使用 A4 標籤貼紙（目前設定：${s.labelCols} 欄 × ${s.labelRows} 列，每格 ${s.labelWidthMm} × ${s.labelHeightMm} mm）。<a href="#/admin/settings">修改標籤紙規格</a></p></div>
    </div>
    <div class="card">
      <div class="form-grid">
        <label class="field"><span>要列印哪些</span>
          <select data-mode>
            <option value="unprinted">尚未列印標籤的冊</option>
            <option value="range">指定登錄號範圍</option>
            ${mode === "books" || mode === "accession" ? html`<option value="${mode}">從書籍頁帶入的冊</option>` : ""}
          </select></label>
        <label class="field" data-rangebox hidden><span>登錄號從</span><input type="text" data-from placeholder="${s.accessionPrefix}0001"></label>
        <label class="field" data-rangebox hidden><span>到</span><input type="text" data-to placeholder="${s.accessionPrefix}0030"></label>
        <label class="field"><span>從第幾格開始印 <span class="hint">用剩的標籤紙可跳過已用的格子</span></span>
          <input type="number" data-start min="1" max="${perPage}" value="1"></label>
      </div>
      <div class="row" style="margin-top:14px">
        <span data-count class="muted"></span><span class="spacer"></span>
        <button class="btn btn-primary btn-lg" data-print>${icon("print")}列印</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>預覽</h2><span class="small muted">虛線是標籤格線（不會印出），斜線格是跳過的格子</span></div>
      <div class="label-sheet-preview" data-preview></div>
    </div>`.toString();

  const modeSel = $("[data-mode]", el);
  modeSel.value = mode;
  const startInput = $("[data-start]", el);
  const preview = $("[data-preview]", el);

  function drawPreview() {
    const start = Math.min(perPage, Math.max(1, Number(startInput.value) || 1));
    const pages = renderSheets(labels, s, start, { preview: true });
    preview.innerHTML = "";
    const avail = preview.clientWidth - 32;
    const pxW = (PAGE_W / 25.4) * 96;
    const scale = Math.min(1, avail / pxW);
    for (const p of pages) {
      const wrap = document.createElement("div");
      wrap.style.width = `${pxW * scale}px`;
      wrap.style.height = `${((PAGE_H / 25.4) * 96) * scale}px`;
      wrap.style.margin = "0 auto 16px";
      p.style.transform = `scale(${scale})`;
      p.style.transformOrigin = "top left";
      p.style.margin = "0";
      wrap.appendChild(p);
      preview.appendChild(wrap);
    }
    $("[data-count]", el).textContent = labels.length ? `共 ${labels.length} 張標籤，${pages.length} 頁` : "沒有要列印的標籤";
    $("[data-print]", el).disabled = !labels.length;
  }

  async function load() {
    mode = modeSel.value;
    el.querySelectorAll("[data-rangebox]").forEach((b) => (b.hidden = mode !== "range"));
    let q;
    if (mode === "range") {
      const from = $("[data-from]", el).value.trim();
      const to = $("[data-to]", el).value.trim();
      if (!from || !to) {
        labels = [];
        return drawPreview();
      }
      q = { mode, from, to };
    } else if (mode === "books") q = { mode: "books", ids };
    else if (mode === "accession") {
      // 從新增書籍帶入登錄號：轉成範圍查詢後再過濾
      const nos = ids.split(",").filter(Boolean).sort();
      const all = await GET(`/labels${qs({ mode: "range", from: nos[0], to: nos[nos.length - 1] })}`);
      labels = all.filter((l) => nos.includes(l.accessionNo));
      return drawPreview();
    } else q = { mode: "unprinted" };
    try {
      labels = await GET(`/labels${qs(q)}`);
    } catch (err) {
      labels = [];
      toastErr(err);
    }
    drawPreview();
  }

  modeSel.addEventListener("change", load);
  el.querySelectorAll("[data-from],[data-to]").forEach((i) => i.addEventListener("change", load));
  startInput.addEventListener("input", drawPreview);
  const onResize = () => drawPreview();
  window.addEventListener("resize", onResize);

  $("[data-print]", el).addEventListener("click", async () => {
    const start = Math.min(perPage, Math.max(1, Number(startInput.value) || 1));
    const root = document.getElementById("labelPrintRoot");
    root.innerHTML = "";
    renderSheets(labels, s, start, { preview: false }).forEach((p) => root.appendChild(p));
    window.print();
    root.innerHTML = "";
    const notPrinted = labels.filter((l) => !l.labelPrinted);
    if (!notPrinted.length) return;
    if (await confirmDialog(`標籤都印好了嗎？確認後這 ${notPrinted.length} 冊會標記為「已列印」，下次不會再出現在「尚未列印」清單。`, { okText: "已印好", title: "列印完成" })) {
      try {
        await POST("/labels/mark-printed", { copyIds: notPrinted.map((l) => l.id) });
        toastOk("已標記為已列印");
        if (mode === "unprinted") load();
        else labels.forEach((l) => (l.labelPrinted = true));
      } catch (err) {
        toastErr(err);
      }
    }
  });

  await load();
  return () => window.removeEventListener("resize", onResize);
}

export { fmtDate };
