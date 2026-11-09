// 管理頁面：老師帳號、班級、系統設定、備份與還原。
import { GET, POST, PUT, api } from "../api.js";
import { state } from "../app.js";
import { $, busy, confirmDialog, download, esc, fmtDateTime, fmtSize, formDialog, html, icon, toastErr, toastOk } from "../ui.js";

// ---------- 老師帳號 ----------
export async function usersPage(el) {
  async function draw() {
    const [users, classes] = await Promise.all([GET("/users"), GET("/classes")]);
    el.innerHTML = html`
      <div class="page-head">
        <div><h1>老師帳號</h1><p>每位老師用自己的帳號登入借書。新帳號第一次登入時會要求修改密碼。</p></div>
        <button class="btn btn-primary" data-add>${icon("plus")}新增帳號</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>姓名</th><th>帳號</th><th>班級</th><th>身分</th><th>借閱中</th><th>狀態</th><th></th></tr></thead>
        <tbody>${users.map(
          (u) => html`<tr style="${u.active ? "" : "opacity:.55"}">
            <td class="nowrap"><b>${u.name}</b></td>
            <td class="mono">${u.username}</td>
            <td class="nowrap">${u.className}</td>
            <td>${u.role === "admin" ? html`<span class="tag tag-admin">管理員</span>` : html`<span class="tag">老師</span>`}</td>
            <td>${u.activeLoans}</td>
            <td class="nowrap">${u.active ? (u.mustChangePassword ? html`<span class="small muted">待改密碼</span>` : "啟用") : "停用"}</td>
            <td class="actions"><button class="btn btn-sm" data-edit="${u.id}">編輯</button><button class="btn btn-sm" data-reset="${u.id}">重設密碼</button></td>
          </tr>`
        )}</tbody></table></div></div>`.toString();

    const classOpts = (sel) => classes.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const commonFields = (u = {}) => `
      <label class="field"><span>姓名 *</span><input type="text" name="name" maxlength="30" required value="${esc(u.name || "")}"></label>
      <label class="field"><span>班級 *</span><select name="classId" required>${classOpts(u.classId)}</select></label>
      <label class="field"><span>身分</span><select name="role">
        <option value="teacher" ${u.role !== "admin" ? "selected" : ""}>老師（借還書、查詢自己的紀錄）</option>
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>管理員（全部功能）</option></select></label>`;

    $("[data-add]", el).addEventListener("click", () =>
      formDialog({
        title: "新增老師帳號",
        fields: `${commonFields()}
          <label class="field"><span>登入帳號 * <span class="hint">英文或數字，例如 wang</span></span><input type="text" name="username" autocapitalize="off" maxlength="30" required></label>
          <label class="field"><span>初始密碼 * <span class="hint">至少 6 個字元，老師第一次登入後要自己改</span></span><input type="text" name="password" minlength="6" required></label>`,
        submitText: "新增",
        onSubmit: async (fd) => {
          await POST("/users", Object.fromEntries(fd.entries()));
          toastOk("已新增帳號");
          draw();
        },
      })
    );
    el.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const u = users.find((x) => x.id === Number(b.dataset.edit));
        formDialog({
          title: `編輯：${u.name}`,
          fields: `${commonFields(u)}
            <label class="check"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> 啟用此帳號 <span class="small muted">（停用後不能登入，借閱紀錄會保留）</span></label>`,
          onSubmit: async (fd) => {
            const body = Object.fromEntries(fd.entries());
            body.active = fd.has("active");
            await PUT(`/users/${u.id}`, body);
            toastOk("已儲存");
            if (u.id === state.user.id) location.reload();
            else draw();
          },
        });
      })
    );
    el.querySelectorAll("[data-reset]").forEach((b) =>
      b.addEventListener("click", () => {
        const u = users.find((x) => x.id === Number(b.dataset.reset));
        formDialog({
          title: `重設密碼：${u.name}`,
          fields: `<p class="muted" style="margin:0">設定一組臨時密碼告訴老師，老師登入後會被要求改成自己的密碼。</p>
            <label class="field"><span>臨時密碼</span><input type="text" name="password" minlength="6" required></label>`,
          submitText: "重設",
          onSubmit: async (fd) => {
            await POST(`/users/${u.id}/reset-password`, { password: fd.get("password") });
            toastOk("密碼已重設");
            draw();
          },
        });
      })
    );
  }
  await draw();
}

