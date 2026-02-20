// goat.js — carga GoatCounter una sola vez y pinta el contador de visitas
(() => {
  if (window.__goatcounter_loaded) return;
  window.__goatcounter_loaded = true;

  // 1) Cargar count.js
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://airsoto.goatcounter.com/count");
  document.head.appendChild(s);

  // 2) Cuando GoatCounter esté listo, insertar el visit counter
  const target = "#gc-visitcount"; // tu div

  const t = setInterval(() => {
    if (window.goatcounter && window.goatcounter.visit_count) {
      clearInterval(t);

      // Evita duplicarlo si recargas o si lo llamas más de una vez
      const el = document.querySelector(target);
      if (!el || el.dataset.gcRendered === "1") return;
      el.dataset.gcRendered = "1";

      window.goatcounter.visit_count({
        append: target,
        type: "html",
        no_branding: true,
        style: `
          div { border-color:#fff; background:#111; color:#fff; }
          #gcvc-for { opacity:0.8; }
          #gcvc-views { font-weight:700; }
        `
      });
    }
  }, 100);
})();
