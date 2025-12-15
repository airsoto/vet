/* IMDB Finder (vanilla)
   - Carga json/imdb.json
   - Normaliza datos una vez
   - Búsqueda con debounce, filtros, orden, paginación
   - Modal accesible + cierre con ESC + trap de foco simple
   - Highlight seguro: escapeHTML + marcado con <mark> sobre texto escapado
*/

"use strict";

/* ------------------------- Estado global ------------------------- */
const state = {
  loading: true,
  error: "",
  all: [],          // datos normalizados
  filtered: [],     // tras filtros + búsqueda
  pageItems: [],    // items de la página actual
  q: "",
  selectedGenres: new Set(),
  cert: "",
  yearMin: null,
  yearMax: null,
  ratingMin: 0,
  metaMin: 0,
  runtimeMax: 400,
  sort: "imdb_desc",
  page: 1,
  perPage: 24,

  // límites derivados del dataset
  bounds: {
    yearMin: 1900,
    yearMax: 2100,
    runtimeMax: 400,
  }
};

let lastFocusedEl = null;

/* ------------------------- Elementos DOM ------------------------- */
const el = {
  statusBadge: document.getElementById("statusBadge"),
  resultCount: document.getElementById("resultCount"),
  totalCount: document.getElementById("totalCount"),

  toggleFiltersBtn: document.getElementById("toggleFiltersBtn"),
  filtersPanel: document.getElementById("filtersPanel"),

  searchInput: document.getElementById("searchInput"),

  yearMin: document.getElementById("yearMin"),
  yearMax: document.getElementById("yearMax"),
  yearMinRange: document.getElementById("yearMinRange"),
  yearMaxRange: document.getElementById("yearMaxRange"),

  genresChips: document.getElementById("genresChips"),
  clearGenresBtn: document.getElementById("clearGenresBtn"),

  certSelect: document.getElementById("certSelect"),

  ratingMin: document.getElementById("ratingMin"),
  ratingMinValue: document.getElementById("ratingMinValue"),

  metaMin: document.getElementById("metaMin"),
  metaMinValue: document.getElementById("metaMinValue"),

  runtimeMax: document.getElementById("runtimeMax"),
  runtimeMaxValue: document.getElementById("runtimeMaxValue"),

  sortSelect: document.getElementById("sortSelect"),
  perPageSelect: document.getElementById("perPageSelect"),

  clearBtn: document.getElementById("clearBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),

  grid: document.getElementById("grid"),
  paginationTop: document.getElementById("paginationTop"),
  paginationBottom: document.getElementById("paginationBottom"),

  avgImdb: document.getElementById("avgImdb"),
  topGenres: document.getElementById("topGenres"),
  topYear: document.getElementById("topYear"),

  modalOverlay: document.getElementById("modalOverlay"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
  modalTitle: document.getElementById("modalTitle"),
  modalPoster: document.getElementById("modalPoster"),
  modalMeta: document.getElementById("modalMeta"),
  modalDesc: document.getElementById("modalDesc"),
  modalDirector: document.getElementById("modalDirector"),
  modalStars: document.getElementById("modalStars"),
  modalRuntime: document.getElementById("modalRuntime"),
  modalCert: document.getElementById("modalCert"),
  modalVotes: document.getElementById("modalVotes"),
  modalGross: document.getElementById("modalGross"),
};

/* ------------------------- Utilidades ------------------------- */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toIntLoose(x) {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = parseInt(s.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toFloatLoose(x) {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseRuntimeMinutes(runtimeStr) {
  if (!runtimeStr) return null;
  const m = String(runtimeStr).match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function splitGenres(genreStr) {
  if (!genreStr) return [];
  return String(genreStr)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function escapeHTML(str) {
  // Escapa para evitar XSS si luego usamos innerHTML con el resultado escapado.
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tokenizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function buildSearchHaystack(m) {
  // Texto precomputado para búsqueda rápida (en minúsculas)
  // Incluye título, director, 4 stars, overview y géneros.
  const parts = [
    m.title, m.director,
    m.star1, m.star2, m.star3, m.star4,
    m.overview,
    m.genreStr
  ].filter(Boolean);
  return parts.join(" • ").toLowerCase();
}

function highlightHTML(text, tokens) {
  // Devuelve HTML seguro: primero escapamos, luego hacemos "mark" sobre el texto escapado.
  // Ojo: tokens se tratan como texto, escapamos regex.
  const safe = escapeHTML(text || "");
  if (!tokens || tokens.length === 0) return safe;

  // Evita marcar tokens demasiado cortos (ruido)
  const tks = tokens.filter(t => t.length >= 2);
  if (tks.length === 0) return safe;

  const escapedTokens = tks
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length); // preferir tokens largos

  const re = new RegExp(`(${escapedTokens.join("|")})`, "ig");
  return safe.replace(re, "<mark>$1</mark>");
}

function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function formatMoneyLike(n) {
  // Gross viene como número (sin símbolo). Mostramos con comas.
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function setStatus(kind, text) {
  el.statusBadge.textContent = text;
  el.statusBadge.classList.remove("badge-ok", "badge-err", "badge-muted");
  if (kind === "ok") el.statusBadge.classList.add("badge-ok");
  else if (kind === "err") el.statusBadge.classList.add("badge-err");
  else el.statusBadge.classList.add("badge-muted");
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------- Querystring ------------------------- */
function encodeStateToQuery() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.cert) params.set("cert", state.cert);

  if (state.yearMin != null) params.set("y0", String(state.yearMin));
  if (state.yearMax != null) params.set("y1", String(state.yearMax));

  if (state.selectedGenres.size) params.set("g", Array.from(state.selectedGenres).join(","));

  if (state.ratingMin > 0) params.set("r", String(state.ratingMin));
  if (state.metaMin > 0) params.set("m", String(state.metaMin));
  if (state.runtimeMax < state.bounds.runtimeMax) params.set("t", String(state.runtimeMax));

  if (state.sort) params.set("sort", state.sort);
  if (state.page && state.page !== 1) params.set("p", String(state.page));
  if (state.perPage && state.perPage !== 24) params.set("pp", String(state.perPage));

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function restoreStateFromQuery() {
  const params = new URLSearchParams(location.search);

  const q = params.get("q");
  if (q != null) state.q = q;

  const cert = params.get("cert");
  if (cert != null) state.cert = cert;

  const y0 = toIntLoose(params.get("y0"));
  const y1 = toIntLoose(params.get("y1"));
  if (y0 != null) state.yearMin = y0;
  if (y1 != null) state.yearMax = y1;

  const g = params.get("g");
  if (g) {
    g.split(",").map(s => s.trim()).filter(Boolean).forEach(x => state.selectedGenres.add(x));
  }

  const r = toFloatLoose(params.get("r"));
  if (r != null) state.ratingMin = clamp(r, 0, 10);

  const m = toIntLoose(params.get("m"));
  if (m != null) state.metaMin = clamp(m, 0, 100);

  const t = toIntLoose(params.get("t"));
  if (t != null) state.runtimeMax = clamp(t, 0, 1000);

  const sort = params.get("sort");
  if (sort) state.sort = sort;

  const p = toIntLoose(params.get("p"));
  if (p != null) state.page = Math.max(1, p);

  const pp = toIntLoose(params.get("pp"));
  if (pp != null && [24, 48, 96].includes(pp)) state.perPage = pp;
}

function pushStateToURL() {
  const qs = encodeStateToQuery();
  const url = `${location.pathname}${qs}${location.hash || ""}`;
  history.replaceState(null, "", url);
}

/* ------------------------- Normalización ------------------------- */
function normalizeMovie(raw, index) {
  const title = (raw.Series_Title ?? "").trim();
  const year = toIntLoose(raw.Released_Year);
  const imdb = toFloatLoose(raw.IMDB_Rating);
  const meta = toIntLoose(raw.Meta_score);
  const runtimeMin = parseRuntimeMinutes(raw.Runtime);

  const votes = toIntLoose(raw.No_of_Votes);
  const gross = toIntLoose(raw.Gross);

  const genres = splitGenres(raw.Genre);
  const cert = (raw.Certificate ?? "").trim();

  const movie = {
    id: index,
    poster: (raw.Poster_Link ?? "").trim(),
    title,
    year: year ?? null,
    cert,
    runtimeMin: runtimeMin ?? null,
    genres,
    genreStr: genres.join(", "),
    imdb: imdb ?? null,
    overview: (raw.Overview ?? "").trim(),
    meta: meta ?? null,
    director: (raw.Director ?? "").trim(),
    star1: (raw.Star1 ?? "").trim(),
    star2: (raw.Star2 ?? "").trim(),
    star3: (raw.Star3 ?? "").trim(),
    star4: (raw.Star4 ?? "").trim(),
    votes: votes ?? null,
    gross: gross ?? null,
  };

  movie.haystack = buildSearchHaystack(movie);
  return movie;
}

function computeBounds(movies) {
  const years = movies.map(m => m.year).filter(v => v != null);
  const runtimes = movies.map(m => m.runtimeMin).filter(v => v != null);

  if (years.length) {
    state.bounds.yearMin = Math.min(...years);
    state.bounds.yearMax = Math.max(...years);
  }
  if (runtimes.length) {
    const rMax = Math.max(...runtimes);
    // tope “usable” para slider
    state.bounds.runtimeMax = Math.max(60, Math.min(400, Math.ceil(rMax / 10) * 10));
  }
}

/* ------------------------- Carga de datos ------------------------- */
async function loadData() {
  state.loading = true;
  state.error = "";
  setStatus("muted", "Cargando…");
  renderSkeleton();

  try {
    const res = await fetch("json/imdb.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      state.all = [];
      state.loading = false;
      setStatus("err", "Sin datos");
      render();
      return;
    }

    state.all = data.map((raw, i) => normalizeMovie(raw, i));
    computeBounds(state.all);

    state.loading = false;
    setStatus("ok", "Listo");
    render();
  } catch (err) {
    state.loading = false;
    state.error = "No se pudo cargar json/imdb.json";
    setStatus("err", state.error);
    state.all = [];
    render();
  }
}

/* ------------------------- Filtros, búsqueda y orden ------------------------- */
function applyFilters(movies) {
  const y0 = state.yearMin;
  const y1 = state.yearMax;
  const cert = state.cert;
  const genresSet = state.selectedGenres;
  const rMin = state.ratingMin;
  const mMin = state.metaMin;
  const tMax = state.runtimeMax;

  return movies.filter(m => {
    if (y0 != null && m.year != null && m.year < y0) return false;
    if (y1 != null && m.year != null && m.year > y1) return false;

    // si falta year, no filtramos por año (más permisivo)
    // si prefieres excluir, cambia la lógica.

    if (cert && m.cert !== cert) return false;

    if (genresSet.size) {
      // debe contener AL MENOS uno de los seleccionados
      const ok = m.genres.some(g => genresSet.has(g));
      if (!ok) return false;
    }

    if (m.imdb != null && m.imdb < rMin) return false;

    // Meta_score: si está vacío, no penaliza
    if (mMin > 0 && m.meta != null && m.meta < mMin) return false;

    // Runtime: si está vacío, no penaliza
    if (m.runtimeMin != null && m.runtimeMin > tMax) return false;

    return true;
  });
}

function applySearch(movies) {
  const tokens = tokenizeQuery(state.q);
  if (!tokens.length) return movies;

  return movies.filter(m => {
    // AND lógico entre tokens
    for (const t of tokens) {
      if (!m.haystack.includes(t)) return false;
    }
    return true;
  });
}

function sortResults(movies) {
  const mode = state.sort;

  const cmpNullLast = (a, b, dir) => {
    // dir: 1 asc, -1 desc
    const aNull = (a == null || !Number.isFinite(a));
    const bNull = (b == null || !Number.isFinite(b));
    if (aNull && bNull) return 0;
    if (aNull) return 1;  // null siempre al final
    if (bNull) return -1;
    return (a - b) * dir;
  };

  const byTitle = (a, b) => a.title.localeCompare(b.title);

  const arr = movies.slice();
  arr.sort((A, B) => {
    switch (mode) {
      case "imdb_desc": {
        const c = cmpNullLast(A.imdb, B.imdb, -1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "imdb_asc": {
        const c = cmpNullLast(A.imdb, B.imdb, 1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "year_desc": {
        const c = cmpNullLast(A.year, B.year, -1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "year_asc": {
        const c = cmpNullLast(A.year, B.year, 1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "votes_desc": {
        const c = cmpNullLast(A.votes, B.votes, -1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "votes_asc": {
        const c = cmpNullLast(A.votes, B.votes, 1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "gross_desc": {
        const c = cmpNullLast(A.gross, B.gross, -1);
        return c !== 0 ? c : byTitle(A, B);
      }
      case "gross_asc": {
        const c = cmpNullLast(A.gross, B.gross, 1);
        return c !== 0 ? c : byTitle(A, B);
      }
      default:
        return byTitle(A, B);
    }
  });

  return arr;
}

/* ------------------------- Render: chips, selects, stats ------------------------- */
function renderFacets() {
  // Géneros
  const genreCounts = new Map();
  for (const m of state.all) {
    for (const g of m.genres) {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }
  }
  const genres = Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  el.genresChips.innerHTML = ""; // Solo contenido controlado (chips generados)
  for (const g of genres) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-pressed", state.selectedGenres.has(g) ? "true" : "false");
    btn.textContent = g;

    btn.addEventListener("click", () => {
      if (state.selectedGenres.has(g)) state.selectedGenres.delete(g);
      else state.selectedGenres.add(g);
      state.page = 1;
      syncUIFromState();
      updateAndRender();
    });

    el.genresChips.appendChild(btn);
  }

  // Certificate select
  const certs = Array.from(new Set(state.all.map(m => m.cert).filter(Boolean))).sort();
  // mantener option "(Cualquiera)"
  const keepFirst = el.certSelect.options[0];
  el.certSelect.innerHTML = "";
  el.certSelect.appendChild(keepFirst);
  for (const c of certs) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    el.certSelect.appendChild(opt);
  }
}

function computeStats(movies) {
  if (!movies.length) return { avgImdb: null, topGenres: [], topYear: null };

  // Media IMDB (ignorando null)
  const imdbVals = movies.map(m => m.imdb).filter(v => v != null);
  const avg = imdbVals.length ? imdbVals.reduce((a, b) => a + b, 0) / imdbVals.length : null;

  // Top 5 géneros
  const gc = new Map();
  for (const m of movies) {
    for (const g of m.genres) gc.set(g, (gc.get(g) || 0) + 1);
  }
  const topGenres = Array.from(gc.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g, n]) => ({ g, n }));

  // Año más frecuente
  const yc = new Map();
  for (const m of movies) {
    if (m.year != null) yc.set(m.year, (yc.get(m.year) || 0) + 1);
  }
  let topYear = null;
  let topCount = -1;
  for (const [y, n] of yc.entries()) {
    if (n > topCount) { topCount = n; topYear = y; }
  }

  return { avgImdb: avg, topGenres, topYear };
}

function renderStats() {
  const s = computeStats(state.filtered);
  el.avgImdb.textContent = (s.avgImdb == null) ? "—" : s.avgImdb.toFixed(2);

  if (!s.topGenres.length) el.topGenres.textContent = "—";
  else el.topGenres.textContent = s.topGenres.map(x => `${x.g} (${x.n})`).join(", ");

  el.topYear.textContent = (s.topYear == null) ? "—" : String(s.topYear);
}

/* ------------------------- Render: grid y cards ------------------------- */
function renderSkeleton() {
  el.grid.innerHTML = "";
  // 12 tarjetas skeleton
  for (let i = 0; i < 12; i++) {
    const card = document.createElement("div");
    card.className = "card skeleton";

    const poster = document.createElement("div");
    poster.className = "poster";
    poster.innerHTML = `<div class="fallback">Cargando…</div>`;
    card.appendChild(poster);

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="skel-block" style="width:80%"></div>
      <div class="skel-row">
        <div class="skel-block" style="width:60px"></div>
        <div class="skel-block" style="width:70px"></div>
      </div>
      <div class="skel-block" style="width:90%"></div>
      <div class="skel-block" style="width:70%"></div>
      <div class="skel-block" style="width:85%"></div>
      <div class="skel-block" style="width:50%"></div>
      <div class="skel-block" style="height:36px;width:100%;margin-top:auto"></div>
    `;
    card.appendChild(body);
    el.grid.appendChild(card);
  }
}

function renderCards() {
  el.grid.innerHTML = "";

  if (state.error) {
    const box = document.createElement("div");
    box.className = "card";
    box.style.minHeight = "200px";
    box.innerHTML = `
      <div class="card-body">
        <h2 class="title">Error</h2>
        <p class="lines"><b>${escapeHTML(state.error)}</b></p>
        <p class="lines">Asegúrate de servir el sitio con un servidor estático (por ejemplo <span class="mono">python -m http.server</span>) y que exista <span class="mono">json/imdb.json</span>.</p>
      </div>
    `;
    el.grid.appendChild(box);
    return;
  }

  if (!state.all.length) {
    const box = document.createElement("div");
    box.className = "card";
    box.style.minHeight = "200px";
    box.innerHTML = `
      <div class="card-body">
        <h2 class="title">Sin datos</h2>
        <p class="lines">El JSON está vacío o no tiene el formato esperado.</p>
      </div>
    `;
    el.grid.appendChild(box);
    return;
  }

  if (!state.pageItems.length) {
    const box = document.createElement("div");
    box.className = "card";
    box.style.minHeight = "200px";
    box.innerHTML = `
      <div class="card-body">
        <h2 class="title">Sin resultados</h2>
        <p class="lines">Prueba a reducir filtros o cambiar la búsqueda.</p>
      </div>
    `;
    el.grid.appendChild(box);
    return;
  }

  const tokens = tokenizeQuery(state.q);

  for (const m of state.pageItems) {
    const card = document.createElement("article");
    card.className = "card";

    // Poster
    const poster = document.createElement("div");
    poster.className = "poster";
    const img = document.createElement("img");
    img.alt = m.title ? `Póster de ${m.title}` : "Póster";
    img.loading = "lazy";
    img.decoding = "async";

    const fallback = document.createElement("div");
    fallback.className = "fallback";
    fallback.textContent = "Sin imagen";

    img.addEventListener("error", () => {
      img.remove();
      poster.appendChild(fallback);
    });

    if (m.poster) img.src = m.poster;
    else poster.appendChild(fallback);

    poster.appendChild(img);
    card.appendChild(poster);

    // Body
    const body = document.createElement("div");
    body.className = "card-body";

    const h = document.createElement("h3");
    h.className = "title";
    // highlight seguro: innerHTML solo con output escapado/mark
    const yearTxt = (m.year != null) ? ` <small>(${escapeHTML(String(m.year))})</small>` : "";
    h.innerHTML = `${highlightHTML(m.title || "—", tokens)}${yearTxt}`;
    body.appendChild(h);

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";

    const imdbTag = document.createElement("span");
    imdbTag.className = "tag imdb";
    imdbTag.textContent = `IMDB: ${m.imdb != null ? m.imdb.toFixed(1) : "—"}`;
    metaRow.appendChild(imdbTag);

    const metaTag = document.createElement("span");
    metaTag.className = "tag meta";
    metaTag.textContent = `Meta: ${m.meta != null ? String(m.meta) : "—"}`;
    metaRow.appendChild(metaTag);

    const rtTag = document.createElement("span");
    rtTag.className = "tag";
    rtTag.textContent = `⏱ ${m.runtimeMin != null ? `${m.runtimeMin} min` : "—"}`;
    metaRow.appendChild(rtTag);

    body.appendChild(metaRow);

    // Genres badges
    const badges = document.createElement("div");
    badges.className = "badges";
    for (const g of m.genres.slice(0, 6)) {
      const b = document.createElement("span");
      b.className = "badge-genre";
      b.textContent = g;
      badges.appendChild(b);
    }
    body.appendChild(badges);

    // Lines (director + 2 stars)
    const lines = document.createElement("div");
    lines.className = "lines";
    const stars2 = [m.star1, m.star2].filter(Boolean).join(", ");
    lines.innerHTML = `<b>Dir:</b> ${escapeHTML(m.director || "—")}<br><b>Stars:</b> ${escapeHTML(stars2 || "—")}`;
    body.appendChild(lines);

    // Overview (snip con highlight)
    const ov = document.createElement("div");
    ov.className = "lines";
    const snip = (m.overview || "").slice(0, 120) + ((m.overview || "").length > 120 ? "…" : "");
    ov.innerHTML = highlightHTML(snip || "", tokens);
    body.appendChild(ov);

    // Actions
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.className = "btn btn-primary details-btn";
    detailsBtn.textContent = "Detalles";
    detailsBtn.addEventListener("click", () => openModal(m));
    actions.appendChild(detailsBtn);

    body.appendChild(actions);

    card.appendChild(body);
    el.grid.appendChild(card);
  }
}

/* ------------------------- Render: paginación ------------------------- */
function renderPagination(targetEl) {
  targetEl.innerHTML = "";

  const total = state.filtered.length;
  const per = state.perPage;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = clamp(state.page, 1, pages);

  // Info
  const info = document.createElement("div");
  info.className = "page-info";
  info.textContent = `Página ${page} / ${pages}`;
  targetEl.appendChild(info);

  const mkBtn = (label, toPage, disabled = false, ariaLabel = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "page-btn";
    b.textContent = label;
    if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
    if (disabled) {
      b.disabled = true;
      b.style.opacity = ".55";
      b.style.cursor = "not-allowed";
    } else {
      b.addEventListener("click", () => {
        state.page = toPage;
        pushStateToURL();
        updateAndRender();
        // scroll suave a top de resultados
        el.grid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    return b;
  };

  targetEl.appendChild(mkBtn("«", 1, page === 1, "Primera página"));
  targetEl.appendChild(mkBtn("‹", page - 1, page === 1, "Página anterior"));

  // Ventana de páginas
  const win = 2;
  const start = Math.max(1, page - win);
  const end = Math.min(pages, page + win);

  if (start > 1) targetEl.appendChild(mkBtn("1", 1, false, "Ir a página 1"));
  if (start > 2) {
    const dots = document.createElement("span");
    dots.className = "page-info";
    dots.textContent = "…";
    targetEl.appendChild(dots);
  }

  for (let p = start; p <= end; p++) {
    const b = mkBtn(String(p), p, false, `Ir a página ${p}`);
    if (p === page) b.setAttribute("aria-current", "page");
    targetEl.appendChild(b);
  }

  if (end < pages - 1) {
    const dots = document.createElement("span");
    dots.className = "page-info";
    dots.textContent = "…";
    targetEl.appendChild(dots);
  }
  if (end < pages) targetEl.appendChild(mkBtn(String(pages), pages, false, `Ir a página ${pages}`));

  targetEl.appendChild(mkBtn("›", page + 1, page === pages, "Página siguiente"));
  targetEl.appendChild(mkBtn("»", pages, page === pages, "Última página"));
}

/* ------------------------- Modal accesible ------------------------- */
function openModal(movie) {
  lastFocusedEl = document.activeElement;

  el.modalTitle.textContent = movie.title || "Detalles";

  // Poster con fallback
  el.modalPoster.alt = movie.title ? `Póster de ${movie.title}` : "Póster";
  el.modalPoster.src = movie.poster || "";
  el.modalPoster.onerror = () => { el.modalPoster.removeAttribute("src"); };

  const year = movie.year != null ? movie.year : "—";
  const imdb = movie.imdb != null ? movie.imdb.toFixed(1) : "—";
  const meta = movie.meta != null ? String(movie.meta) : "—";
  el.modalMeta.textContent = `${year} • IMDB ${imdb} • Meta ${meta} • ${movie.genreStr || "—"}`;

  el.modalDesc.textContent = movie.overview || "—";
  el.modalDirector.textContent = movie.director || "—";
  el.modalStars.textContent = [movie.star1, movie.star2, movie.star3, movie.star4].filter(Boolean).join(", ") || "—";
  el.modalRuntime.textContent = movie.runtimeMin != null ? `${movie.runtimeMin} min` : "—";
  el.modalCert.textContent = movie.cert || "—";
  el.modalVotes.textContent = formatNumber(movie.votes);
  el.modalGross.textContent = formatMoneyLike(movie.gross);

  el.modalOverlay.hidden = false;

  // Cierre con click fuera
  el.modalOverlay.addEventListener("mousedown", onOverlayMouseDown);
  document.addEventListener("keydown", onModalKeyDown);

  // Focus
  el.modalCloseBtn.focus();
  trapFocus(el.modalOverlay);
}

function closeModal() {
  if (el.modalOverlay.hidden) return;
  el.modalOverlay.hidden = true;

  el.modalOverlay.removeEventListener("mousedown", onOverlayMouseDown);
  document.removeEventListener("keydown", onModalKeyDown);

  if (lastFocusedEl && typeof lastFocusedEl.focus === "function") lastFocusedEl.focus();
}

function onOverlayMouseDown(e) {
  // si clicas en el overlay (no dentro del modal), cierra
  if (e.target === el.modalOverlay) closeModal();
}

function onModalKeyDown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
  }
}

function trapFocus(container) {
  // Trap básico: si Tab sale del modal, lo reenviamos al primer/último foco.
  const focusables = Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(x => !x.disabled && x.offsetParent !== null);

  if (!focusables.length) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  const handler = (e) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", handler, { once: true });
  // Nota: al usar { once:true }, el trap se reengancha cada vez que se abre modal (openModal llama trapFocus).
}

/* ------------------------- Sincronización UI <-> state ------------------------- */
function syncUIFromState() {
  // inputs principales
  el.searchInput.value = state.q;

  // year bounds y valores
  const yMinB = state.bounds.yearMin;
  const yMaxB = state.bounds.yearMax;

  el.yearMin.min = String(yMinB);
  el.yearMin.max = String(yMaxB);
  el.yearMax.min = String(yMinB);
  el.yearMax.max = String(yMaxB);

  el.yearMinRange.min = String(yMinB);
  el.yearMinRange.max = String(yMaxB);
  el.yearMaxRange.min = String(yMinB);
  el.yearMaxRange.max = String(yMaxB);

  const y0 = (state.yearMin != null) ? state.yearMin : yMinB;
  const y1 = (state.yearMax != null) ? state.yearMax : yMaxB;

  el.yearMin.value = String(y0);
  el.yearMax.value = String(y1);
  el.yearMinRange.value = String(y0);
  el.yearMaxRange.value = String(y1);

  // sliders
  el.ratingMin.value = String(state.ratingMin);
  el.ratingMinValue.textContent = Number(state.ratingMin).toFixed(1);

  el.metaMin.value = String(state.metaMin);
  el.metaMinValue.textContent = String(state.metaMin);

  // runtime slider
  el.runtimeMax.max = String(state.bounds.runtimeMax);
  el.runtimeMax.value = String(clamp(state.runtimeMax, 0, state.bounds.runtimeMax));
  el.runtimeMaxValue.textContent = String(state.runtimeMax);

  // selects
  el.certSelect.value = state.cert;
  el.sortSelect.value = state.sort;
  el.perPageSelect.value = String(state.perPage);

  // chips: actualizar aria-pressed
  Array.from(el.genresChips.querySelectorAll(".chip")).forEach(btn => {
    const g = btn.textContent;
    btn.setAttribute("aria-pressed", state.selectedGenres.has(g) ? "true" : "false");
  });

  // panel
  el.toggleFiltersBtn.setAttribute("aria-expanded", el.filtersPanel.style.display !== "none" ? "true" : "false");
}

function applyYearSanity() {
  c
