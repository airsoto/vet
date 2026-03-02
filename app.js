// app.js
(() => {
  "use strict";

  /**********************************************************************
   * Config
   *********************************************************************/
  const JSON_URL = "json/ddx_game.json"; // ruta relativa en tu repo
  const STOPWORDS = new Set([
    "de","la","que","el","en","y","a","los","del","se","las","por","un","para","con","no","una","su","al","lo","como",
    "más","pero","sus","le","ya","o","este","sí","porque","esta","entre","cuando","muy","sin","sobre","también","me",
    "hasta","hay","donde","quien","desde","todo","nos","durante","todos","uno","les","ni","contra","otros","ese","eso",
    "ante","ellos","e","esto","mí","antes","algunos","qué","unos","yo","otro","otras","otra","él","tanto","esa","estos",
    "mucho","quienes","nada","muchos","cual","poco","ella","estar","estas","algunas","algo","nosotros",
    // ampliación suave útil
    "u","rt","etc","etcétera","p","q","x","s","t","h","cm","mm","mg","ml"
  ]);

  // Paleta agradable (generativa; fija por proceso en selección actual)
  const BASE_PALETTE = [
    "#ff6b6b","#ffd166","#06d6a0","#4dabf7","#b197fc","#ff922b",
    "#63e6be","#74c0fc","#ffa8a8","#e599f7","#99e9f2","#a9e34b"
  ];

  // Para "token raro": un token se considera raro si su df <= dfThreshold
  const RARE_DF_RATIO = 0.22; // ~22% de docs o menos => raro

  /**********************************************************************
   * Helpers DOM
   *********************************************************************/
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const els = {
    dataStatus: $("#dataStatus"),
    btnRepo: $("#btnRepo"),

    searchInput: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    specialtyFilter: $("#specialtyFilter"),
    maxSelect: $("#maxSelect"),
    maxSelectVal: $("#maxSelectVal"),
    sensitivity: $("#sensitivity"),
    selectedChips: $("#selectedChips"),
    selectHint: $("#selectHint"),
    resultsCount: $("#resultsCount"),
    processList: $("#processList"),
    btnSelectRandom: $("#btnSelectRandom"),

    emptyState: $("#emptyState"),
    btnTryDemo: $("#btnTryDemo"),
    btnHowItWorks: $("#btnHowItWorks"),
    vennMode: $("#vennMode"),
    vennReal: $("#vennReal"),
    vennLike: $("#vennLike"),
    svgDefs: $("#svgDefs"),
    blobLayer: $("#blobLayer"),
    labelLayer: $("#labelLayer"),
    tooltip: $("#tooltip"),
    regionStrip: $("#regionStrip"),

    selectedList: $("#selectedList"),
    dxByProcess: $("#dxByProcess"),
    intersectionsTable: $("#intersectionsTable"),
    regionMeta: $("#regionMeta"),
    btnCollapseRight: $("#btnCollapseRight"),

    btnHelp: $("#btnHelp"),
    modal: $("#modal"),
    modalBody: $("#modalBody"),
    themeToggle: $("#themeToggle"),
  };

  /**********************************************************************
   * State + caching
   *********************************************************************/
  const state = {
    raw: [],                 // JSON original
    filtered: [],            // procesos filtrados (lista)
    selectedKeys: [],        // array de "Proceso"
    maxSelected: 6,
    sensitivity: "t1",       // t1 | t2 | rare
    specialty: "",
    q: "",
    theme: "dark",

    // cache de tokenización por Proceso
    tokenCache: new Map(),   // key -> { meta, dx: [{text, tokens:Set, tokenArr:[]}] }
    // cache simple de computación de componentes por selección+sensitivity
    graphCache: new Map(),   // cacheKey -> computedResult
    activeRegionKey: null,   // e.g. "A", "A∩B", "A∩B∩C" o internal "PsetKey"
  };

  /**********************************************************************
   * Text normalization/tokenization
   *********************************************************************/
  const stripAccents = (s) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const normalizeText = (s) => stripAccents(String(s || "").toLowerCase());

  const removePunct = (s) =>
    s
      .replace(/[(){}\[\]]/g, " ")
      .replace(/[.,;:¡!¿?/"'’“”]/g, " ")
      .replace(/[–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Normalización simple (plurales básicos)
  function lightNormalizeToken(t){
    if (!t) return t;
    // elimina posesivos/sufijos frecuentes
    t = t.replace(/^(del|al)$/g, t);
    // plurales muy básicos
    if (t.length > 4) {
      if (t.endsWith("es")) t = t.slice(0, -2);
      else if (t.endsWith("s")) t = t.slice(0, -1);
    }
    // algunas equivalencias suaves
    t = t.replace(/ción$/g, "cion"); // ya sin acento; redundante pero ok
    return t;
  }

  function tokenize(text){
    const cleaned = removePunct(normalizeText(text));
    const parts = cleaned.split(" ").map(lightNormalizeToken);
    const tokens = parts.filter(t =>
      t && t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t)
    );
    return tokens;
  }

  /**********************************************************************
   * Build token cache per process
   *********************************************************************/
  function ensureProcessCached(procObj){
    const key = procObj.Proceso;
    if (state.tokenCache.has(key)) return state.tokenCache.get(key);

    const dxArr = Array.isArray(procObj["Diagnósticos diferenciales"])
      ? procObj["Diagnósticos diferenciales"]
      : [];

    const dx = dxArr.map((text, idx) => {
      const tokenArr = tokenize(text);
      return {
        id: `${key}::${idx}`,
        text,
        tokenArr,
        tokens: new Set(tokenArr),
      };
    });

    const cached = {
      meta: {
        Proceso: procObj.Proceso,
        especialidades: procObj.especialidades || "",
        mnemotecnica: procObj["mnemotécnica"] || procObj.mnemotecnica || "",
      },
      dx
    };

    state.tokenCache.set(key, cached);
    return cached;
  }

  /**********************************************************************
   * Sensitivity + overlap logic
   *
   * Match criteria (IMPORTANTE):
   * - Construimos un grafo de diagnósticos (nodos = diagnóstico individual).
   * - Conectamos (arista) dos diagnósticos de procesos diferentes si cumplen la sensibilidad:
   *   - t1: comparten ≥1 token
   *   - t2: comparten ≥2 tokens
   *   - rare: comparten ≥1 token "raro" (según df/IDF simple)
   * - Luego calculamos componentes conexos. Cada componente involucra un conjunto de procesos Pset.
   * - Un diagnóstico pertenece a la intersección EXACTA de Pset si su componente incluye diagnósticos
   *   de todos los procesos de Pset y de ninguno fuera (es decir, Pset = conjunto de procesos del componente).
   * - Para cada región, mostramos:
   *   - diagnósticos por proceso dentro de esos componentes
   *   - tokens "causantes": tokens que aparecen en ≥1 diagnóstico de CADA proceso del Pset (dentro del componente)
   *********************************************************************/
  function buildIDF(selectedProcs){
    // Docs = diagnósticos de procesos seleccionados
    const docs = [];
    for (const p of selectedProcs){
      const cached = ensureProcessCached(p);
      for (const d of cached.dx){
        docs.push(d.tokenArr);
      }
    }
    const N = docs.length || 1;
    const df = new Map();
    for (const toks of docs){
      const uniq = new Set(toks);
      for (const t of uniq){
        df.set(t, (df.get(t) || 0) + 1);
      }
    }
    const idf = new Map();
    for (const [t, f] of df.entries()){
      // IDF simple, suave
      const score = Math.log((N + 1) / (f + 1)) + 1;
      idf.set(t, score);
    }
    // Rare threshold
    const dfThreshold = Math.max(1, Math.floor(N * RARE_DF_RATIO));
    const isRare = (t) => (df.get(t) || 0) <= dfThreshold;

    return { N, df, idf, isRare, dfThreshold };
  }

  function sharedTokens(aSet, bSet){
    const out = [];
    for (const t of aSet){
      if (bSet.has(t)) out.push(t);
    }
    return out;
  }

  function qualifiesEdge(shared, idfInfo, sensitivity){
    if (sensitivity === "t1") return shared.length >= 1;
    if (sensitivity === "t2") return shared.length >= 2;
    if (sensitivity === "rare") {
      const rareShared = shared.filter(t => idfInfo.isRare(t));
      return rareShared.length >= 1;
    }
    return shared.length >= 1;
  }

  function edgeTokensForDisplay(shared, idfInfo, sensitivity){
    if (sensitivity === "rare"){
      const rareShared = shared.filter(t => idfInfo.isRare(t));
      return rareShared.length ? rareShared : shared.slice(0, 3);
    }
    return shared;
  }

  /**********************************************************************
   * Graph + components
   *********************************************************************/
  function computeIntersections(){
    const selected = getSelectedProcessObjects();
    if (selected.length < 2) return null;

    const cacheKey = `${selected.map(p=>p.Proceso).sort().join("||")}::${state.sensitivity}`;
    if (state.graphCache.has(cacheKey)) return state.graphCache.get(cacheKey);

    const idfInfo = buildIDF(selected);

    // Build nodes list
    const nodes = []; // {nodeId, procKey, dxText, tokens:Set}
    const byProc = new Map(); // procKey -> array of nodeIdx
    for (const p of selected){
      const cached = ensureProcessCached(p);
      const procKey = cached.meta.Proceso;
      byProc.set(procKey, []);
      for (const d of cached.dx){
        const node = {
          nodeId: d.id,
          procKey,
          text: d.text,
          tokens: d.tokens,
          tokenArr: d.tokenArr
        };
        const idx = nodes.push(node) - 1;
        byProc.get(procKey).push(idx);
      }
    }

    // Build adjacency via pairwise comparisons (between processes)
    const adj = new Array(nodes.length);
    for (let i=0;i<adj.length;i++) adj[i] = [];

    // To keep it fast: compare only across different processes
    const procKeys = Array.from(byProc.keys());
    for (let i=0;i<procKeys.length;i++){
      for (let j=i+1;j<procKeys.length;j++){
        const A = byProc.get(procKeys[i]);
        const B = byProc.get(procKeys[j]);
        // nested loops; typically manageable (DDx lists are not huge)
        for (const ai of A){
          const a = nodes[ai];
          for (const bi of B){
            const b = nodes[bi];
            const shared = sharedTokens(a.tokens, b.tokens);
            if (qualifiesEdge(shared, idfInfo, state.sensitivity)){
              adj[ai].push({to: bi, shared: edgeTokensForDisplay(shared, idfInfo, state.sensitivity)});
              adj[bi].push({to: ai, shared: edgeTokensForDisplay(shared, idfInfo, state.sensitivity)});
            }
          }
        }
      }
    }

    // Connected components BFS/DFS
    const seen = new Array(nodes.length).fill(false);
    const components = []; // {nodeIdxs:[], procs:Set, edgesTokens:Map(token->Set(procKey))}
    for (let i=0;i<nodes.length;i++){
      if (seen[i]) continue;
      // isolate nodes with no edges are not useful for intersections, but keep for per-process panels
      if (adj[i].length === 0) { seen[i]=true; continue; }

      const stack = [i];
      seen[i] = true;

      const nodeIdxs = [];
      const procs = new Set();
      // token -> Set(procKey) across component (for "tokens causantes")
      const tokenProcPresence = new Map();

      while (stack.length){
        const u = stack.pop();
        nodeIdxs.push(u);
        const pKey = nodes[u].procKey;
        procs.add(pKey);

        // incorporate tokens for presence by process (per node)
        // (esto permite luego: token aparece en al menos un dx de cada proceso)
        for (const t of nodes[u].tokens){
          let s = tokenProcPresence.get(t);
          if (!s){ s = new Set(); tokenProcPresence.set(t, s); }
          s.add(pKey);
        }

        for (const e of adj[u]){
          const v = e.to;
          if (!seen[v]){
            seen[v] = true;
            stack.push(v);
          }
        }
      }

      components.push({ nodeIdxs, procs, tokenProcPresence });
    }

    // Group components by exact process-set key
    const regionMap = new Map(); // regionKey (joined proc keys) -> region data
    for (const comp of components){
      const procArr = Array.from(comp.procs).sort();
      if (procArr.length < 2) continue; // no intersection region for single proc
      const regionKey = procArr.join("∩"); // internal key using process names

      let region = regionMap.get(regionKey);
      if (!region){
        region = {
          regionKey,
          procArr,
          components: [],
        };
        regionMap.set(regionKey, region);
      }
      region.components.push(comp);
    }

    // Build region details:
    // - tokens that appear in >=1 dx for EACH proc in region (across each component)
    // - diagnostics list grouped by process
    const regions = [];
    for (const region of regionMap.values()){
      const procsSet = new Set(region.procArr);

      // aggregate diagnostics
      const dxByProc = new Map();
      for (const p of region.procArr) dxByProc.set(p, []);

      // aggregate token presence per proc across ALL components in this region
      const tokenPresence = new Map(); // token -> Set(procKey)
      for (const comp of region.components){
        // add dx
        for (const idx of comp.nodeIdxs){
          const node = nodes[idx];
          if (!procsSet.has(node.procKey)) continue;
          dxByProc.get(node.procKey).push(node);
        }

        // merge tokenProcPresence
        for (const [t, setP] of comp.tokenProcPresence.entries()){
          let s = tokenPresence.get(t);
          if (!s){ s = new Set(); tokenPresence.set(t, s); }
          for (const p of setP) if (procsSet.has(p)) s.add(p);
        }
      }

      // tokens causantes: tokens que aparecen en >=1 dx de cada proceso
      const tokensCausing = [];
      for (const [t, setP] of tokenPresence.entries()){
        let ok = true;
        for (const p of region.procArr){
          if (!setP.has(p)) { ok = false; break; }
        }
        if (ok){
          tokensCausing.push(t);
        }
      }

      // ordenar tokens: en modo rare, prioriza rare; si no, prioriza por idf desc
      tokensCausing.sort((a,b) => (idfInfo.idf.get(b)||0) - (idfInfo.idf.get(a)||0));

      // de-duplicar dx por proc (por si entran por varios comps)
      const dxOut = {};
      for (const p of region.procArr){
        const seenText = new Set();
        dxOut[p] = [];
        for (const node of dxByProc.get(p)){
          if (seenText.has(node.text)) continue;
          seenText.add(node.text);
          dxOut[p].push(node.text);
        }
      }

      const totalDx = Object.values(dxOut).reduce((acc, arr) => acc + arr.length, 0);

      regions.push({
        regionKey: region.regionKey,
        procArr: region.procArr,
        tokens: tokensCausing.slice(0, 20), // cap UI
        dxByProc: dxOut,
        totalDx,
        // helper: rarity info
        rareInfo: { dfThreshold: idfInfo.dfThreshold, Ndocs: idfInfo.N }
      });
    }

    // Sort regions by order: higher-order intersections first, then by totalDx desc
    regions.sort((a,b) => {
      if (b.procArr.length !== a.procArr.length) return b.procArr.length - a.procArr.length;
      return b.totalDx - a.totalDx;
    });

    const computed = {
      selectedProcs: selected.map(p => p.Proceso),
      regions,
      idfInfo,
    };

    state.graphCache.set(cacheKey, computed);
    return computed;
  }

  /**********************************************************************
   * UI render: process list, chips, right panel
   *********************************************************************/
  function getSelectedProcessObjects(){
    const set = new Set(state.selectedKeys);
    return state.raw.filter(p => set.has(p.Proceso));
  }

  function getUniqueSpecialties(){
    const s = new Set();
    for (const p of state.raw){
      if (p.especialidades) s.add(String(p.especialidades).trim());
    }
    return Array.from(s).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  }

  function colorForProcess(procName){
    // estable por selección: index en selectedKeys
    const idx = state.selectedKeys.indexOf(procName);
    return BASE_PALETTE[(idx >= 0 ? idx : hash(procName)) % BASE_PALETTE.length];
  }

  function hash(str){
    let h = 0;
    for (let i=0;i<str.length;i++){
      h = (h*31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function setStatus(text, kind="info"){
    els.dataStatus.textContent = text;
    els.dataStatus.style.borderColor =
      kind === "ok" ? "rgba(39,209,127,.35)" :
      kind === "bad" ? "rgba(255,107,107,.35)" :
      "var(--line)";
  }

  function applyFilters(){
    const q = normalizeText(state.q);
    const spec = state.specialty;

    const filtered = state.raw.filter(p => {
      if (spec && String(p.especialidades||"") !== spec) return false;
      if (!q) return true;
      const hay = normalizeText(
        `${p.Proceso||""} ${p.especialidades||""} ${p["mnemotécnica"]||p.mnemotecnica||""}`
      );
      return hay.includes(q);
    });

    state.filtered = filtered;
    renderProcessList();
  }

  function renderProcessList(){
    const items = state.filtered;
    els.resultsCount.textContent = `${items.length} procesos`;

    els.processList.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const p of items){
      const key = p.Proceso;
      const checked = state.selectedKeys.includes(key);
      const canCheck = checked || state.selectedKeys.length < state.maxSelected;

      const row = document.createElement("div");
      row.className = "item";
      row.setAttribute("role", "listitem");

      const color = checked ? colorForProcess(key) : "transparent";

      row.innerHTML = `
        <div class="left">
          <input class="chk" type="checkbox" ${checked ? "checked":""} ${canCheck ? "" : "disabled"} aria-label="Seleccionar" />
          <div class="pill">${escapeHtml(p["mnemotécnica"] || p.mnemotecnica || "—")}</div>
        </div>
        <div class="main">
          <div class="name">${escapeHtml(p.Proceso || "—")}</div>
          <div class="meta">
            <span class="kv"><span class="tag">Especialidad</span> ${escapeHtml(p.especialidades || "—")}</span>
          </div>
        </div>
        <div class="colorbar" style="background:${color};"></div>
      `;

      const chk = $(".chk", row);
      chk.addEventListener("change", () => toggleProcessSelection(key, chk.checked));
      row.addEventListener("click", (e) => {
        if (e.target.closest("input,button,select,a")) return;
        if (!canCheck && !checked) return;
        chk.checked = !chk.checked;
        toggleProcessSelection(key, chk.checked);
      });

      frag.appendChild(row);
    }

    els.processList.appendChild(frag);

    renderSelectedChips();
    renderSelectedRight();
  }

  function renderSelectedChips(){
    els.selectedChips.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const key of state.selectedKeys){
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `
        <span class="dot" style="background:${colorForProcess(key)};"></span>
        <span>${escapeHtml(key)}</span>
        <button title="Quitar">×</button>
      `;
      $("button", chip).addEventListener("click", (e) => {
        e.stopPropagation();
        toggleProcessSelection(key, false);
      });
      frag.appendChild(chip);
    }

    els.selectedChips.appendChild(frag);

    const n = state.selectedKeys.length;
    els.selectHint.textContent =
      n < 2 ? "Selecciona 2–6 procesos para ver el diagrama." :
      n > state.maxSelected ? `Demasiados seleccionados (límite ${state.maxSelected}).` :
      `OK: ${n} seleccionados.`;
  }

  function renderSelectedRight(){
    // Selected list
    els.selectedList.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const key of state.selectedKeys){
      const obj = state.raw.find(p => p.Proceso === key);
      const mn = obj ? (obj["mnemotécnica"] || obj.mnemotecnica || "") : "";
      const row = document.createElement("div");
      row.className = "sel-row";
      row.innerHTML = `
        <span class="dot" style="background:${colorForProcess(key)};"></span>
        <div class="txt">
          <div class="p">${escapeHtml(key)}</div>
          <div class="m">${escapeHtml(mn)}</div>
        </div>
        <button class="icon-btn" title="Quitar">×</button>
      `;
      $("button", row).addEventListener("click", () => toggleProcessSelection(key, false));
      frag.appendChild(row);
    }
    els.selectedList.appendChild(frag);

    // Diagnósticos por proceso (accordion)
    els.dxByProcess.innerHTML = "";
    const selectedObjs = getSelectedProcessObjects();

    for (const p of selectedObjs){
      const cached = ensureProcessCached(p);
      const key = cached.meta.Proceso;
      const acc = document.createElement("div");
      acc.className = "acc-item";
      acc.innerHTML = `
        <div class="acc-head">
          <span class="dot" style="background:${colorForProcess(key)};"></span>
          <div class="t">${escapeHtml(key)}</div>
          <div class="caret">▾</div>
        </div>
        <div class="acc-body"></div>
      `;
      const body = $(".acc-body", acc);
      const dxArr = cached.dx.map(d => d.text);

      for (const t of dxArr){
        const d = document.createElement("div");
        d.className = "dx";
        d.textContent = t;
        body.appendChild(d);
      }

      $(".acc-head", acc).addEventListener("click", () => {
        acc.classList.toggle("open");
      });

      els.dxByProcess.appendChild(acc);
    }
  }

  function toggleProcessSelection(key, on){
    if (on){
      if (!state.selectedKeys.includes(key)){
        if (state.selectedKeys.length >= state.maxSelected){
          toast(`Límite alcanzado (${state.maxSelected}).`, "bad");
          renderProcessList();
          return;
        }
        state.selectedKeys.push(key);
      }
    } else {
      state.selectedKeys = state.selectedKeys.filter(x => x !== key);
      // limpiar región activa si ya no aplica
      state.activeRegionKey = null;
      els.regionMeta.innerHTML = `<div class="muted">Pasa el ratón o haz click en una región.</div>`;
    }

    // actualiza barras de color
    renderProcessList();
    // recompute venn
    renderVenn();
  }

  /**********************************************************************
   * Venn rendering
   *********************************************************************/
  function renderVenn(){
    const n = state.selectedKeys.length;
    const computed = computeIntersections();

    const showEmpty = n < 2;
    els.emptyState.style.display = showEmpty ? "grid" : "none";

    // reset views
    els.vennReal.style.display = "none";
    els.vennLike.style.display = "none";
    els.regionStrip.innerHTML = "";
    els.intersectionsTable.innerHTML = "";

    if (showEmpty){
      els.vennMode.textContent = "—";
      return;
    }

    // Build region strip + table from computed
    const regions = (computed && computed.regions) ? computed.regions : [];

    // If no regions, still show diagram sets
    if (n <= 3){
      els.vennMode.textContent = "Modo: Venn real (venn.js)";
      els.vennReal.style.display = "block";
      drawVennReal(n, computed);
    } else {
      els.vennMode.textContent = "Modo: Venn estilizado (SVG + blend)";
      els.vennLike.style.display = "block";
      drawVennLike(n, computed);
    }

    renderRegionStripAndTable(computed);

    // Default active region: highest-order region (first) if exists
    if (!state.activeRegionKey && regions.length){
      setActiveRegion(regions[0].regionKey);
    }
  }

  function drawVennReal(n, computed){
    // Clear
    els.vennReal.innerHTML = "";

    // Build areas:
    // sets: each process is a set
    // intersections: each regionKey represents exact region; we convert to venn.js sets array
    const selected = state.selectedKeys.slice();

    // sizes for individual sets: #diagnósticos (simple)
    const areas = [];
    for (const proc of selected){
      const obj = state.raw.find(p => p.Proceso === proc);
      const cached = ensureProcessCached(obj);
      areas.push({
        sets: [proc],
        size: cached.dx.length || 1,
        label: proc
      });
    }

    // Intersections: use computed regions (exact Pset)
    // size: totalDx (sum diag across processes in that region) => visual cue
    for (const r of (computed?.regions || [])){
      if (r.procArr.length <= 1) continue;
      areas.push({
        sets: r.procArr,
        size: Math.max(1, r.totalDx),
        regionKey: r.regionKey
      });
    }

    // Draw
    const chart = venn.VennDiagram()
      .width(els.vennReal.clientWidth)
      .height(Math.max(520, els.vennReal.clientHeight));

    const div = d3.select(els.vennReal);
    div.datum(areas).call(chart);

    // Style sets (fill gradient-ish via CSS inline)
    div.selectAll("path")
      .style("fill-opacity", 0.85)
      .style("stroke-opacity", 0.95)
      .style("mix-blend-mode", "multiply");

    // Color each set path by its primary set color
    div.selectAll(".venn-area").each(function(d){
      const el = d3.select(this).select("path");
      const sets = d.sets || [];
      // for single sets: solid; for intersections: neutral dark-ish overlay
      if (sets.length === 1){
        const c = colorForProcess(sets[0]);
        el.style("fill", c);
        // halo-like highlight using filter via svg defs is hard here; we rely on opacity + bg
        el.style("stroke", "rgba(0,0,0,.45)");
      } else {
        el.style("fill", "rgba(255,255,255,.18)");
        el.style("stroke", "rgba(0,0,0,.30)");
      }
    });

    // Label styling
    div.selectAll("text")
      .style("fill", "var(--text)")
      .style("font-weight", 800);

    // Custom hover/click with our tooltip + right panel
    div.selectAll(".venn-area")
      .on("mouseover", (event, d) => {
        const key = (d.sets || []).slice().sort().join("∩");
        showTooltip(event, key);
      })
      .on("mousemove", (event, d) => {
        const key = (d.sets || []).slice().sort().join("∩");
        moveTooltip(event);
        updateTooltipContent(key);
      })
      .on("mouseout", () => hideTooltip())
      .on("click", (event, d) => {
        const key = (d.sets || []).slice().sort().join("∩");
        setActiveRegion(key);
      });

    // Ensure labels show mnemonic externally is limited; add subtitle inside tooltip/side.
  }

  function drawVennLike(n, computed){
    // Simple “vennfan-like” blobs: circles with radial highlight + multiply blend.
    // The overlaps are visual; the REAL region logic is the region pills/table.
    // We still provide hover over blobs to show per-set info.

    // Clear layers
    els.svgDefs.innerHTML = "";
    els.blobLayer.innerHTML = "";
    els.labelLayer.innerHTML = "";

    const W = 900, H = 600;
    const cx = W/2, cy = H/2;

    // positions for 4..6
    const positions = {
      4: [
        [cx-160, cy-70], [cx+160, cy-70], [cx-160, cy+90], [cx+160, cy+90]
      ],
      5: [
        [cx-180, cy-60], [cx+0, cy-140], [cx+180, cy-60], [cx-110, cy+120], [cx+110, cy+120]
      ],
      6: [
        [cx-200, cy-70], [cx+0, cy-160], [cx+200, cy-70], [cx-200, cy+110], [cx+0, cy+190], [cx+200, cy+110]
      ]
    };

    const sel = state.selectedKeys.slice(0, 6);
    const pos = positions[sel.length] || positions[6];
    const r = sel.length <= 4 ? 180 : 165;

    // defs: radial highlight per blob
    sel.forEach((p, i) => {
      const c = colorForProcess(p);
      const gid = `grad_${i}`;
      els.svgDefs.insertAdjacentHTML("beforeend", `
        <radialGradient id="${gid}" cx="32%" cy="28%" r="70%">
          <stop offset="0%" stop-color="rgba(255,255,255,.55)"/>
          <stop offset="18%" stop-color="rgba(255,255,255,.18)"/>
          <stop offset="55%" stop-color="${c}"/>
          <stop offset="100%" stop-color="${c}"/>
        </radialGradient>
      `);
    });

    // draw blobs (circles) + labels
    sel.forEach((p, i) => {
      const [x,y] = pos[i] || [cx,cy];
      const c = colorForProcess(p);

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-proc", p);

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      circle.setAttribute("r", r);
      circle.setAttribute("class", "blob");
      circle.setAttribute("fill", `url(#grad_${i})`);
      circle.style.stroke = "rgba(0,0,0,.45)";
      circle.style.cursor = "pointer";

      // subtle outline dark
      circle.addEventListener("mousemove", (ev) => {
        showTooltip(ev, p);
        updateTooltipContent(p, {isSetOnly:true});
        moveTooltip(ev);
      });
      circle.addEventListener("mouseleave", hideTooltip);
      circle.addEventListener("click", () => {
        // clicking a set activates its single region if exists; else just show set info
        setActiveRegion(p);
      });

      g.appendChild(circle);
      els.blobLayer.appendChild(g);

      // labels (external-ish)
      const labelG = document.createElementNS("http://www.w3.org/2000/svg", "g");

      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y - r - 10);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "blob-label");
      t.textContent = p;

      const obj = state.raw.find(o => o.Proceso === p);
      const mn = obj ? (obj["mnemotécnica"] || obj.mnemotecnica || "") : "";
      const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
      sub.setAttribute("x", x);
      sub.setAttribute("y", y - r + 10);
      sub.setAttribute("text-anchor", "middle");
      sub.setAttribute("class", "blob-sub");
      sub.textContent = mn ? `(${mn})` : "";

      labelG.appendChild(t);
      labelG.appendChild(sub);
      els.labelLayer.appendChild(labelG);
    });

    // Slight hint: show a compact region strip below (the real interactions live there)
  }

  function renderRegionStripAndTable(computed){
    const regions = computed?.regions || [];
    const n = state.selectedKeys.length;

    // Region strip: include singles as well (A, B, C...)
    const strip = document.createDocumentFragment();

    // Singles
    for (const p of state.selectedKeys){
      const pill = makeRegionPill(p, countDiagnoses(p));
      strip.appendChild(pill);
    }

    // Intersections
    for (const r of regions){
      const name = prettyRegionName(r.procArr);
      const pill = makeRegionPill(r.regionKey, r.totalDx, name);
      strip.appendChild(pill);
    }

    els.regionStrip.appendChild(strip);

    // Table
    const tbl = document.createDocumentFragment();
    tbl.appendChild(makeTrow(["Región","Total","Tokens (top)"], true));

    // show intersections only
    for (const r of regions){
      const name = prettyRegionName(r.procArr);
      const tokensTop = r.tokens.slice(0, 6).join(", ");
      const row = makeTrow([name, String(r.totalDx), tokensTop || "—"], false, () => setActiveRegion(r.regionKey));
      tbl.appendChild(row);
    }

    if (!regions.length){
      const row = makeTrow(["(sin intersecciones)", "0", "—"], false);
      row.style.cursor = "default";
      tbl.appendChild(row);
    }

    els.intersectionsTable.innerHTML = "";
    els.intersectionsTable.appendChild(tbl);

    // highlight active pill
    refreshRegionPillActive();
  }

  function countDiagnoses(proc){
    const obj = state.raw.find(p => p.Proceso === proc);
    if (!obj) return 0;
    return (obj["Diagnósticos diferenciales"] || []).length || 0;
  }

  function makeRegionPill(regionKey, count, labelOverride=null){
    const pill = document.createElement("div");
    pill.className = "region-pill";
    pill.setAttribute("data-region", regionKey);

    const label = labelOverride ?? (regionKey.includes("∩") ? prettyRegionName(regionKey.split("∩")) : regionKey);

    pill.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <span class="count">${escapeHtml(String(count ?? 0))}</span>
    `;

    pill.addEventListener("click", () => setActiveRegion(regionKey));
    pill.addEventListener("mousemove", (ev) => {
      showTooltip(ev, regionKey);
      updateTooltipContent(regionKey);
      moveTooltip(ev);
    });
    pill.addEventListener("mouseleave", hideTooltip);

    return pill;
  }

  function prettyRegionName(procArr){
    // produce A∩B style with short letters based on order in selection
    const letters = "ABCDEF".split("");
    const map = new Map(state.selectedKeys.map((p,i)=>[p, letters[i] || `S${i+1}`]));
    const parts = procArr.map(p => map.get(p) || p);
    return parts.join("∩");
  }

  function setActiveRegion(regionKey){
    state.activeRegionKey = regionKey;
    refreshRegionPillActive();

    // Render right panel "Región activa"
    const computed = computeIntersections();
    const selectedSet = new Set(state.selectedKeys);

    // If it's a single process (A) show its dx + no tokens
    if (!regionKey.includes("∩") && selectedSet.has(regionKey)){
      const obj = state.raw.find(p => p.Proceso === regionKey);
      const cached = ensureProcessCached(obj);
      els.regionMeta.innerHTML = `
        <div class="rx">
          <div class="top">
            <div class="name">${escapeHtml(regionKey)}</div>
            <div class="muted">${escapeHtml(cached.meta.mnemotecnica || "")}</div>
          </div>
          <div class="muted" style="margin-top:6px;">Región: conjunto individual (sin intersección).</div>
        </div>
      `;
      return;
    }

    const region = computed?.regions?.find(r => r.regionKey === regionKey);
    if (!region){
      els.regionMeta.innerHTML = `<div class="muted">No hay datos para esta región.</div>`;
      return;
    }

    // Diagnostics list with highlighted tokens
    const tokenSet = new Set(region.tokens);
    const blocks = [];

    for (const proc of region.procArr){
      const c = colorForProcess(proc);
      const list = (region.dxByProc[proc] || []).slice(0, 18).map(t => {
        return `<div class="dx">${highlightTokens(escapeHtml(t), tokenSet)}</div>`;
      }).join("");

      blocks.push(`
        <div class="rx">
          <div class="top">
            <div class="name"><span class="dot" style="background:${c}; vertical-align:middle;"></span> ${escapeHtml(proc)}</div>
            <div class="muted">${escapeHtml(String((region.dxByProc[proc]||[]).length))} dx</div>
          </div>
          <div style="margin-top:8px;">${list || `<div class="muted">—</div>`}</div>
        </div>
      `);
    }

    const tokensHtml = (region.tokens.slice(0, 14)).map(t => `<span class="token">${escapeHtml(t)}</span>`).join("");
    const regionName = prettyRegionName(region.procArr);

    els.regionMeta.innerHTML = `
      <div class="rx">
        <div class="top">
          <div class="name">Región ${escapeHtml(regionName)}</div>
          <div class="muted">Total dx: ${escapeHtml(String(region.totalDx))}</div>
        </div>
        <div class="muted" style="margin-top:6px;">
          Tokens causantes (aparecen en ≥1 dx de <b>cada</b> proceso en esta región).
        </div>
        <div class="tokens">${tokensHtml || `<span class="muted">—</span>`}</div>
      </div>
      ${blocks.join("")}
    `;
  }

  function refreshRegionPillActive(){
    $$(".region-pill").forEach(p => {
      p.classList.toggle("active", p.getAttribute("data-region") === state.activeRegionKey);
    });
  }

  /**********************************************************************
   * Tooltip
   *********************************************************************/
  function showTooltip(ev, key){
    els.tooltip.style.opacity = "1";
    els.tooltip.style.transform = "translateY(0px)";
    updateTooltipContent(key);
    moveTooltip(ev);
  }
  function moveTooltip(ev){
    const pad = 14;
    const rect = els.tooltip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - rect.width - pad, ev.clientX + 14);
    const y = Math.min(window.innerHeight - rect.height - pad, ev.clientY + 14);
    els.tooltip.style.left = `${x}px`;
    els.tooltip.style.top = `${y}px`;
  }
  function hideTooltip(){
    els.tooltip.style.opacity = "0";
    els.tooltip.style.transform = "translateY(6px)";
  }

  function updateTooltipContent(key, opts={}){
    const computed = computeIntersections();
    const selectedSet = new Set(state.selectedKeys);

    // Single process
    if (!key.includes("∩") && selectedSet.has(key)){
      const dxN = countDiagnoses(key);
      els.tooltip.innerHTML = `
        <div class="tt-title">${escapeHtml(key)}</div>
        <div class="tt-row">${escapeHtml(String(dxN))} diagnósticos</div>
        <div class="tt-row muted">Click para fijar en “Región activa”.</div>
      `;
      return;
    }

    // Region intersection
    const region = computed?.regions?.find(r => r.regionKey === key);
    if (!region){
      // fallback: could be set-only in venn-like hover
      if (opts.isSetOnly){
        els.tooltip.innerHTML = `
          <div class="tt-title">${escapeHtml(key)}</div>
          <div class="tt-row muted">Conjunto (visual). Revisa intersecciones en la lista inferior.</div>
        `;
      } else {
        els.tooltip.innerHTML = `
          <div class="tt-title">${escapeHtml(key)}</div>
          <div class="tt-row muted">Sin datos de intersección.</div>
        `;
      }
      return;
    }

    const name = prettyRegionName(region.procArr);
    const tokensTop = region.tokens.slice(0, 6).join(", ") || "—";
    els.tooltip.innerHTML = `
      <div class="tt-title">Región ${escapeHtml(name)}</div>
      <div class="tt-row">${escapeHtml(String(region.procArr.length))} procesos · ${escapeHtml(String(region.totalDx))} dx</div>
      <div class="tt-row muted">Tokens: ${escapeHtml(tokensTop)}</div>
      <div class="tt-row muted">Click para fijar.</div>
    `;
  }

  /**********************************************************************
   * Modal help
   *********************************************************************/
  function openModal(html){
    els.modalBody.innerHTML = html;
    els.modal.classList.add("open");
  }
  function closeModal(){
    els.modal.classList.remove("open");
  }

  function helpHtml(){
    return `
      <b>Tokenización</b>
      <ul>
        <li>minúsculas</li>
        <li>sin acentos</li>
        <li>sin puntuación/paréntesis</li>
        <li>sin stopwords españolas</li>
        <li>normalización simple: plurales básicos (s/es)</li>
      </ul>

      <b>Sensibilidad (aristas del grafo)</b>
      <ul>
        <li><b>1 token</b>: dos diagnósticos se conectan si comparten ≥1 token.</li>
        <li><b>≥2 tokens</b>: se conectan si comparten ≥2 tokens.</li>
        <li><b>token raro (IDF)</b>: se conectan si comparten ≥1 token con baja frecuencia documental (df ≤ ${Math.round(RARE_DF_RATIO*100)}% de diagnósticos del conjunto seleccionado).</li>
      </ul>

      <b>Cómo se decide la intersección (criterio de match)</b><br/>
      Construimos un grafo donde cada nodo es un <b>diagnóstico diferencial</b>. Unimos diagnósticos de <b>procesos distintos</b> si cumplen la sensibilidad. Luego:
      <ul>
        <li>Calculamos <b>componentes conexos</b> (grupos enlazados por coincidencias).</li>
        <li>Cada componente involucra un conjunto de procesos <code>Pset</code>.</li>
        <li>Ese grupo se asigna a la región exacta <code>Pset</code> (por ejemplo A∩B∩C).</li>
        <li>Los <b>tokens causantes</b> de una región son tokens que aparecen en ≥1 diagnóstico de <b>cada</b> proceso dentro de la región.</li>
      </ul>

      <b>Nota sobre el Venn para 4–6</b><br/>
      El SVG es <b>venn-like</b> (estilizado) para mantener claridad visual; las regiones exactas se exploran con la tira de regiones y la tabla de intersecciones.
    `;
  }

  /**********************************************************************
   * Search debounce
   *********************************************************************/
  function debounce(fn, ms=180){
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /**********************************************************************
   * Toast (mini)
   *********************************************************************/
  let toastEl = null;
  function toast(msg, kind="info"){
    if (!toastEl){
      toastEl = document.createElement("div");
      toastEl.style.position = "fixed";
      toastEl.style.left = "50%";
      toastEl.style.bottom = "18px";
      toastEl.style.transform = "translateX(-50%)";
      toastEl.style.zIndex = "999";
      toastEl.style.padding = "10px 12px";
      toastEl.style.borderRadius = "16px";
      toastEl.style.border = "1px solid var(--line)";
      toastEl.style.background = "rgba(0,0,0,.58)";
      toastEl.style.backdropFilter = "blur(10px)";
      toastEl.style.boxShadow = "var(--shadow)";
      toastEl.style.color = "var(--text)";
      toastEl.style.fontSize = "12px";
      toastEl.style.opacity = "0";
      toastEl.style.transition = "opacity .14s ease, transform .14s ease";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.borderColor =
      kind === "bad" ? "rgba(255,107,107,.45)" :
      kind === "ok" ? "rgba(39,209,127,.45)" :
      "var(--line)";
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateX(-50%) translateY(0px)";
    setTimeout(() => {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translateX(-50%) translateY(6px)";
    }, 1400);
  }

  /**********************************************************************
   * HTML safety
   *********************************************************************/
  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function highlightTokens(textHtml, tokenSet){
    // tokenSet is normalized tokens; highlight in displayed text by a simple regex
    // This is "best effort": we highlight tokens if they appear as substrings once normalized.
    // Safer: highlight by splitting original text into words after normalization mapping; but overkill here.
    const raw = textHtml;
    // We do a pass replacing words (case-insensitive) for top few tokens
    const tokens = Array.from(tokenSet).slice(0, 10).sort((a,b)=>b.length-a.length);
    let out = raw;
    for (const t of tokens){
      const re = new RegExp(`\\b(${escapeRegExp(t)})\\b`, "ig");
      out = out.replace(re, `<span class="hl">$1</span>`);
    }
    return out;
  }
  function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function makeTrow(cols, header=false, onClick=null){
    const row = document.createElement("div");
    row.className = "trow" + (header ? " header" : "");
    cols.forEach((c) => {
      const cell = document.createElement("div");
      cell.className = "tcell";
      cell.textContent = c;
      row.appendChild(cell);
    });
    if (onClick){
      row.addEventListener("click", onClick);
    }
    return row;
  }

  /**********************************************************************
   * Data loading (fetch with robust errors)
   *********************************************************************/
  async function loadData(){
    setStatus("Cargando…");
    try{
      const res = await fetch(JSON_URL, { cache: "no-store" });
      if (!res.ok){
        throw new Error(`HTTP ${res.status} (${res.statusText}). ¿Existe ${JSON_URL}?`);
      }
      const text = await res.text();
      let json;
      try{
        json = JSON.parse(text);
      } catch(err){
        throw new Error("JSON inválido: no se pudo parsear. Revisa comillas/acentos/caracteres.");
      }
      if (!Array.isArray(json)){
        throw new Error("Estructura inválida: se esperaba un array en el root.");
      }
      // basic schema checks
      for (const [i, o] of json.entries()){
        if (!o || typeof o !== "object" || !("Proceso" in o)){
          throw new Error(`Elemento #${i} inválido: falta "Proceso".`);
        }
      }

      state.raw = json;
      state.filtered = json;

      setStatus(`OK · ${json.length}`, "ok");

      // Specialty options
      const specs = getUniqueSpecialties();
      for (const s of specs){
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        els.specialtyFilter.appendChild(opt);
      }

      // Repo button best-effort: detect GH Pages
      guessRepoLink();

      applyFilters();
      renderVenn();
    } catch(err){
      console.error(err);
      setStatus("Error", "bad");

      const msg = String(err?.message || err);

      // Common CORS/file:// note
      const extra = (location.protocol === "file:")
        ? `<br/><br/><b>Nota:</b> <code>fetch()</code> suele fallar en <code>file://</code>. Abre esto con GitHub Pages o un servidor local.`
        : "";

      openModal(`
        <b>Error al cargar</b> <code>${escapeHtml(JSON_URL)}</code><br/>
        <div style="margin-top:10px;">${escapeHtml(msg)}</div>
        ${extra}
        <div style="margin-top:10px;">
          <b>Soluciones rápidas</b>
          <ul>
            <li>GitHub Pages: asegúrate de que <code>json/ddx_game.json</code> existe en la rama publicada.</li>
            <li>Servidor local: <code>python -m http.server</code> y abre <code>http://localhost:8000</code>.</li>
          </ul>
        </div>
      `);
    }
  }

  function guessRepoLink(){
    // If running on GitHub Pages: https://user.github.io/repo/...
    // We'll set Repo to the origin of current path (best-effort)
    try{
      const host = location.hostname;
      if (host.endsWith("github.io")){
        const parts = location.pathname.split("/").filter(Boolean);
        const user = host.split(".")[0];
        const repo = parts[0] || "";
        if (repo){
          els.btnRepo.href = `https://github.com/${user}/${repo}`;
          return;
        }
      }
    } catch {}
    // fallback: keep current dir
    els.btnRepo.href = "#";
  }

  /**********************************************************************
   * Demo selection
   *********************************************************************/
  function selectDemo(){
    // pick 3 items spread across specialties if possible
    if (state.raw.length < 3) return;

    state.selectedKeys = [];
    // pick first 3 distinct specialties if possible
    const bySpec = new Map();
    for (const p of state.raw){
      const s = String(p.especialidades||"").trim();
      if (!bySpec.has(s)) bySpec.set(s, []);
      bySpec.get(s).push(p);
    }
    const specKeys = Array.from(bySpec.keys()).filter(Boolean);
    shuffle(specKeys);

    const picks = [];
    for (const s of specKeys){
      if (picks.length >= 3) break;
      const arr = bySpec.get(s);
      if (arr && arr.length) picks.push(arr[Math.floor(Math.random()*arr.length)]);
    }
    while (picks.length < 3){
      picks.push(state.raw[Math.floor(Math.random()*state.raw.length)]);
    }
    for (const p of picks.slice(0,3)){
      if (!state.selectedKeys.includes(p.Proceso)) state.selectedKeys.push(p.Proceso);
    }

    renderProcessList();
    renderVenn();
  }

  function selectRandom(){
    const max = state.maxSelected;
    const n = Math.min(max, Math.max(2, Math.floor(2 + Math.random() * (max-1))));
    const pool = state.filtered.length ? state.filtered : state.raw;
    const picks = pool.slice();
    shuffle(picks);
    state.selectedKeys = picks.slice(0, n).map(p => p.Proceso);
    renderProcessList();
    renderVenn();
  }

  function shuffle(arr){
    for (let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**********************************************************************
   * Theme
   *********************************************************************/
  function setTheme(theme){
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    els.themeToggle.checked = (theme === "light");
  }

  /**********************************************************************
   * Events
   *********************************************************************/
  function wireEvents(){
    // search
    const onSearch = debounce(() => {
      state.q = els.searchInput.value || "";
      applyFilters();
    }, 180);

    els.searchInput.addEventListener("input", onSearch);
    els.clearSearch.addEventListener("click", () => {
      els.searchInput.value = "";
      state.q = "";
      applyFilters();
    });

    // specialty
    els.specialtyFilter.addEventListener("change", () => {
      state.specialty = els.specialtyFilter.value || "";
      applyFilters();
    });

    // max select
    els.maxSelect.addEventListener("input", () => {
      const v = parseInt(els.maxSelect.value, 10);
      state.maxSelected = v;
      els.maxSelectVal.textContent = String(v);

      // if over limit, trim
      if (state.selectedKeys.length > v){
        state.selectedKeys = state.selectedKeys.slice(0, v);
      }
      renderProcessList();
      renderVenn();
    });

    // sensitivity
    els.sensitivity.addEventListener("change", () => {
      state.sensitivity = els.sensitivity.value;
      // Invalidate active region; keep selection
      state.activeRegionKey = null;
      renderVenn();
    });

    // random
    els.btnSelectRandom.addEventListener("click", selectRandom);

    // demo
    els.btnTryDemo.addEventListener("click", selectDemo);

    // help
    els.btnHelp.addEventListener("click", () => openModal(helpHtml()));
    els.btnHowItWorks.addEventListener("click", () => openModal(helpHtml()));

    // modal close
    els.modal.addEventListener("click", (e) => {
      if (e.target?.dataset?.close) closeModal();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // right collapse
    els.btnCollapseRight.addEventListener("click", () => {
      $(".panel-right")?.classList.toggle("collapsed");
    });

    // theme toggle
    els.themeToggle.addEventListener("change", () => {
      setTheme(els.themeToggle.checked ? "light" : "dark");
      // force rerender of venn visuals (some colors depend on CSS variables)
      renderVenn();
    });
  }

  /**********************************************************************
   * Init
   *********************************************************************/
  function init(){
    // default theme: dark (pero respeta preferencia del sistema si quieres)
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    setTheme(prefersLight ? "light" : "dark");

    // default controls
    state.maxSelected = parseInt(els.maxSelect.value, 10);
    els.maxSelectVal.textContent = String(state.maxSelected);

    wireEvents();
    loadData();
  }

  init();

})();