// ---------- 班級 ----------
export async function classesPage(el) {
  async function draw() {
    const classes = await GET("/classes?all=1");
    el.innerHTML = html`
      <div class="page-head">
        <div><h1>班級</h1><p>老師所屬的班級。借書時會記錄老師當時的班級，之後換班也不影響舊紀錄。</p></div>
        <button class="btn btn-primary" data-add>${icon("plus")}新增班級</button>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>排序</th><th>班級名稱</th><th>老師人數</th><th>狀態</th><th></th></tr></thead>
        <tbody>${classes.map(
          (c) => html`<tr style="${c.active ? "" : "opacity:.55"}">
            <td>${c.isAdminGroup ? "—" : c.sortOrder}</td>
            <td><b>${c.name}</b>${c.isAdminGroup ? html` <span class="small muted">（系統預設，給行政人員使用）</span>` : ""}</td>
            <td>${c.userCount}</td>
            <td>${c.active ? "使用中" : "停用"}</td>
            <td class="actions"><button class="btn btn-sm" data-edit="${c.id}">編輯</button></td>
          </tr>`
        )}</tbody></table></div></div>`.toString();

    $("[data-add]", el).addEventListener("click", () =>
      formDialog({
        title: "新增班級",
        fields: `<label class="field"><span>班級名稱</span><input type="text" name="name" maxlength="30" placeholder="例如：大班、蘋果班" required></label>`,
        submitText: "新增",
        onSubmit: async (fd) => {
          await POST("/classes", { name: fd.get("name") });
          toastOk("已新增班級");
          draw();
        },
      })
    );
    el.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = classes.find((x) => x.id === Number(b.dataset.edit));
        formDialog({
          title: `編輯班級：${c.name}`,
          fields: `<label class="field"><span>班級名稱</span><input type="text" name="name" maxlength="30" required value="${esc(c.name)}"></label>
            ${c.isAdminGroup ? "" : `<label class="field"><span>排序 <span class="hint">數字小的排前面</span></span><input type="number" name="sortOrder" value="${c.sortOrder}"></label>
            <label class="check"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> 使用中</label>`}`,
          onSubmit: async (fd) => {
            await PUT(`/classes/${c.id}`, {
              name: fd.get("name"),
              sortOrder: fd.get("sortOrder") ?? undefined,
              active: c.isAdminGroup ? true : fd.has("active"),
            });
            toastOk("已儲存");
            draw();
          },
        });
      })
    );
  }
  await draw();
}

