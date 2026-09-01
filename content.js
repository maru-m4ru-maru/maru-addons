(() => {
  if (window.__MARU_ADDONS__) {
    console.log("[まる Addons] すでに起動しています");
    return;
  }

  window.__MARU_ADDONS__ = true;

  function findVM() {
    const el = document.querySelector('[class*="stage-wrapper"]');
    if (!el) return null;

    const entry = Object.entries(el).find(([key]) => /Fiber/.test(key));
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

  // =========================
  // ブロック数
  // =========================

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

  // =========================
  // UI
  // =========================

  const panel = document.createElement("div");

  panel.id = "maru-addons-panel";

  Object.assign(panel.style, {
    position: "fixed",
    top: "8px",
    right: "8px",
    zIndex: "999999",
    padding: "6px 10px",
    background: "rgba(0, 0, 0, 0.75)",
    color: "#fff",
    borderRadius: "6px",
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: "12px",
    fontWeight: "bold",
    lineHeight: "1.5",
    pointerEvents: "none",
    userSelect: "none",
    backdropFilter: "blur(4px)"
  });

  document.body.appendChild(panel);

  // =========================
  // ブラウザFPS
  // =========================

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

  // =========================
  // Scratch FPS
  // =========================

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

      const calculatedFPS = 1000 / (now - lastRender);

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

  // =========================
  // 更新
  // =========================

  function update() {
    panel.innerHTML = `
      <div>まる Addons</div>
      <div>ブロック数　${getBlockCount()}</div>
      <div>ブラウザFPS　${browserFPS}</div>
      <div>Scratch FPS　${scratchFPS}</div>
    `;
  }

  update();

  setInterval(update, 500);

  console.log("[まる Addons] 起動完了！");
})();
