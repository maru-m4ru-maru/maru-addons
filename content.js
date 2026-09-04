(() => {
  const MARU_ADDONS_VERSION = "1.5.0";

  if (window.__MARU_ADDONS_LOADED__) {
    console.log("[Maru] まる Addons はすでに読み込まれています");
    return;
  }

  window.__MARU_ADDONS_LOADED__ = true;
  window.__MARU_ADDONS_VERSION__ = MARU_ADDONS_VERSION;

  console.log(`[Maru] まる Addons v${MARU_ADDONS_VERSION} 起動`);

  let vm = null;

  let browserFPS = 0;
  let scratchFPS = 0;
  let blockCount = 0;

  let browserFPSStarted = false;
  let scratchFPSTimer = null;
  let uiTimer = null;

  let sixtyFPSMode = false;
  let runtimePatchActive = false;
  let originalRuntimeStart = null;

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
        min-width: 130px;
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

    const stageWrapper =
      document.querySelector('[class*="stage-wrapper"]');

    if (!stageWrapper) return null;

    const fiberEntry =
      Object.entries(stageWrapper).find(([key]) =>
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
      console.log(
        "[Maru] targets:",
        vm.runtime?.targets?.length
      );
    }

    return vm;
  }

  function getBlockCount() {
    if (!vm?.runtime?.targets) return 0;

    let total = 0;

    for (const target of vm.runtime.targets) {
      const blocks = target?.blocks;

      if (!blocks) continue;

      if (
        blocks._blocks &&
        typeof blocks._blocks === "object"
      ) {
        total += Object.keys(blocks._blocks).length;
      } else if (
        typeof blocks.getAllBlocks === "function"
      ) {
        const allBlocks = blocks.getAllBlocks();

        if (Array.isArray(allBlocks)) {
          total += allBlocks.length;
        }
      }
    }

    return total;
  }

  function updateBlockCount() {
    blockCount = getBlockCount();

    const el =
      document.getElementById(BLOCK_COUNT_ID);

    if (el) {
      el.textContent =
        `ブロック数: ${blockCount}`;
    }
  }

  function setupBrowserFPS() {
    if (browserFPSStarted) return;

    browserFPSStarted = true;

    let frames = 0;
    let lastTime = performance.now();

    function frame(now) {
      frames++;

      const elapsed = now - lastTime;

      if (elapsed >= 1000) {
        browserFPS =
          Math.round((frames * 1000) / elapsed);

        frames = 0;
        lastTime = now;
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function setupScratchFPS() {
    if (!vm?.runtime) return;
    if (scratchFPSTimer) return;

    scratchFPSTimer = setInterval(() => {
      const runtime = vm?.runtime;

      if (!runtime) return;

      const interval =
        Number(runtime.currentStepTime);

      if (
        Number.isFinite(interval) &&
        interval > 0
      ) {
        scratchFPS =
          Math.round(1000 / interval);
      } else if (
        runtime._steppingInterval
      ) {
        scratchFPS =
          sixtyFPSMode ? 60 : 30;
      } else {
        scratchFPS = 0;
      }

      const el =
        document.getElementById(SCRATCH_FPS_ID);

      if (el) {
        el.textContent =
          `Scratch FPS: ${scratchFPS}`;
      }
    }, 500);
  }

  function createPanel() {
    let panel =
      document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;

      panel.innerHTML = `
        <div class="maru-title">
          まる Addons v${MARU_ADDONS_VERSION}
        </div>
        <div class="maru-line">
          Browser FPS:
          <span id="maru-browser-fps">0</span>
        </div>
      `;

      document.body.appendChild(panel);
    }

    const browserEl =
      panel.querySelector("#maru-browser-fps");

    if (browserEl) {
      browserEl.textContent =
        String(browserFPS);
    }
  }

  function setupScratchFPSUI() {
    const stopButton =
      document.querySelector(
        'button[aria-label="Stop project"]'
      );

    if (!stopButton) return;

    if (
      document.getElementById(
        SCRATCH_FPS_ID
      )
    ) {
      return;
    }

    const el = document.createElement("span");

    el.id = SCRATCH_FPS_ID;
    el.textContent = "Scratch FPS: 0";

    stopButton.insertAdjacentElement(
      "afterend",
      el
    );
  }

  function setupBlockCountUI() {
    const debugButton =
      document.querySelector(
        'button[aria-label="デバッグ"]'
      );

    if (!debugButton) return;

    if (
      document.getElementById(
        BLOCK_COUNT_ID
      )
    ) {
      return;
    }

    const el = document.createElement("span");

    el.id = BLOCK_COUNT_ID;
    el.textContent =
      `ブロック数: ${blockCount}`;

    debugButton.insertAdjacentElement(
      "afterend",
      el
    );
  }

  function updateUI() {
    const browserEl =
      document.querySelector(
        "#maru-browser-fps"
      );

    if (browserEl) {
      browserEl.textContent =
        String(browserFPS);
    }

    const button =
      document.querySelector(
        'button[aria-label="Start project"]'
      );

    if (button) {
      if (sixtyFPSMode) {
        button.classList.add(
          "maru-60fps-active"
        );
      } else {
        button.classList.remove(
          "maru-60fps-active"
        );
      }
    }
  }

  function enable60FPS() {
    if (!vm?.runtime) {
      console.warn(
        "[Maru] VMがまだありません"
      );

      showStatus(
        "VMが見つかりません"
      );

      return;
    }

    const runtime = vm.runtime;

    if (runtimePatchActive) {
      sixtyFPSMode = true;
      updateUI();
      return;
    }

    if (
      typeof runtime.start !==
      "function"
    ) {
      console.error(
        "[Maru] runtime.start がありません"
      );

      showStatus(
        "60FPSを開始できません"
      );

      return;
    }

    originalRuntimeStart =
      runtime.start.bind(runtime);

    runtime.start = function () {
      if (this._steppingInterval) {
        return;
      }

      const interval =
        1000 / 60;

      this.currentStepTime =
        interval;

      this._steppingInterval =
        setInterval(() => {
          this._step();
        }, interval);
    };

    runtimePatchActive = true;
    sixtyFPSMode = true;

    clearInterval(
      runtime._steppingInterval
    );

    runtime._steppingInterval = null;

    runtime.start();

    console.log(
      "[Maru] 60FPS ON"
    );

    showStatus(
      "まる Addons: 60FPS ON"
    );

    updateUI();
  }

  function disable60FPS() {
    if (!vm?.runtime) {
      sixtyFPSMode = false;
      updateUI();
      return;
    }

    const runtime = vm.runtime;

    sixtyFPSMode = false;

    clearInterval(
      runtime._steppingInterval
    );

    runtime._steppingInterval = null;

    if (
      runtimePatchActive &&
      originalRuntimeStart
    ) {
      runtime.start =
        originalRuntimeStart;
    }

    runtimePatchActive = false;
    originalRuntimeStart = null;

    try {
      runtime.start();
    } catch (error) {
      console.warn(
        "[Maru] 通常FPSへの復帰に失敗:",
        error
      );
    }

    console.log(
      "[Maru] 60FPS OFF"
    );

    showStatus(
      "まる Addons: 60FPS OFF"
    );

    updateUI();
  }

  function toggle60FPS() {
    if (sixtyFPSMode) {
      disable60FPS();
    } else {
      enable60FPS();
    }
  }

  function setup60FPSButton() {
    const button =
      document.querySelector(
        'button[aria-label="Start project"]'
      );

    if (!button) return;

    if (
      button.dataset.maru60fpsReady === "1"
    ) {
      return;
    }

    button.dataset.maru60fpsReady = "1";

    button.addEventListener(
      "click",
      event => {
        if (!event.altKey) return;

        event.preventDefault();
        event.stopPropagation();

        console.log(
          "[Maru] Alt+クリック検出"
        );

        toggle60FPS();
      },
      true
    );

    console.log(
      "[Maru] Alt+クリックで60FPS切替を設定しました"
    );
  }

  function getProjectId() {
    const match =
      location.pathname.match(
        /\/projects\/(\d+)/
      );

    return match ? match[1] : null;
  }

  function getCSRFToken() {
    const cookies =
      document.cookie.split(";");

    for (const cookie of cookies) {
      const trimmed = cookie.trim();

      const separator =
        trimmed.indexOf("=");

      if (separator === -1) {
        continue;
      }

      const name =
        trimmed.slice(0, separator);

      const value =
        trimmed.slice(separator + 1);

      if (
        name === "scratchcsrftoken" ||
        name === "csrftoken"
      ) {
        return decodeURIComponent(value);
      }
    }

    return "";
  }

  async function unshareProject() {
    if (unshareProcessing) return;

    const projectId =
      getProjectId();

    if (!projectId) {
      alert(
        "プロジェクトIDを取得できませんでした。"
      );

      return;
    }

    const confirmed =
      confirm(
        "このプロジェクトの共有を解除しますか？\n\n共有解除すると、他のユーザーから見えなくなります。"
      );

    if (!confirmed) return;

    unshareProcessing = true;

    try {
      const csrfToken =
        getCSRFToken();

      const response =
        await fetch(
          `/site-api/projects/all/${projectId}/`,
          {
            method: "PUT",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/json",

              "X-CSRFToken":
                csrfToken,

              "X-Requested-With":
                "XMLHttpRequest"
            },
            body: JSON.stringify({
              isPublished: false
            })
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      alert(
        "共有を解除しました！"
      );

      updateUnshareButton();

    } catch (error) {
      console.error(
        "[Maru] 共有解除エラー:",
        error
      );

      alert(
        "共有解除に失敗しました。\n\n" +
        error.message
      );

    } finally {
      unshareProcessing = false;
    }
  }

  function setupUnshareButton() {
    const button =
      [...document.querySelectorAll("button")]
        .find(
          el =>
            el.getAttribute("aria-label") ===
              null &&
            el.textContent.trim() ===
              "共有されたもの"
        );

    if (!button) return;

    if (
      button.dataset.maruUnshareReady ===
      "1"
    ) {
      return;
    }

    const span =
      button.querySelector("span");

    if (span) {
      span.textContent = "非共有";
    } else {
      button.childNodes.forEach(node => {
        if (
          node.nodeType ===
          Node.TEXT_NODE
        ) {
          node.textContent = "非共有";
        }
      });
    }

    button.classList.add(
      "maru-unshare-button"
    );

    button.dataset.maruUnshareReady =
      "1";

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        unshareProject();
      },
      true
    );

    console.log(
      "[Maru] 非共有ボタンを設定しました"
    );
  }

  function updateUnshareButton() {
    const button =
      [...document.querySelectorAll("button")]
        .find(
          el =>
            el.textContent.trim() ===
            "共有されたもの"
        );

    if (!button) return;

    const span =
      button.querySelector("span");

    if (span) {
      span.textContent = "共有";
    } else {
      button.childNodes.forEach(node => {
        if (
          node.nodeType ===
          Node.TEXT_NODE
        ) {
          node.textContent = "共有";
        }
      });
    }

    button.classList.add(
      "maru-unshare-button"
    );
  }


  // =========================
  // Scratch ファイルドラッグ&ドロップ
  // =========================
  const DROP_UPLOADER_ID = "maru-addons-drop-overlay";
  let dropDragDepth = 0;

  function isSpriteFile(file) {
    return /\.sprite3$/i.test(file.name);
  }

  function isCostumeFile(file) {
    return (
      /^image\/(png|jpeg|jpg|gif|svg\+xml|webp|bmp)$/i.test(file.type) ||
      /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(file.name)
    );
  }

  function makeFileList(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt.files;
  }

  function getFileInputs() {
    return [...document.querySelectorAll('input[type="file"]')];
  }

  function findSpriteInput() {
    const inputs = getFileInputs();

    let input = inputs.find(i => /sprite3/i.test(i.accept || ""));
    if (input) return input;

    input = inputs.find(i => /(zip|scratch)/i.test(i.accept || ""));
    return input || null;
  }

  function findCostumeInput() {
    const inputs = getFileInputs();

    let input = inputs.find(i =>
      /image|png|jpe?g|gif|svg|webp|bmp/i.test(i.accept || "")
    );
    if (input) return input;

    input = inputs.find(i => {
      const accept = i.accept || "";
      return accept === "" && i.multiple === false;
    });

    return input || null;
  }

  function injectDropFile(input, file) {
    if (!input) {
      throw new Error("Scratchのファイル入力欄が見つかりません。");
    }

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files"
    )?.set;

    if (!setter) {
      throw new Error("ブラウザが input.files の設定に対応していません。");
    }

    setter.call(input, makeFileList(file));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitForDropInput(type, timeout = 1500) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const input =
        type === "sprite" ? findSpriteInput() : findCostumeInput();

      if (input) return input;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return null;
  }

  async function handleDroppedFiles(files) {
    for (const file of files) {
      try {
        if (isSpriteFile(file)) {
          console.log("[Maru] 🧩 Sprite3検出:", file.name);

          let input = findSpriteInput();
          if (!input) input = await waitForDropInput("sprite");

          if (!input) {
            console.error("[Maru] スプライト用のファイル入力欄が見つかりませんでした。", file);
            continue;
          }

          injectDropFile(input, file);
          console.log("[Maru] ✓ スプライトをScratchへ渡しました:", file.name);
        } else if (isCostumeFile(file)) {
          console.log("[Maru] 🖼️ コスチューム検出:", file.name);

          let input = findCostumeInput();
          if (!input) input = await waitForDropInput("costume");

          if (!input) {
            console.error("[Maru] コスチューム用のファイル入力欄が見つかりませんでした。", file);
            continue;
          }

          injectDropFile(input, file);
          console.log("[Maru] ✓ コスチュームをScratchへ渡しました:", file.name);
        } else {
          console.warn("[Maru] ⚠️ 対応していないファイルです:", file.name, file.type);
        }
      } catch (error) {
        console.error("[Maru] ☓ ドロップ処理エラー:", error);
      }
    }
  }

  function getDropOverlay() {
    let overlay = document.getElementById(DROP_UPLOADER_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = DROP_UPLOADER_ID;
    overlay.textContent =
      "📁 ファイルをここにドロップ\n\n画像 → コスチューム\n.sprite3 → スプライト";

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "20px",
      zIndex: "2147483647",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      whiteSpace: "pre-line",
      fontSize: "28px",
      fontWeight: "700",
      color: "#fff",
      background: "rgba(0,0,0,.55)",
      border: "4px dashed rgba(255,255,255,.8)",
      borderRadius: "20px",
      backdropFilter: "blur(6px)",
      pointerEvents: "none"
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function showDropOverlay() {
    const overlay = getDropOverlay();
    overlay.style.display = "flex";
  }

  function hideDropOverlay() {
    const overlay = document.getElementById(DROP_UPLOADER_ID);
    if (overlay) overlay.style.display = "none";
  }

  function onDropDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    dropDragDepth++;
    showDropOverlay();
  }

  function onDropDragOver(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }

    showDropOverlay();
  }

  function onDropDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();

    dropDragDepth--;

    if (dropDragDepth <= 0) {
      dropDragDepth = 0;
      hideDropOverlay();
    }
  }

  async function onDropFile(event) {
    event.preventDefault();
    event.stopPropagation();

    dropDragDepth = 0;
    hideDropOverlay();

    const files = [...(event.dataTransfer?.files || [])];

    if (!files.length) {
      console.warn("[Maru] ⚠️ ドロップされたファイルを取得できませんでした。");
      return;
    }

    await handleDroppedFiles(files);
  }

  function setupDropUploader() {
    getDropOverlay();

    if (window.__MARU_ADDONS_DROP_UPLOADER__) return;

    window.addEventListener("dragenter", onDropDragEnter, true);
    window.addEventListener("dragover", onDropDragOver, true);
    window.addEventListener("dragleave", onDropDragLeave, true);
    window.addEventListener("drop", onDropFile, true);

    window.__MARU_ADDONS_DROP_UPLOADER__ = true;

    console.log("[Maru] ✓ ファイルドラッグ&ドロップを有効化しました");
  }

  function cleanupDropUploader() {
    window.removeEventListener("dragenter", onDropDragEnter, true);
    window.removeEventListener("dragover", onDropDragOver, true);
    window.removeEventListener("dragleave", onDropDragLeave, true);
    window.removeEventListener("drop", onDropFile, true);

    document.getElementById(DROP_UPLOADER_ID)?.remove();

    dropDragDepth = 0;
    delete window.__MARU_ADDONS_DROP_UPLOADER__;
  }

  function setupAllUI() {
    injectStyle();

    findVM();

    setupBrowserFPS();
    setupScratchFPSUI();
    setupBlockCountUI();
    createPanel();
    setup60FPSButton();
    setupUnshareButton();
    setupDropUploader();

    if (vm) {
      setupScratchFPS();
      updateBlockCount();
    }

    updateUI();
  }

  function start() {
    setupAllUI();

    uiTimer = setInterval(() => {
      setupAllUI();
    }, 700);

    window.__MARU_ADDONS_CLEANUP__ = () => {
      clearInterval(uiTimer);
      clearInterval(scratchFPSTimer);

      if (
        sixtyFPSMode &&
        vm?.runtime
      ) {
        disable60FPS();
      }

      document
        .getElementById(PANEL_ID)
        ?.remove();

      document
        .getElementById(SCRATCH_FPS_ID)
        ?.remove();

      document
        .getElementById(BLOCK_COUNT_ID)
        ?.remove();

      document
        .getElementById(SIXTY_STATUS_ID)
        ?.remove();

      cleanupDropUploader();

      window.__MARU_ADDONS_LOADED__ =
        false;

      console.log(
        "[Maru] クリーンアップしました"
      );
    };

    console.log(
      `[Maru] v${MARU_ADDONS_VERSION} 起動完了`
    );
  }

  start();
})();
