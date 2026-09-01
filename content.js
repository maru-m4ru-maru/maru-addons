(() => {
  if (window.__MARU_ADDONS_LOADED__) return;
  window.__MARU_ADDONS_LOADED__ = true;

  const badge = document.createElement("div");

  badge.textContent = "まる Addons 起動！";

  Object.assign(badge.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    zIndex: "999999",
    padding: "8px 12px",
    background: "#111",
    color: "#fff",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "Arial, sans-serif",
    boxShadow: "0 2px 10px rgba(0,0,0,.3)"
  });

  document.documentElement.appendChild(badge);

  console.log("[まる Addons] 起動しました！");
})();
