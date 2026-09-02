const WORKER_URL = "https://maru-addons-admin.maru-0727.workers.dev";
const ADMIN_URL = "../admin/";
let siteData = null;
let token = sessionStorage.getItem("maruAddonsAdminToken") || "";
let dirty = false;
let selectedType = null;

const $ = (id) => document.getElementById(id);

function setStatus(text, className = "") {
  const el = $("saveStatus");
  if (!el) return;
  el.className = `save-status ${className}`.trim();
  el.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPreview() {
  const frame = $("websiteFrame");
  if (!frame || !siteData) return;

  const version = siteData.version || "v1.4.5";
  const versionNote = siteData.versionNote || "Scratch向け / コンソール実行対応";
  const notice = siteData.notice || "現在、お知らせはありません。";
  const warning = siteData.warning || "まる Addons はScratch非公式のツールです。";
  const history = Array.isArray(siteData.history) ? siteData.history : [];

  frame.innerHTML = `
    <div class="preview-page">
      <header class="preview-header">
        <div class="preview-brand"><span class="preview-logo">S</span><strong>まる Addons</strong></div>
        <div class="preview-nav">Features　 Install　 Updates</div>
      </header>
      <section class="preview-hero">
        <div class="preview-card preview-main">
          <span class="preview-eyebrow">SCRATCH UTILITY</span>
          <h1><span class="scratch-orange">Scratchを、</span><br>もっと便利に。</h1>
          <p>Scratch に「ちょっと欲しかった」を追加する非公式ユーティリティ。</p>
        </div>
        <div class="preview-card preview-version" data-edit="version">
          <small>CURRENT VERSION</small>
          <strong>${escapeHtml(version)}</strong>
          <span>${escapeHtml(versionNote)}</span>
        </div>
      </section>
      <section class="preview-section">
        <span class="preview-kicker">FEATURES</span>
        <h2>今ある機能</h2>
        <div class="preview-grid">
          <div class="preview-feature"><b>FPS</b><strong>Browser FPS</strong><span>ブラウザFPSを表示</span></div>
          <div class="preview-feature"><b>60</b><strong>60FPS Mode</strong><span>Alt + スタートで切替</span></div>
          <div class="preview-feature"><b>#</b><strong>ブロック数</strong><span>ブロック数を表示</span></div>
          <div class="preview-feature"><b>VM</b><strong>VM取得</strong><span>Scratch VMを検出</span></div>
        </div>
      </section>
      <section class="preview-section">
        <span class="preview-kicker">INSTALL</span>
        <h2>学タブでも、1回貼るだけ。</h2>
        <div class="preview-notice" data-edit="warning"><b>注意:</b> ${escapeHtml(warning).replaceAll("\n", "<br>")}</div>
      </section>
      <section class="preview-section">
        <span class="preview-kicker">UPDATES & NOTES</span>
        <h2>更新情報・注意書き</h2>
        <div class="preview-update-grid">
          <div class="preview-card preview-update" data-edit="notice"><h3>お知らせ</h3><p>${escapeHtml(notice).replaceAll("\n", "<br>")}</p></div>
          <div class="preview-card preview-update"><h3>Version History</h3>${history.map(item => `<div class="preview-history"><b>${escapeHtml(item.version)}</b> <small>${escapeHtml(item.date)}</small><span>${escapeHtml(item.text)}</span></div>`).join("") || "<p>更新履歴はありません。</p>"}</div>
        </div>
      </section>
    </div>`;

  frame.querySelectorAll("[data-edit]").forEach((element) => {
    element.addEventListener("click", () => openEditor(element.dataset.edit));
  });
}

function openEditor(type) {
  selectedType = type;
  $("propertyEmpty")?.classList.add("hidden");
  $("propertyContent")?.classList.remove("hidden");
  $("textControls")?.classList.remove("hidden");
  $("colorControls")?.classList.add("hidden");
  $("linkControls")?.classList.add("hidden");
  $("imageControls")?.classList.add("hidden");
  $("propertyType").textContent = type.toUpperCase();
  $("propertyTitle").textContent = type === "version" ? "バージョン" : type === "notice" ? "お知らせ" : "注意書き";
  $("textValue").value = type === "version" ? siteData.version || "" : type === "notice" ? siteData.notice || "" : siteData.warning || "";
}

function closeEditor() {
  selectedType = null;
  $("propertyEmpty")?.classList.remove("hidden");
  $("propertyContent")?.classList.add("hidden");
}

function updateSelected() {
  if (!selectedType || !siteData) return;
  const value = $("textValue").value;
  if (selectedType === "version") siteData.version = value;
  if (selectedType === "notice") siteData.notice = value;
  if (selectedType === "warning") siteData.warning = value;
  dirty = true;
  setStatus("未保存の変更", "dirty");
  const type = selectedType;
  renderPreview();
  openEditor(type);
}

async function loadData() {
  setStatus("読み込み中...");
  const response = await fetch(`${WORKER_URL}/site-data?cb=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`読み込み失敗 (HTTP ${response.status})`);
  siteData = await response.json();
  renderPreview();
  setStatus("保存済み", "saved");
}

async function saveData() {
  if (!token) {
    window.location.href = ADMIN_URL;
    return;
  }
  $("saveModal")?.classList.remove("hidden");
}

async function confirmSave() {
  $("saveModal")?.classList.add("hidden");
  setStatus("保存中...");
  try {
    const response = await fetch(`${WORKER_URL}/admin/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ siteData })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "保存に失敗しました");
    dirty = false;
    setStatus("保存しました", "saved");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

$("backButton")?.addEventListener("click", () => { window.location.href = ADMIN_URL; });
$("closePropertyButton")?.addEventListener("click", closeEditor);
$("saveButton")?.addEventListener("click", saveData);
$("cancelSaveButton")?.addEventListener("click", () => $("saveModal")?.classList.add("hidden"));
$("confirmSaveButton")?.addEventListener("click", confirmSave);
$("undoButton")?.addEventListener("click", () => location.reload());
$("redoButton")?.addEventListener("click", () => {});
$("previewButton")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("textValue")?.addEventListener("input", updateSelected);

if (!token) {
  window.location.href = ADMIN_URL;
} else {
  loadData().catch((error) => setStatus(error.message, "error"));
}