// ---------- 系統設定 ----------
export async function settingsPage(el) {
  const s = await GET("/settings");
  const num = (name, label, hint, step = 1) =>
    html`<label class="field"><span>${label}${hint ? html` <span class="hint">${hint}</span>` : ""}</span><input type="number" name="${name}" step="${step}" value="${s[name]}"></label>`;
  el.innerHTML = html`
    <div class="page-head"><div><h1>系統設定</h1></div></div>
    <form class="stack" data-form>
      <div class="card">
        <h2 style="margin-bottom:12px">基本</h2>
        <div class="form-grid">
          <label class="field full"><span>學校名稱 <span class="hint">顯示在頁首與標籤上</span></span><input type="text" name="schoolName" maxlength="40" value="${s.schoolName}"></label>
        </div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">借閱規則</h2>
        <div class="form-grid">
          ${num("loanDays", "借期（天）", "修改後只影響之後借出的書")}
          ${num("maxLoansPerUser", "每位老師同時借閱上限（本）")}
        </div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">登錄號</h2>
        <div class="form-grid">
          <label class="field"><span>字首 <span class="hint">英文字母</span></span><input type="text" name="accessionPrefix" maxlength="5" value="${s.accessionPrefix}"></label>
          ${num("accessionDigits", "數字位數")}
          <div class="field"><span>下一個登錄號</span><div class="mono" style="padding:10px 0" data-nextno></div></div>
        </div>
        <p class="small muted" style="margin:10px 0 0">已經產生的登錄號不會改變。修改字首只影響之後新增的書。</p>
      </div>
      <div class="card">
        <h2 style="margin-bottom:4px">標籤紙規格</h2>
        <p class="small muted" style="margin:0 0 12px">請依照購買的 A4 標籤貼紙包裝上的尺寸填寫（單位：公釐 mm）。建議先用白紙試印，對著標籤紙透光比對位置。</p>
        <div class="form-grid">
          ${num("labelCols", "每列幾格（欄數）")}
          ${num("labelRows", "每頁幾列（列數）")}
          ${num("labelWidthMm", "每格寬度", "mm", 0.1)}
          ${num("labelHeightMm", "每格高度", "mm", 0.1)}
          ${num("labelPageTopMm", "上邊界", "mm", 0.1)}
          ${num("labelPageLeftMm", "左邊界", "mm", 0.1)}
          ${num("labelGapXMm", "左右間距", "mm", 0.1)}
          ${num("labelGapYMm", "上下間距", "mm", 0.1)}
          <label class="check full"><input type="checkbox" name="labelShowSchool" ${s.labelShowSchool ? "checked" : ""}> 標籤上印學校名稱</label>
        </div>
        <p class="small muted" data-fit style="margin:10px 0 0"></p>
      </div>
      <div class="card">
        <h2 style="margin-bottom:4px">新版本</h2>
        <p class="small muted" style="margin:0 0 12px">開啟後，系統啟動時會連到 GitHub 查詢最新的版本號（每 12 小時一次），有新版本時在首頁提醒管理員。只查詢版本號，不會傳送任何學校資料。</p>
        <label class="check full"><input type="checkbox" name="updateCheck" ${s.updateCheck ? "checked" : ""}> 自動檢查新版本</label>
        <div class="row" style="margin-top:12px;align-items:center;flex-wrap:wrap;gap:10px">
          <span class="small" data-update-status>讀取中…</span>
          <button class="btn btn-sm" type="button" data-update-check>${icon("search")}立即檢查</button>
        </div>
      </div>
      <div class="row row-end"><button class="btn btn-primary btn-lg" type="submit">${icon("check")}儲存設定</button></div>
    </form>`.toString();

  const statusEl = $("[data-update-status]", el);
  const showUpdate = (u) => {
    const parts = [`目前版本 v${u.current}`];
    if (!u.enabled) parts.push("自動檢查已關閉");
    else {
      if (u.hasUpdate) parts.push(`最新版本 v${u.latest}`);
      else if (u.latest) parts.push("已經是最新版本");
      if (u.error) parts.push(`上次檢查失敗：${u.error}`);
      else if (u.checkedAt) parts.push(`檢查時間 ${new Date(u.checkedAt).toLocaleString("zh-TW", { hour12: false })}`);
      else parts.push("尚未檢查");
    }
    statusEl.textContent = parts.join("　·　");
    const old = statusEl.parentElement.querySelector("a[data-update-link]");
    if (old) old.remove();
    if (u.enabled && u.hasUpdate) {
      const a = document.createElement("a");
      a.className = "btn btn-sm btn-primary";
      a.href = u.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.dataset.updateLink = "";
      a.textContent = `下載 v${u.latest}`;
      statusEl.after(a);
    }
  };
  GET("/system/update").then(showUpdate, () => (statusEl.textContent = ""));
  $("[data-update-check]", el).addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      try {
        showUpdate(await POST("/system/update/check"));
      } catch (err) {
        toastErr(err);
      }
    })
  );

  const form = $("[data-form]", el);
  const update = () => {
    const f = Object.fromEntries(new FormData(form).entries());
    const prefix = (f.accessionPrefix || "").toUpperCase();
    $("[data-nextno]", el).textContent = `${prefix}${String(s.nextAccession).padStart(Number(f.accessionDigits) || 4, "0")}`;
    const w = Number(f.labelPageLeftMm) + Number(f.labelCols) * Number(f.labelWidthMm) + (Number(f.labelCols) - 1) * Number(f.labelGapXMm);
    const h = Number(f.labelPageTopMm) + Number(f.labelRows) * Number(f.labelHeightMm) + (Number(f.labelRows) - 1) * Number(f.labelGapYMm);
    const fit = $("[data-fit]", el);
    const over = w > 210.5 || h > 297.5;
    fit.textContent = `版面總寬 ${w.toFixed(1)} mm × 總高 ${h.toFixed(1)} mm（A4 為 210 × 297）${over ? "，超出 A4 範圍，請檢查數字" : ""}`;
    fit.style.color = over ? "var(--danger)" : "";
  };
  form.addEventListener("input", update);
  update();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector("button[type=submit]"), async () => {
      const body = Object.fromEntries(new FormData(form).entries());
      body.labelShowSchool = form.labelShowSchool.checked;
      body.updateCheck = form.updateCheck.checked;
      try {
        const saved = await PUT("/settings", body);
        GET("/system/update").then(showUpdate, () => undefined);
        state.schoolName = saved.schoolName;
        document.getElementById("schoolName").textContent = saved.schoolName ? `${saved.schoolName} ` : "";
        toastOk("設定已儲存");
      } catch (err) {
        toastErr(err);
      }
    });
  });
}

