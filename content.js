(() => {
  // ==============================
  // まる Addons バージョン
  // ==============================

  const MARU_ADDONS_VERSION = "1.1.1";

  // ==============================
  // 二重起動防止
  // ==============================

  if (window.__MARU_ADDONS__) {
    console.log(
      `[まる Addons] v${MARU_ADDONS_VERSION} はすでに起動しています`
    );
    return;
  }

  window.__MARU_ADDONS__ = true;

  // ==============================
  // VM取得
  // ==============================

  function findVM() {
    const el = document.querySelector(
      '[class*="stage-wrapper"]'
    );

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
    console.log(
      `[まる Addons] v${MARU_ADDONS_VERSION}: VMを取得できませんでした`
    );

    window.__MARU_ADDONS__ = false;
    return;
  }

  console.log(
    `[まる Addons] v${MARU_ADDONS_VERSION} VM FOUND!`,
    vm
  );

  // ==============================
  // ブロック数
  // ==============================

  function getBlockCount() {
    let count = 0;

    const sprites = new Set(
      vm.runtime.targets
        .map(target =>
          target.sprite?.blocks?._blocks
        )
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

  if (
    renderer &&
    !renderer.__MARU_ADDONS_PATCHED__
  ) {
    renderer.__MARU_ADDONS_PATCHED__ = true;

    const originalDraw = renderer.draw;

    renderer.draw = function () {
      originalDraw.call(this);

      const now =
        vm.runtime.currentMSecs;

      if (typeof now !== "number") {
        return;
      }

      if (
        lastRender === null ||
        now - lastRender > 500
      ) {
        lastRender = now;
        lastFPS = null;
        return;
      }

      if (now === lastRender) {
        return;
      }

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
  // 共通スタイル
  // ==============================

  const baseStyle = {
    display: "flex",
    alignItems: "center",
    height: "100%",
    fontFamily:
      '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: "12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none"
  };

  // ==============================
  // Scratch FPS
  // 停止ボタンの右
  // ==============================

  const SCRATCH_FPS_ID =
    "maru-addons-scratch-fps";

  function createScratchFPS() {
    if (
      document.getElementById(
        SCRATCH_FPS_ID
      )
    ) {
      return document.getElementById(
        SCRATCH_FPS_ID
      );
    }

    const stopButton =
      document.querySelector(
        'button[aria-label="Stop project"]'
      );

    if (!stopButton) {
      return null;
    }

    const element =
      document.createElement("div");

    element.id = SCRATCH_FPS_ID;

    Object.assign(
      element.style,
      baseStyle,
      {
        marginLeft: "8px",
        padding: "0 4px",
        color: "#4CBFE6"
      }
    );

    element.textContent =
      "Scratch FPS: --";

    stopButton.insertAdjacentElement(
      "afterend",
      element
    );

    return element;
  }

  // ==============================
  // まる Addons + ブラウザFPS
  // 右上
  // ==============================

  const TOP_PANEL_ID =
    "maru-addons-panel";

  function createTopPanel() {
    if (
      document.getElementById(
        TOP_PANEL_ID
      )
    ) {
      return document.getElementById(
        TOP_PANEL_ID
      );
    }

    const panel =
      document.createElement("div");

    panel.id = TOP_PANEL_ID;

    Object.assign(
      panel.style,
      {
        position: "fixed",
        top: "8px",
        right: "8px",
        zIndex: "999999",
        padding: "6px 10px",
        background:
          "rgba(0, 0, 0, 0.75)",
        color: "#fff",
        borderRadius: "6px",
        fontFamily:
          '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: "12px",
        fontWeight: "bold",
        lineHeight: "1.5",
        pointerEvents: "none",
        userSelect: "none",
        backdropFilter:
          "blur(4px)"
      }
    );

    document.body.appendChild(panel);

    return panel;
  }

  // ==============================
  // ブロック数
  // デバッグの右
  // ==============================

  const BLOCKS_ID =
    "maru-addons-block-count";

  function createBlockCount() {
    if (
      document.getElementById(
        BLOCKS_ID
      )
    ) {
      return document.getElementById(
        BLOCKS_ID
      );
    }

    const debugButton =
      document.querySelector(
        'button[aria-label="デバッグ"]'
      );

    if (!debugButton) {
      return null;
    }

    const element =
      document.createElement("div");

    element.id = BLOCKS_ID;

    Object.assign(
      element.style,
      baseStyle,
      {
        marginLeft: "8px",
        padding: "0 4px",
        color: "#575E75"
      }
    );

    element.textContent =
      "ブロック: --";

    debugButton.insertAdjacentElement(
      "afterend",
      element
    );

    return element;
  }

  // ==============================
  // 更新
  // ==============================

  function updateUI() {
    // Scratch FPS
    const scratchElement =
      createScratchFPS();

    if (scratchElement) {
      scratchElement.textContent =
        `Scratch FPS: ${scratchFPS}`;
    }

    // 右上
    const panel =
      createTopPanel();

    if (panel) {
      panel.innerHTML = `
        <div>
          まる Addons v${MARU_ADDONS_VERSION}
        </div>
        <div>
          ブラウザFPS　${browserFPS}
        </div>
      `;
    }

    // ブロック数
    const blockElement =
      createBlockCount();

    if (blockElement) {
      blockElement.textContent =
        `ブロック: ${getBlockCount()}`;
    }
  }

  // ==============================
  // React再描画対策
  // ==============================

  const observer =
    new MutationObserver(() => {
      if (
        !document.getElementById(
          SCRATCH_FPS_ID
        )
      ) {
        createScratchFPS();
      }

      if (
        !document.getElementById(
          BLOCKS_ID
        )
      ) {
        createBlockCount();
      }
    });

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true
    }
  );

  // ==============================
  // 起動
  // ==============================

  createScratchFPS();
  createTopPanel();
  createBlockCount();

  updateUI();

  setInterval(
    updateUI,
    500
  );

  console.log(
    `[まる Addons] v${MARU_ADDONS_VERSION} 起動完了！`
  );
})();
