// goat.js — carga GoatCounter una sola vez
(() => {
  if (window.__goatcounter_loaded) return;
  window.__goatcounter_loaded = true;

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://airsoto.goatcounter.com/count");
  document.head.appendChild(s);
})();