// ---------- 備份與還原 ----------
export async function backupPage(el) {
  async function draw() {
    const list = await GET("/backups");
    const kindLabel = { auto: "啟動時自動", manual: "手動", "before-restore": "還原前自動" };
    el.innerHTML = html`
      <div class="page-head">
        <div><h1>備份與還原</h1><p>備份檔包含所有書目、借閱紀錄、帳號和封面圖片。系統每次啟動時會自動備份（保留最近 10 份）。</p></div>
        <button class="btn btn-primary" data-backup>${icon("backup")}立即備份</button>
      </div>
      <div class="alert alert-info">${icon("warn")}<span>備份檔存在這台電腦的 <span class="mono">bin\\backups</span> 資料夾。<b>建議定期下載一份存到隨身碟或雲端硬碟</b>，以免電腦故障時資料一起遺失。</span></div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h2>備份檔（${list.length}）</h2></div>
        ${list.length
          ? html`<div class="table-wrap"><table class="table"><thead><tr><th>時間</th><th>類型</th><th>大小</th><th></th></tr></thead>
              <tbody>${list.map(
                (b) => html`<tr><td class="nowrap">${fmtDateTime(b.createdAt)}</td><td>${kindLabel[b.kind] || b.kind}</td><td>${fmtSize(b.size)}</td>
                  <td class="actions"><button class="btn btn-sm" data-dl="${b.name}">${icon("download")}下載</button></td></tr>`
              )}</tbody></table></div>`
          : html`<div class="empty">還沒有備份</div>`}
      </div>
      <div class="card">
        <h2>從備份檔還原</h2>
        <p class="muted">把資料恢復成備份當時的狀態。<b>目前的資料會被取代</b>（還原前系統會先自動備份目前的資料，萬一選錯還能救回）。還原後需要重新登入。</p>
        <div class="row"><input type="file" accept=".zip" data-file><button class="btn btn-danger" data-restore>還原</button></div>
      </div>`.toString();

    const bb = $("[data-backup]", el);
    bb.addEventListener("click", () =>
      busy(bb, async () => {
        try {
          await POST("/backups");
          toastOk("備份完成");
          draw();
        } catch (err) {
          toastErr(err);
        }
      })
    );
    el.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => download(`/api/backups/${encodeURIComponent(b.dataset.dl)}`)));
    const rb = $("[data-restore]", el);
    rb.addEventListener("click", async () => {
      const file = $("[data-file]", el).files[0];
      if (!file) return toastErr("請先選擇備份檔（.zip）");
      if (!(await confirmDialog(`確定用「${file.name}」還原？目前的資料會被取代。`, { okText: "還原", danger: true }))) return;
      busy(rb, async () => {
        try {
          const fd = new FormData();
          fd.append("file", file);
          await api("POST", "/restore", fd);
          toastOk("還原完成，請重新登入");
          setTimeout(() => location.reload(), 1200);
        } catch (err) {
          toastErr(err);
        }
      });
    });
  }
  await draw();
}
