(() => {
  if (window.__MARU_ADDONS__) {
    console.log("[まる Addons] すでに起動しています");
    return;
  }

  window.__MARU_ADDONS__ = true;

  // ==============================
  // VM取得
  // ==============================

  function findVM() {
    const el = document.querySelector('[class*="stage-wrapper"]');

    if (!el) return null;

    const entry = Object.entries(el).find(([key]) =>
      /Fiber/.test(key)
    );

    if (!entry) return null;

    let fiber = entry[1];

    while (fiber && !fiber.pendingProps?.vm) {
      fiber = fiber.return;
    }

    return fiber?.pendingProps?.vm || null;
  }

  const vm = findVM();

  if (!vm) {
    console.log("[まる Addons] VMを取得できませんでした");
    window.__MARU_ADDONS__ = false;
    return;
  }

  console.log("[まる Addons] VM FOUND!", vm);

  // ==============================
  // ブロック数
  // ==============================

  function getBlockCount() {
    let count = 0;

    const sprites = new Set(
      vm.runtime.targets
        .map(target => target.sprite?.blocks?._blocks)
        .filter(Boolean)
    );

    sprites.forEach(blocks => {
      count += Object.values(blocks)
        .filter(block => !block.shadow)
        .length;
    });

    return count;
  }

  // ==============================
  // ブラウザFPS
  // ==============================

  let browserFrames = 0;
  let browserFPS = 0;
  let lastBrowserTime = performance.now();

  function browserFrame(now) {
    browserFrames++;

    if (now - lastBrowserTime >= 1000) {
      browserFPS = browserFrames;
      browserFrames = 0;
      lastBrowserTime = now;
    }

    requestAnimationFrame(browserFrame);
  }

  requestAnimationFrame(browserFrame);

  // ==============================
  // Scratch FPS
  // ==============================

  let scratchFPS = 0;
  let lastRender = null;
  let lastFPS = null;

  const renderer = vm.runtime.renderer;

  if (renderer && !renderer.__MARU_ADDONS_PATCHED__) {
    renderer.__MARU_ADDONS_PATCHED__ = true;

    const originalDraw = renderer.draw;

    renderer.draw = function () {
      originalDraw.call(this);

      const now = vm.runtime.currentMSecs;

      if (typeof now !== "number") return;

      if (
        lastRender === null ||
        now - lastRender > 500
      ) {
        lastRender = now;
        lastFPS = null;
        return;
      }

      if (now === lastRender) return;

      const calculatedFPS =
        1000 / (now - lastRender);

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
    };
  }

  // ==============================
  // UI作成
  // ==============================

  const UI_ID = "maru-addons-inline-ui";

  function createUI() {
    if (document.getElementById(UI_ID)) {
      return document.getElementById(UI_ID);
    }

    const stopButton = document.querySelector(
      'button[aria-label="Stop project"]'
    );

    if (!stopButton) {
      return null;
    }

    const ui = document.createElement("div");

    ui.id = UI_ID;

    Object.assign(ui.style, {
      display: "flex",
      alignItems: "center",
      height: "100%",
      marginLeft: "8px",
      padding: "0 6px",
      fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      fontSize: "12px",
      fontWeight: "bold",
      color: "#575e75",
      whiteSpace: "nowrap",
      userSelect: "none",
      pointerEvents: "none"
    });

    ui.innerHTML = `
      <span
        id="maru-addons-fps"
        style="
          margin-right: 8px;
        "
      >
        FPS: --
      </span>

      <span
        id="maru-addons-blocks"
      >
        ブロック: --
      </span>
    `;

    // 停止ボタンの直後に挿入
    stopButton.insertAdjacentElement(
      "afterend",
      ui
    );

    console.log(
      "[まる Addons] Scratch UIへ追加しました"
    );

    return ui;
  }

  // ==============================
  // UI更新
  // ==============================

  function updateUI() {
    const ui = createUI();

    if (!ui) return;

    const fps = ui.querySelector(
      "#maru-addons-fps"
    );

    const blocks = ui.querySelector(
      "#maru-addons-blocks"
    );

    if (fps) {
      fps.textContent =
        `FPS: ${scratchFPS}`;
    }

    if (blocks) {
      blocks.textContent =
        `ブロック: ${getBlockCount()}`;
    }
  }

  // ==============================
  // ScratchのReact再描画対策
  // ==============================

  const observer = new MutationObserver(() => {
    if (!document.getElementById(UI_ID)) {
      createUI();
      updateUI();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // ==============================
  // 起動
  // ==============================

  createUI();
  updateUI();

  setInterval(updateUI, 500);

  console.log(
    "[まる Addons] 起動完了！"
  );
})();
