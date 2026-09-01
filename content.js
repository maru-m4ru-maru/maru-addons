(() => {
  const MARU_ADDONS_VERSION = "1.4.1";

  if (window.__MARU_ADDONS_LOADED__) {
    console.log("[Maru] まる Addons はすでに読み込まれています");
    return;
  }
  window.__MARU_ADDONS_LOADED__ = true;
  window.__MARU_ADDONS_VERSION__ = MARU_ADDONS_VERSION;

  console.log(`[Maru] まる Addons v${MARU_ADDONS_VERSION} 起動`);

  let vm = null;

  let scratchFPS = 0;
  let browserFPS = 0;
  let blockCount = 0;

  let scratchFPSTimer = null;
  let browserFPSTimer = null;
  let uiTimer = null;

  let sixtyFPSMode = false;
  let globalFPS = 30;
  let runtimePatched = false;

  let unshareProcessing = false;

  const STYLE_ID = "maru-addons-style";
  const PANEL_ID = "maru-addons-panel";
  const SCRATCH_FPS_ID = "maru-addons-scratch-fps";
  const BLOCK_COUNT_ID = "maru-addons-block-count";
  const SIXTY_STATUS_ID = "maru-addons-60fps-status";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 82px;
        right: 18px;
        z-index: 999999;
        background: rgba(30, 30, 30, 0.94);
        color: white;
        border-radius: 10px;
        padding: 10px 13px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        user-select: none;
        pointer-events: none;
        min-width: 135px;
      }

      #${PANEL_ID} .maru-title {
        font-weight: 700;
        margin-bottom: 4px;
      }

      #${PANEL_ID} .maru-line {
        opacity: .92;
      }

      #${SCRATCH_FPS_ID} {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        padding: 3px 7px;
        border-radius: 6px;
        background: rgba(95, 180, 255, .16);
        color: #68c0ff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
        white-space: nowrap;
        transform: translateY(2px);
      }

      #${BLOCK_COUNT_ID} {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        padding: 3px 7px;
        border-radius: 6px;
        background: rgba(110, 190, 255, .15);
        color: #68c0ff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
        white-space: nowrap;
      }

      #${SIXTY_STATUS_ID} {
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 999999;
        padding: 8px 11px;
        border-radius: 8px;
        background: rgba(30,30,30,.94);
        color: white;
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 4px 14px rgba(0,0,0,.2);
        pointer-events: none;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity .15s ease, transform .15s ease;
      }

      #${SIXTY_STATUS_ID}.show {
        opacity: 1;
        transform: translateY(0);
      }

      .maru-60fps-active {
        outline: 3px solid #58a6ff !important;
        outline-offset: 2px;
        border-radius: 7px;
      }

      .maru-unshare-button {
        color: #e66 !important;
      }
    `;

    document.head.appendChild(style);
  }

  function showStatus(text, duration = 1600) {
    let box = document.getElementById(SIXTY_STATUS_ID);

    if (!box) {
      box = document.createElement("div");
      box.id = SIXTY_STATUS_ID;
      document.body.appendChild(box);
    }

    box.textContent = text;
    box.classList.add("show");

    clearTimeout(box.__hideTimer);

    box.__hideTimer = setTimeout(() => {
      box.classList.remove("show");
    }, duration);
  }

  function findVM() {
    if (vm?.runtime) return vm;

    const stageWrapper = document.querySelector('[class*="stage-wrapper"]');

    if (!stageWrapper) return null;

    const fiberEntry = Object.entries(stageWrapper).find(([key]) =>
      /Fiber/.test(key)
    );

    if (!fiberEntry) return null;

    let fiber = fiberEntry[1];

    while (fiber && !fiber.pendingProps?.vm) {
      fiber = fiber.return;
    }

    const foundVM = fiber?.pendingProps?.vm || null;

    if (foundVM?.runtime) {
      vm = foundVM;
      console.log("[Maru] VM FOUND!", vm);
      console.log("[Maru] targets:", vm.runtime?.targets?.length);
    }

    return vm;
  }

  function getBlockCount() {
    if (!vm?.runtime?.targets) return 0;

    let total = 0;

    for (const target of vm.runtime.targets) {
      const blocks = target?.blocks;

      if (!blocks) continue;

      if (blocks._blocks && typeof blocks._blocks === "object") {
        total += Object.keys(blocks._blocks).length;
      } else if (typeof blocks.getAllBlocks === "function") {
        const allBlocks = blocks.getAllBlocks();
        total += Array.isArray(allBlocks) ? allBlocks.length : 0;
      }
    }

    return total;
  }

  function updateBlockCount() {
    const count = getBlockCount();

    if (count === blockCount) return;

    blockCount = count;

    const el = document.getElementById(BLOCK_COUNT_ID);

    if (el) {
      el.textContent = `ブロック数: ${blockCount}`;
    }
  }

  function setupBrowserFPS() {
    if (browserFPSTimer) return;

    let frames = 0;
    let lastTime = performance.now();

    function frame(now) {
      frames++;

      if (now - lastTime >= 1000) {
        browserFPS = frames;
        frames = 0;
        lastTime = now;
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    browserFPSTimer = true;
  }

  function setupScratchFPS() {
    if (!vm?.runtime || scratchFPSTimer) return;

    let steps = 0;
    let lastTime = performance.now();

    const originalStep = vm.runtime._step;

    if (typeof originalStep !== "function") {
      console.warn("[Maru] runtime._step が見つかりません");
      return;
    }

    if (!vm.runtime.__maruStepWrapped) {
      vm.runtime._step = function (...args) {
        steps++;

        return originalStep.apply(this, args);
      };

      vm.runtime.__maruStepWrapped = true;
    }

    scratchFPSTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTime;

      if (elapsed <= 0) return;

      scratchFPS = Math.round((steps * 1000) / elapsed);

      steps = 0;
      lastTime = now;
    }, 500);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;

      panel.innerHTML = `
        <div class="maru-title">まる Addons v${MARU_ADDONS_VERSION}</div>
        <div class="maru-line">Browser FPS: <span id="maru-browser-fps">0</span></div>
        <div class="maru-line">Scratch FPS: <span id="maru-panel-scratch-fps">0</span></div>
        <div class="maru-line">60FPS: <span id="maru-panel-60fps">OFF</span></div>
      `;

      document.body.appendChild(panel);
    }

    const browserEl = panel.querySelector("#maru-browser-fps");
    const scratchEl = panel.querySelector("#maru-panel-scratch-fps");
    const sixtyEl = panel.querySelector("#maru-panel-60fps");

    if (browserEl) browserEl.textContent = String(browserFPS);
    if (scratchEl) scratchEl.textContent = String(scratchFPS);
    if (sixtyEl) sixtyEl.textContent = sixtyFPSMode ? "ON" : "OFF";
  }

  function setupScratchFPSUI() {
    const stopButton = document.querySelector('button[aria-label="Stop project"]');

    if (!stopButton) return;

    if (document.getElementById(SCRATCH_FPS_ID)) return;

    const el = document.createElement("span");
    el.id = SCRATCH_FPS_ID;
    el.textContent = "Scratch FPS: 0";

    stopButton.insertAdjacentElement("afterend", el);
  }

  function setupBlockCountUI() {
    const debugButton = document.querySelector('button[aria-label="デバッグ"]');

    if (!debugButton) return;

    if (document.getElementById(BLOCK_COUNT_ID)) return;

    const el = document.createElement("span");
    el.id = BLOCK_COUNT_ID;
    el.textContent = `ブロック数: ${blockCount}`;

    debugButton.insertAdjacentElement("afterend", el);
  }

  function updateUI() {
    const scratchEl = document.getElementById(SCRATCH_FPS_ID);

    if (scratchEl) {
      scratchEl.textContent = `Scratch FPS: ${scratchFPS}`;
    }

    const blockEl = document.getElementById(BLOCK_COUNT_ID);

    if (blockEl) {
      blockEl.textContent = `ブロック数: ${blockCount}`;
    }

    const panel = document.getElementById(PANEL_ID);

    if (panel) {
      const browserEl = panel.querySelector("#maru-browser-fps");
      const scratchPanelEl = panel.querySelector("#maru-panel-scratch-fps");
      const sixtyEl = panel.querySelector("#maru-panel-60fps");

      if (browserEl) browserEl.textContent = String(browserFPS);
      if (scratchPanelEl) scratchPanelEl.textContent = String(scratchFPS);
      if (sixtyEl) sixtyEl.textContent = sixtyFPSMode ? "ON" : "OFF";
    }
  }

  function patchRuntime() {
    if (!vm?.runtime || runtimePatched) return;

    const runtime = vm.runtime;

    if (typeof runtime.start !== "function") {
      console.warn("[Maru] runtime.start が見つかりません");
      return;
    }

    if (runtime.__maruOriginalStart) {
      runtimePatched = true;
      return;
    }

    runtime.__maruOriginalStart = runtime.start.bind(runtime);

    runtime.start = function () {
      if (this._steppingInterval) return;

      const fps = Math.max(1, Number(globalFPS) || 30);
      const interval = 1000 / fps;

      this.currentStepTime = interval;

      this._steppingInterval = setInterval(() => {
        this._step();
      }, interval);

      this.emit("RUNTIME_STARTED");
    };

    runtimePatched = true;

    console.log("[Maru] runtime.start を安全モードで設定しました");
  }

  function setFPS(fps) {
    if (!vm?.runtime) return;

    const runtime = vm.runtime;

    const parsed = Number(fps);

    if (!Number.isFinite(parsed)) {
      globalFPS = 30;
    } else {
      globalFPS = Math.max(30, Math.min(240, Math.round(parsed)));
    }

    clearInterval(runtime._steppingInterval);
    runtime._steppingInterval = null;

    runtime.start();
  }

  function set60FPSMode(enabled) {
    if (!vm?.runtime) {
      console.warn("[Maru] VMがまだ見つかりません");
      return;
    }

    sixtyFPSMode = Boolean(enabled);

    if (sixtyFPSMode) {
      setFPS(60);
      showStatus("まる Addons: 60FPS ON");
    } else {
      setFPS(30);
      showStatus("まる Addons: 60FPS OFF");
    }

    update60FPSButtonState();
    updateUI();
  }

  function toggle60FPS() {
    set60FPSMode(!sixtyFPSMode);
  }

  function update60FPSButtonState() {
    const button = document.querySelector('button[aria-label="Start project"]');

    if (!button) return;

    if (sixtyFPSMode) {
      button.classList.add("maru-60fps-active");
    } else {
      button.classList.remove("maru-60fps-active");
    }
  }

  function setup60FPSButton() {
    const button = document.querySelector('button[aria-label="Start project"]');

    if (!button) return;

    if (button.dataset.maru60fpsReady === "1") return;

    button.dataset.maru60fpsReady = "1";

    const isChromebook = navigator.userAgent.includes("CrOS");

    const flagListener = (event) => {
      if (isChromebook && event.type === "contextmenu") {
        event.preventDefault();
        event.stopPropagation();

        toggle60FPS();
        return;
      }

      if (event.type === "click" && event.altKey) {
        event.preventDefault();
        event.stopPropagation();

        toggle60FPS();
      }
    };

    button.addEventListener("click", flagListener, true);
    button.addEventListener("contextmenu", flagListener, true);

    console.log(
      `[Maru] 60FPS操作を設定しました (${isChromebook ? "Chromebook" : "通常環境"})`
    );
  }

  function getProjectId() {
    const match = location.pathname.match(/\/projects\/(\d+)/);

    return match ? match[1] : null;
  }

  function getCSRFToken() {
    const cookies = document.cookie.split(";");

    for (const cookie of cookies) {
      const trimmed = cookie.trim();

      const parts = trimmed.split("=");

      if (parts.length < 2) continue;

      const name = parts.shift();
      const value = parts.join("=");

      if (name === "scratchcsrftoken" || name === "csrftoken") {
        return decodeURIComponent(value);
      }
    }

    return "";
  }

  async function unshareProject() {
    if (unshareProcessing) return;

    const projectId = getProjectId();

    if (!projectId) {
      alert("プロジェクトIDを取得できませんでした。");
      return;
    }

    const confirmed = confirm(
      "このプロジェクトの共有を解除しますか？\n\n共有解除すると、他のユーザーから見えなくなります。"
    );

    if (!confirmed) return;

    unshareProcessing = true;

    try {
      const csrfToken = getCSRFToken();

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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      alert("共有を解除しました！");

      updateUnshareButton();

    } catch (error) {
      console.error("[Maru] 共有解除エラー:", error);
      alert("共有解除に失敗しました。\n\n" + error.message);
    } finally {
      unshareProcessing = false;
    }
  }

  function updateUnshareButton() {
    const button = [...document.querySelectorAll("button")].find(
      (el) => el.textContent.trim() === "共有されたもの"
    );

    if (!button) return;

    const span = button.querySelector("span");

    if (span) {
      span.textContent = "共有";
    } else {
      button.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = "共有";
        }
      });
    }

    button.classList.add("maru-unshare-button");

    if (button.dataset.maruUnshareReady === "1") return;

    button.dataset.maruUnshareReady = "1";

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      unshareProject();
    }, true);
  }

  function setupUnshareButton() {
    const button = [...document.querySelectorAll("button")].find(
      (el) =>
        el.getAttribute("aria-label") === null &&
        el.textContent.trim() === "共有されたもの"
    );

    if (!button) return;

    if (button.dataset.maruUnshareReady === "1") return;

    const span = button.querySelector("span");

    if (span) {
      span.textContent = "非共有";
    } else {
      button.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = "非共有";
        }
      });
    }

    button.classList.add("maru-unshare-button");

    button.dataset.maruUnshareReady = "1";

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      unshareProject();
    }, true);

    console.log("[Maru] 非共有ボタンを設定しました");
  }

  function setupAllUI() {
    injectStyle();

    findVM();

    if (!vm) return;

    patchRuntime();

    setupScratchFPS();
    setupBrowserFPS();

    setupScratchFPSUI();
    setupBlockCountUI();

    createPanel();

    setup60FPSButton();
    setupUnshareButton();

    updateBlockCount();
    update60FPSButtonState();
    updateUI();
  }

  function start() {
    setupAllUI();

    uiTimer = setInterval(() => {
      findVM();

      if (vm) {
        patchRuntime();
        setupScratchFPS();
        setupScratchFPSUI();
        setupBlockCountUI();
        setup60FPSButton();
        setupUnshareButton();

        updateBlockCount();
        update60FPSButtonState();
        createPanel();
        updateUI();
      }
    }, 700);

    const observer = new MutationObserver(() => {
      setupAllUI();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.__MARU_ADDONS_CLEANUP__ = () => {
      clearInterval(scratchFPSTimer);
      clearInterval(uiTimer);

      const runtime = vm?.runtime;

      if (runtime?._steppingInterval) {
        clearInterval(runtime._steppingInterval);
        runtime._steppingInterval = null;
      }

      if (runtime?.__maruOriginalStart) {
        runtime.start = runtime.__maruOriginalStart;
        delete runtime.__maruOriginalStart;
      }

      if (runtime?.__maruStepWrapped) {
        console.warn("[Maru] _step は安全のためこのページでは復元しません");
      }

      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(SCRATCH_FPS_ID)?.remove();
      document.getElementById(BLOCK_COUNT_ID)?.remove();
      document.getElementById(SIXTY_STATUS_ID)?.remove();

      window.__MARU_ADDONS_LOADED__ = false;

      console.log("[Maru] クリーンアップしました");
    };

    console.log(`[Maru] v${MARU_ADDONS_VERSION} 起動完了`);
  }

  start();
})();
