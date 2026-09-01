(() => {
  "use strict";

  const MARU_ADDONS_VERSION = "1.3.1";

  // =========================================================
  // 二重起動防止
  // =========================================================

  if (window.__MARU_ADDONS_LOADED__) {
    console.log("[Maru] まる Addons は既に起動しています");
    return;
  }

  window.__MARU_ADDONS_LOADED__ = true;

  console.log(`[Maru] まる Addons v${MARU_ADDONS_VERSION} 起動`);

  // =========================================================
  // 状態
  // =========================================================

  let vm = null;

  let scratchFPS = 0;
  let browserFPS = 0;

  let lastRender = null;
  let lastFPS = null;

  let blockCount = 0;

  let unshareProcessing = false;

  // =========================================================
  // 共通CSS
  // =========================================================

  const style = document.createElement("style");

  style.id = "maru-addons-style";

  style.textContent = `
    #maru-addons-top-panel {
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 999999;
      min-width: 170px;
      padding: 10px 13px;
      border-radius: 8px;
      background: rgba(30, 30, 30, 0.94);
      color: white;
      font-family: Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      user-select: none;
    }

    #maru-addons-top-title {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 3px;
    }

    #maru-addons-browser-fps {
      font-size: 12px;
      opacity: 0.9;
    }

    #maru-addons-scratch-fps {
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      padding: 0 5px;
      color: #8fd8ff;
      font-family: Arial, sans-serif;
      font-size: 13px;
      font-weight: bold;
      white-space: nowrap;
      user-select: none;
      pointer-events: none;
      transform: translateY(2px);
    }

    #maru-addons-block-count {
      display: inline-flex;
      align-items: center;
      margin-left: 8px;
      padding: 0 5px;
      color: #ffffff;
      font-family: Arial, sans-serif;
      font-size: 13px;
      font-weight: bold;
      white-space: nowrap;
      user-select: none;
      pointer-events: none;
    }

    .maru-addons-unshare-button {
      background: hsla(30, 100%, 55%, 1) !important;
      color: white !important;
      cursor: pointer !important;
    }
  `;

  document.head.appendChild(style);

  // =========================================================
  // VM取得
  // =========================================================

  function findVM() {
    try {
      const el = document.querySelector('[class*="stage-wrapper"]');

      if (!el) {
        return null;
      }

      const entry = Object.entries(el).find(([key]) => /Fiber/.test(key));

      if (!entry) {
        return null;
      }

      let fiber = entry[1];

      while (fiber && !fiber.pendingProps?.vm) {
        fiber = fiber.return;
      }

      return fiber?.pendingProps?.vm || null;
    } catch (e) {
      console.warn("[Maru] VM取得エラー:", e);
      return null;
    }
  }

  // =========================================================
  // ブロック数
  // =========================================================

  function getBlockCount() {
    if (!vm?.runtime?.targets) {
      return 0;
    }

    let count = 0;

    try {
      for (const target of vm.runtime.targets) {
        if (!target?.blocks) continue;

        const blocks = target.blocks._blocks;

        if (!blocks) continue;

        count += Object.keys(blocks).length;
      }
    } catch (e) {
      console.warn("[Maru] ブロック数取得エラー:", e);
    }

    return count;
  }

  // =========================================================
  // Scratch FPS
  // =========================================================

  function setupScratchFPS() {
    if (!vm?.runtime?.renderer) {
      return;
    }

    const renderer = vm.runtime.renderer;

    if (renderer.__MARU_ADDONS_PATCHED__) {
      return;
    }

    renderer.__MARU_ADDONS_PATCHED__ = true;

    const originalDraw = renderer.draw;

    if (typeof originalDraw !== "function") {
      return;
    }

    renderer.draw = function () {
      originalDraw.apply(this, arguments);

      try {
        const now = vm.runtime.currentMSecs;

        if (typeof now !== "number") {
          return;
        }

        if (lastRender === null || now - lastRender > 500) {
          lastRender = now;
          lastFPS = null;
          return;
        }

        if (now === lastRender) {
          return;
        }

        const calculatedFPS = 1000 / (now - lastRender);

        if (!Number.isFinite(calculatedFPS)) {
          return;
        }

        if (typeof lastFPS !== "number") {
          lastFPS = calculatedFPS;
        }

        const smoothing = 0.9;

        scratchFPS = Math.round(
          lastFPS * smoothing +
          calculatedFPS * (1 - smoothing)
        );

        lastFPS = scratchFPS;
        lastRender = now;
      } catch (e) {
        // FPS取得失敗は無視
      }
    };

    console.log("[Maru] Scratch FPS監視開始");
  }

  // =========================================================
  // ブラウザFPS
  // =========================================================

  let browserFrames = 0;
  let browserLastTime = performance.now();

  function browserFPSLoop(now) {
    browserFrames++;

    if (now - browserLastTime >= 1000) {
      browserFPS = browserFrames;
      browserFrames = 0;
      browserLastTime = now;
    }

    requestAnimationFrame(browserFPSLoop);
  }

  requestAnimationFrame(browserFPSLoop);

  // =========================================================
  // 右上パネル
  // =========================================================

  function createTopPanel() {
    let panel = document.getElementById("maru-addons-top-panel");

    if (!panel) {
      panel = document.createElement("div");

      panel.id = "maru-addons-top-panel";

      panel.innerHTML = `
        <div id="maru-addons-top-title">
          まる Addons v${MARU_ADDONS_VERSION}
        </div>
        <div id="maru-addons-browser-fps">
          ブラウザFPS: --
        </div>
      `;

      document.body.appendChild(panel);
    }

    return panel;
  }

  // =========================================================
  // Scratch FPS表示
  // =========================================================

  function createScratchFPS() {
    const stopButton = document.querySelector(
      'button[aria-label="Stop project"]'
    );

    if (!stopButton) {
      return;
    }

    let fpsElement = document.getElementById(
      "maru-addons-scratch-fps"
    );

    if (!fpsElement) {
      fpsElement = document.createElement("span");

      fpsElement.id = "maru-addons-scratch-fps";

      fpsElement.textContent = "Scratch FPS: --";
    }

    const parent = stopButton.parentElement;

    if (!parent) {
      return;
    }

    if (fpsElement.parentElement !== parent) {
      stopButton.insertAdjacentElement(
        "afterend",
        fpsElement
      );
    }
  }

  // =========================================================
  // ブロック数表示
  // =========================================================

  function createBlockCount() {
    const debugButton = document.querySelector(
      'button[aria-label="デバッグ"]'
    );

    if (!debugButton) {
      return;
    }

    let element = document.getElementById(
      "maru-addons-block-count"
    );

    if (!element) {
      element = document.createElement("span");

      element.id = "maru-addons-block-count";

      element.textContent = "ブロック数: --";
    }

    const parent = debugButton.parentElement;

    if (!parent) {
      return;
    }

    if (element.parentElement !== parent) {
      debugButton.insertAdjacentElement(
        "afterend",
        element
      );
    }
  }

  // =========================================================
  // CSRFトークン取得
  // =========================================================

  function getCSRFToken() {
    try {
      const match = document.cookie.match(
        /(?:^|;\s*)scratchcsrftoken=([^;]+)/
      );

      if (match) {
        return decodeURIComponent(match[1]);
      }

      const match2 = document.cookie.match(
        /(?:^|;\s*)csrftoken=([^;]+)/
      );

      if (match2) {
        return decodeURIComponent(match2[1]);
      }
    } catch (e) {
      console.warn("[Maru] CSRFトークン取得エラー:", e);
    }

    return null;
  }

  // =========================================================
  // プロジェクトID
  // =========================================================

  function getProjectId() {
    const match = location.pathname.match(
      /\/projects\/(\d+)/
    );

    return match ? match[1] : null;
  }

  // =========================================================
  // 共有ボタン取得
  // =========================================================

  function getShareButton() {
    return [...document.querySelectorAll("button")]
      .find(button => {
        const text = button.innerText.trim();

        return (
          text === "共有されたもの" ||
          text === "非共有"
        );
      }) || null;
  }

  // =========================================================
  // 非共有処理
  // =========================================================

  async function unshareProject(button) {
    if (unshareProcessing) {
      return;
    }

    const projectId = getProjectId();

    if (!projectId) {
      alert("プロジェクトIDを取得できませんでした。");
      return;
    }

    const confirmed = confirm(
      "このプロジェクトを非共有にしますか？\n\n" +
      "非共有にすると、Scratch上では他のユーザーから通常の方法で見られなくなります。"
    );

    if (!confirmed) {
      return;
    }

    const csrfToken = getCSRFToken();

    if (!csrfToken) {
      alert(
        "CSRFトークンを取得できませんでした。\n\n" +
        "Scratchへのログイン状態を確認してください。"
      );

      console.warn(
        "[Maru] CSRFトークンが取得できませんでした"
      );

      return;
    }

    unshareProcessing = true;

    const originalText = button.innerText;

    button.innerText = "非共有中...";
    button.disabled = true;

    console.log(
      "[Maru] 非共有開始:",
      projectId
    );

    try {
      const response = await fetch(
        `/site-api/projects/all/${projectId}/`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": csrfToken,
            "X-Requested-With": "XMLHttpRequest"
          },
          body: JSON.stringify({
            isPublished: false
          })
        }
      );

      console.log(
        "[Maru] 非共有API:",
        response.status
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      button.classList.remove(
        "maru-addons-unshare-button"
      );

      button.innerText = "共有";

      console.log(
        "[Maru] 非共有成功"
      );

      alert("プロジェクトを非共有にしました。");

    } catch (error) {
      console.error(
        "[Maru] 非共有エラー:",
        error
      );

      button.innerText = originalText;

      alert(
        "非共有に失敗しました。\n\n" +
        "Scratch側の仕様変更や認証状態が原因の可能性があります。\n" +
        "コンソールに詳細を表示しています。"
      );

    } finally {
      button.disabled = false;
      unshareProcessing = false;
    }
  }

  // =========================================================
  // 共有ボタンを非共有ボタン化
  // =========================================================

  function setupUnshareButton() {
    const button = getShareButton();

    if (!button) {
      return;
    }

    // 既に非共有化済み
    if (
      button.dataset.maruUnshareReady === "true"
    ) {
      return;
    }

    // Scratch側の「共有」状態だけを対象にする
    const className =
      typeof button.className === "string"
        ? button.className
        : "";

    const isShared =
      className.includes("share-button_share-button-is-shared");

    if (!isShared) {
      return;
    }

    button.dataset.maruUnshareReady = "true";

    button.classList.add(
      "maru-addons-unshare-button"
    );

    button.innerText = "非共有";

    button.addEventListener(
      "click",
      async function maruUnshareClick(event) {
        event.preventDefault();
        event.stopPropagation();

        await unshareProject(button);
      },
      true
    );

    console.log(
      "[Maru] 非共有ボタンを追加"
    );
  }

  // =========================================================
  // UI更新
  // =========================================================

  function updateUI() {
    // VM
    if (!vm) {
      vm = findVM();

      if (vm) {
        console.log("[Maru] VM FOUND!", vm);

        console.log(
          "[Maru] targets:",
          vm.runtime?.targets?.length
        );

        setupScratchFPS();
      }
    }

    // ブロック数
    if (vm) {
      blockCount = getBlockCount();
    }

    // 右上
    const panel = createTopPanel();

    const browserFPSElement =
      document.getElementById(
        "maru-addons-browser-fps"
      );

    if (browserFPSElement) {
      browserFPSElement.textContent =
        `ブラウザFPS: ${browserFPS}`;
    }

    // Scratch FPS
    const scratchFPSElement =
      document.getElementById(
        "maru-addons-scratch-fps"
      );

    if (scratchFPSElement) {
      scratchFPSElement.textContent =
        `Scratch FPS: ${scratchFPS}`;
    }

    // ブロック数
    const blockElement =
      document.getElementById(
        "maru-addons-block-count"
      );

    if (blockElement) {
      blockElement.textContent =
        `ブロック数: ${blockCount}`;
    }

    // UI再構築
    createScratchFPS();
    createBlockCount();
    setupUnshareButton();

    return panel;
  }

  // =========================================================
  // React再描画対策
  // =========================================================

  const observer = new MutationObserver(() => {
    createScratchFPS();
    createBlockCount();
    setupUnshareButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // =========================================================
  // 起動
  // =========================================================

  createTopPanel();

  setInterval(updateUI, 500);

  updateUI();

  console.log(
    `[Maru] まる Addons v${MARU_ADDONS_VERSION} 起動完了`
  );
})();
