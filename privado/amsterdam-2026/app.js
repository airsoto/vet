(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const HOME_QUERY = "Hotel Prins Hendrik Amsterdam";
  const state = { data: null, activeDay: null, foodFilter: "all", placeFilter: "all", query: "" };

  const iconForCategory = {
    food: "🍽️", flight: "✈️", transport: "🚆", museum: "🎨", walk: "🚶", hotel: "🏨", booking: "🎟️", market: "🛍️", activity: "📍"
  };

  document.addEventListener("DOMContentLoaded", () => {
    bindUnlock();
    tryRestore();
    registerServiceWorker();
  });

  function bindUnlock(){
    const form = $("#unlockForm");
    const error = $("#lockError");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      error.style.display = "none";
      error.textContent = "";
      const password = $("#password").value.trim();
      const remember = $("#rememberDevice").checked;
      const button = form.querySelector("button");
      button.disabled = true;
      button.textContent = "Abriendo…";
      try {
        const data = await decryptTrip(password);
        persistData(data, remember);
        startApp(data);
      } catch (err) {
        console.error(err);
        error.textContent = "Contraseña incorrecta o datos no disponibles. Prueba de nuevo sin espacios.";
        error.style.display = "block";
        $("#password").select();
      } finally {
        button.disabled = false;
        button.textContent = "Entrar";
      }
    });
  }

  function tryRestore(){
    const saved = sessionStorage.getItem("amsterdamTripData") || localStorage.getItem("amsterdamTripData");
    if(!saved) return;
    try { startApp(JSON.parse(saved)); } catch { sessionStorage.removeItem("amsterdamTripData"); }
  }

  function persistData(data, remember){
    const json = JSON.stringify(data);
    sessionStorage.setItem("amsterdamTripData", json);
    if(remember) localStorage.setItem("amsterdamTripData", json);
  }

  async function decryptTrip(password){
    if(!window.crypto || !crypto.subtle) throw new Error("WebCrypto no disponible");
    const p = window.TRIP_PAYLOAD;
    if(!p || !p.data) throw new Error("Payload no encontrado");
    const enc = new TextEncoder();
    const salt = b64ToBytes(p.salt);
    const iv = b64ToBytes(p.iv);
    const ciphertext = b64ToBytes(p.data);
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:p.iterations, hash:"SHA-256"}, keyMaterial, {name:"AES-GCM", length:256}, false, ["decrypt"]);
    const clear = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(clear));
  }

  function b64ToBytes(base64){
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function startApp(data){
    state.data = data;
    state.activeDay = chooseActiveDay(data);
    $("#lockScreen").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    document.title = `${data.meta.shortTitle} · Itinerario`;
    bindAppEvents();
    renderAll();
  }

  function bindAppEvents(){
    $("#lockAgain").onclick = () => {
      sessionStorage.removeItem("amsterdamTripData");
      localStorage.removeItem("amsterdamTripData");
      location.reload();
    };
    $("#globalSearch").addEventListener("input", (ev) => {
      state.query = ev.target.value.trim().toLowerCase();
      renderSearch();
    });
    document.body.addEventListener("click", (ev) => {
      const dayBtn = ev.target.closest("[data-day]");
      if(dayBtn){
        state.activeDay = dayBtn.dataset.day;
        renderDayTabs();
        renderDayDetail();
        location.hash = "dayDetail";
      }
      const foodBtn = ev.target.closest("[data-food-filter]");
      if(foodBtn){ state.foodFilter = foodBtn.dataset.foodFilter; renderFood(); }
      const placeBtn = ev.target.closest("[data-place-filter]");
      if(placeBtn){ state.placeFilter = placeBtn.dataset.placeFilter; renderSites(); }
      const copyBtn = ev.target.closest("[data-copy]");
      if(copyBtn){ copyText(copyBtn.dataset.copy); }
    });
  }

  function renderAll(){
    renderOverview();
    renderDayTabs();
    renderDayDetail();
    renderBooking();
    renderSites();
    renderFood();
    renderFlights();
    renderPlanB();
    renderBudget();
    renderSearch();
  }

  function chooseActiveDay(data){
    const today = new Date();
    const todayKey = toDateKey(today);
    const match = data.days.find(d => d.date === todayKey);
    if(match) return match.id;
    if(todayKey < data.meta.startDate) return data.days[0].id;
    if(todayKey > data.meta.endDate) return data.days[data.days.length - 1].id;
    return data.days[0].id;
  }

  function renderOverview(){
    const data = state.data;
    const upcoming = findUpcomingEvent(data);
    const activeDay = getDay(state.activeDay);
    $("#topStatus").textContent = `${data.meta.dateRange} · ${activeDay.shortLabel}`;
    $("#overview").innerHTML = `
      <div class="hero-card">
        <span class="kicker">${data.meta.country} · ${data.meta.dateRange}</span>
        <h2>${escapeHtml(data.meta.title)}</h2>
        <p>${escapeHtml(data.meta.subtitle)}. Base: <strong>${escapeHtml(data.meta.homeBase)}</strong>.</p>
        <div class="hero-grid">
          ${metric("📅", "Días", `${data.days.length} días`)}
          ${metric("🏨", "Hotel", data.meta.hotel.name)}
          ${metric("🚤", "Reserva", "Crucero 19/06")}
          ${metric("✈️", "Vuelos", "Iberia")}
        </div>
        <div class="today-card">
          <strong>${upcoming.title}</strong>
          <span>${upcoming.text}</span>
        </div>
        <div class="quick-actions">
          ${mapLink(data.meta.hotel.mapQuery, "📍 Abrir hotel", "btn secondary")}
          <a class="btn secondary" href="#booking">🚤 Ver crucero</a>
          <a class="btn secondary" href="#food">🍽️ Comer ahora</a>
          <a class="btn secondary" href="#planb">☔ Plan B</a>
        </div>
      </div>`;
  }

  function metric(icon, label, value){
    return `<div class="metric"><span>${icon} ${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderDayTabs(){
    $("#dayTabs").innerHTML = state.data.days.map(day => `
      <button class="day-tab ${day.id === state.activeDay ? "active" : ""}" data-day="${day.id}" type="button">
        <span>${day.emoji}</span><span>${day.shortLabel}</span>
      </button>`).join("");
  }

  function renderDayDetail(){
    const day = getDay(state.activeDay);
    const planB = state.data.planB.find(p => p.dayId === day.id);
    $("#dayDetail").innerHTML = `
      <div class="section-title">
        <div><h2>${day.emoji} ${escapeHtml(day.weekday)} · ${escapeHtml(day.title)}</h2><p>${escapeHtml(day.headline)}</p></div>
        <span class="pill">📍 ${escapeHtml(day.zone)}</span>
      </div>
      <div class="card stack">
        <div class="notice"><strong>Idea del día:</strong> ${escapeHtml(day.idea)}</div>
        ${renderTimeline(day.timeline, "Planning del día")}
        ${day.extraTimeline ? renderExtraTimeline(day.extraTimeline) : ""}
        ${renderMealsForDay(day)}
        ${renderFinalPicks(day.finalPick)}
        ${planB ? `<a class="inline-btn" href="#planb">☔ Ver Plan B de ${escapeHtml(day.shortLabel)}</a>` : ""}
      </div>`;
  }

  function renderTimeline(items, title){
    return `<div><div class="meal-head"><h3>${escapeHtml(title)}</h3><span class="pill">${items.length} pasos</span></div><div class="timeline">${items.map(renderEvent).join("")}</div></div>`;
  }

  function renderExtraTimeline(extra){
    return `<div class="accordion"><details><summary>${escapeHtml(extra.title)} <span>＋</span></summary><div class="accordion-content">${renderTimeline(extra.items, extra.title)}</div></details></div>`;
  }

  function renderEvent(item){
    const emoji = getLeadingEmoji(item.title) || iconForCategory[item.category] || "📍";
    return `<article class="event">
      <div class="event-dot"><span class="event-emoji">${emoji}</span><span class="event-time">${escapeHtml(item.time || "")}</span></div>
      <div>
        <h3>${escapeHtml(stripLeadingEmoji(item.title))}</h3>
        ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
        <div class="event-meta">
          ${item.travel && item.travel !== "—" ? `<span class="chip">⏱️ ${escapeHtml(item.travel)}</span>` : ""}
          <span class="chip">${iconForCategory[item.category] || "📍"} ${escapeHtml(labelCategory(item.category))}</span>
        </div>
        ${item.mapQuery ? `<div class="map-actions">${mapLink(item.mapQuery, "Maps", "")} ${directionsLink(item.mapQuery, "Cómo ir")}</div>` : ""}
      </div>
    </article>`;
  }

  function renderMealsForDay(day){
    return day.meals.map(group => `<div class="meal-group">
      <div class="meal-head"><h3>${escapeHtml(group.title)}</h3><span class="pill">${group.options.length} opciones</span></div>
      <div class="grid restaurant-grid">${group.options.map(renderRestaurant).join("")}</div>
    </div>`).join("");
  }

  function renderRestaurant(r){
    const reserve = r.reservation ? `<span class="chip reservation-tag">⭐ ${escapeHtml(r.reservation)}</span>` : "";
    const distance = r.distance ? `<span class="chip">🚶 ${escapeHtml(r.distance)}</span>` : "";
    return `<article class="card restaurant-card">
      <h4>${escapeHtml(r.name)}</h4>
      <div class="event-meta"><span class="chip">${escapeHtml(r.type || "🍽️ Restaurante")}</span>${distance}${reserve}</div>
      <p>${escapeHtml(r.reason || r.context || "")}</p>
      <div class="map-actions">${mapLink(r.mapQuery, "Maps", "")} ${directionsLink(r.mapQuery, "Desde hotel")}</div>
    </article>`;
  }

  function renderFinalPicks(items){
    if(!items || !items.length) return "";
    return `<div class="meal-group"><div class="meal-head"><h3>✅ Selección final recomendada</h3></div><div class="grid two">${items.map(it => `<article class="card"><span class="pill">${escapeHtml(it.label)}</span><h3>${escapeHtml(it.choice)}</h3><p class="mini-note">${escapeHtml(it.reason)}</p></article>`).join("")}</div></div>`;
  }

  function renderBooking(){
    const res = state.data.reservations[0];
    const rows = Object.entries(res.details).map(([k,v]) => dataRow(k, v, /Reserva|Precio|Hora|Fecha/.test(k))).join("");
    $("#booking").innerHTML = `
      <div class="section-title"><div><h2>${res.emoji} Reserva del crucero</h2><p>Datos clave y posibles muelles para validar el bono.</p></div></div>
      <div class="card stack">
        <div class="data-table">${rows}</div>
        <div class="notice">${escapeHtml(res.recommendation)}</div>
        <div class="meal-head"><h3>📍 Posibles puntos de encuentro</h3></div>
        <div class="grid two">${res.meetingPoints.map(mp => `<article class="card restaurant-card"><h4>${escapeHtml(mp.Modalidad)}</h4><p><strong>${escapeHtml(mp["Dirección del muelle"])}</strong></p><div class="event-meta"><span class="chip">🚶 ${escapeHtml(mp["Trayecto orientativo desde el hotel"])}</span></div><p>${escapeHtml(mp.Comentario)}</p><div class="map-actions">${mapLink(mp["Dirección del muelle"] + " Amsterdam", "Maps", "")} ${directionsLink(mp["Dirección del muelle"] + " Amsterdam", "Desde hotel")}</div></article>`).join("")}</div>
      </div>`;
  }

  function renderSites(){
    const filters = ["all", "Hotel", "Museo", "Restaurante", "Muelle posible", "Mercado", "Aeropuerto"];
    const places = state.data.places.filter(p => state.placeFilter === "all" || p.type === state.placeFilter).slice().sort((a,b) => (a.restaurant === b.restaurant ? a.name.localeCompare(b.name) : a.restaurant ? 1 : -1));
    $("#sites").innerHTML = `
      <div class="section-title"><div><h2>🧭 Sitios y mapas</h2><p>Directorio rápido para abrir cada lugar o calcular cómo ir desde el hotel.</p></div></div>
      <div class="filter-row">${filters.map(f => `<button class="filter-chip ${state.placeFilter===f?'active':''}" type="button" data-place-filter="${escapeHtml(f)}">${f==='all'?'Todos':escapeHtml(f)}</button>`).join("")}</div>
      <div class="place-list">${places.map(renderPlace).join("")}</div>`;
  }

  function renderPlace(p){
    return `<article class="place-card"><div class="place-emoji">${p.emoji || "📍"}</div><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.type)} · ${escapeHtml(p.area || "Ámsterdam")}</p>${p.notes ? `<p class="mini-note">${escapeHtml(p.notes)}</p>` : ""}<div class="map-actions">${mapLink(p.mapQuery, "Maps", "")} ${directionsLink(p.mapQuery, "Desde hotel")}</div></div></article>`;
  }

  function renderFood(){
    const filters = ["all", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "lunch", "dinner"];
    const label = f => f === "all" ? "Todo" : f === "lunch" ? "Comidas" : f === "dinner" ? "Cenas" : getDay(f)?.shortLabel || f;
    const restaurants = state.data.restaurants.filter(r => state.foodFilter === "all" || r.days?.includes(state.foodFilter) || r.meals?.includes(state.foodFilter));
    const final = state.data.restaurantGuide.finalSelection;
    $("#food").innerHTML = `
      <div class="section-title"><div><h2>🍽️ Comer durante el viaje</h2><p>Opciones por día, recomendaciones finales y reservas recomendadas.</p></div></div>
      <div class="filter-row">${filters.map(f => `<button class="filter-chip ${state.foodFilter===f?'active':''}" type="button" data-food-filter="${f}">${escapeHtml(label(f))}</button>`).join("")}</div>
      <div class="grid restaurant-grid">${restaurants.map(renderRestaurant).join("")}</div>
      <div class="meal-group"><div class="meal-head"><h3>✅ Selección final por día</h3></div><div class="grid two">${final.map(day => `<article class="card"><h3>${escapeHtml(day.title)}</h3>${day.items.map(it => `<p class="mini-note"><strong>${escapeHtml(it.label)}:</strong> ${escapeHtml(it.choice)}<br>${escapeHtml(it.reason)}</p>`).join("")}</article>`).join("")}</div></div>
      <div class="meal-group"><div class="meal-head"><h3>⭐ Sitios que conviene reservar</h3></div><div class="grid two">${state.data.restaurantGuide.reservationRecommendations.map(r => `<article class="card"><h3>${escapeHtml(r.Sitio)}</h3><div class="event-meta"><span class="chip reservation-tag">${escapeHtml(r["Conviene reservar"])}</span></div><p class="mini-note">${escapeHtml(r.Motivo)}</p><div class="map-actions">${mapLink(r.Sitio + " Amsterdam", "Maps", "")}</div></article>`).join("")}</div></div>`;
  }

  function renderFlights(){
    const f = state.data.flights;
    $("#flights").innerHTML = `
      <div class="section-title"><div><h2>✈️ Vuelos y asientos</h2><p>Datos prácticos de Iberia para ida y vuelta.</p></div></div>
      <div class="grid two">${renderFlightCard(f.outbound)}${renderFlightCard(f.return)}</div>`;
  }

  function renderFlightCard(f){
    return `<article class="card stack"><div><span class="kicker">${f.emoji} ${escapeHtml(f.title)}</span></div><div class="data-table">${Object.entries(f.details).map(([k,v]) => dataRow(k, v, /Código|Vuelo|Salida|Llegada|Embarque|Cierre/.test(k))).join("")}</div><div class="meal-head"><h3>👥 Asientos</h3></div><div class="grid two">${f.seats.map(s => `<div class="card"><strong>${escapeHtml(s.Pasajero)}</strong><p class="mini-note">Asiento ${escapeHtml(s.Asiento)}</p></div>`).join("")}</div></article>`;
  }

  function renderPlanB(){
    $("#planb").innerHTML = `
      <div class="section-title"><div><h2>☔ Plan B según cansancio, lluvia o hambre</h2><p>Alternativas rápidas para decidir sin pensar demasiado durante el viaje.</p></div></div>
      <div class="accordion">${state.data.planB.map(day => `<details ${day.dayId===state.activeDay?'open':''}><summary>${escapeHtml(day.title)} <span>＋</span></summary><div class="accordion-content"><div class="grid two">${day.scenarios.map(sc => `<article class="card"><h3>${escapeHtml(sc.title)}</h3><ul>${sc.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul></article>`).join("")}</div></div></details>`).join("")}</div>`;
  }

  function renderBudget(){
    $("#budget").innerHTML = `
      <div class="section-title"><div><h2>💶 Presupuesto orientativo</h2><p>Rangos rápidos para elegir comida según hambre, tiempo y presupuesto.</p></div></div>
      <div class="grid two">${state.data.restaurantGuide.budget.map(b => `<article class="card"><span class="pill">${escapeHtml(b["Precio aprox. por persona"])}</span><h3>${escapeHtml(b["Tipo de comida"])}</h3><p class="mini-note">${escapeHtml(b.Ejemplos)}</p></article>`).join("")}</div>`;
  }

  function renderSearch(){
    const box = $("#searchResults");
    if(!state.data || state.query.length < 2){ box.classList.add("hidden"); box.innerHTML = ""; return; }
    const q = state.query;
    const eventResults = state.data.days.flatMap(day => [...day.timeline, ...(day.extraTimeline?.items || [])].map(e => ({...e, dayLabel: day.shortLabel, dayId: day.id}))).filter(e => hay(e, q)).slice(0, 12);
    const restaurantResults = state.data.restaurants.filter(r => hay(r, q)).slice(0, 12);
    const placeResults = state.data.places.filter(p => hay(p, q)).slice(0, 12);
    box.classList.remove("hidden");
    box.innerHTML = `<div class="section-title"><div><h2>🔎 Resultados de búsqueda</h2><p>${eventResults.length + restaurantResults.length + placeResults.length} coincidencias para “${escapeHtml(state.query)}”.</p></div></div><div class="grid">
      ${eventResults.length ? `<div class="card"><h3>📅 Itinerario</h3><div class="timeline">${eventResults.map(renderEvent).join("")}</div></div>` : ""}
      ${restaurantResults.length ? `<div class="card"><h3>🍽️ Restaurantes</h3><div class="grid restaurant-grid">${restaurantResults.map(renderRestaurant).join("")}</div></div>` : ""}
      ${placeResults.length ? `<div class="card"><h3>🧭 Sitios</h3><div class="place-list">${placeResults.map(renderPlace).join("")}</div></div>` : ""}
    </div>`;
  }

  function findUpcomingEvent(data){
    const now = new Date();
    const start = parseDate(data.meta.startDate);
    const end = parseDate(data.meta.endDate);
    end.setHours(23,59,59,999);
    if(now < start){
      const days = Math.ceil((start - now) / 86400000);
      return {title:`Faltan ${days} días`, text:`Primer paso: salida desde Madrid el ${data.days[0].shortLabel}.`};
    }
    if(now > end) return {title:"Viaje finalizado", text:"El itinerario queda guardado como consulta del viaje."};
    const events = data.days.flatMap(day => [...day.timeline, ...(day.extraTimeline?.items || [])].map(ev => ({day, ev, date: dateForEvent(day.date, ev.time)}))).filter(x => x.date && x.date >= now).sort((a,b)=>a.date-b.date);
    if(events[0]) return {title:`Siguiente: ${stripLeadingEmoji(events[0].ev.title)}`, text:`${events[0].day.shortLabel} · ${events[0].ev.time} · ${events[0].ev.note || events[0].ev.travel || ""}`};
    return {title:"Sin próximos pasos hoy", text:"Revisa el día activo o el Plan B según os encontréis."};
  }

  function getDay(id){ return state.data.days.find(d => d.id === id); }
  function toDateKey(d){ return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-"); }
  function parseDate(key){ const [y,m,d] = key.split("-").map(Number); return new Date(y, m-1, d); }
  function dateForEvent(dateKey, time){
    const m = String(time || "").match(/(\d{1,2}):(\d{2})/);
    if(!m) return null;
    const d = parseDate(dateKey); d.setHours(Number(m[1]), Number(m[2]), 0, 0); return d;
  }
  function dataRow(k, v, copy=false){ return `<div class="data-row ${copy?'copyable':''}" ${copy?`data-copy="${escapeAttr(v)}"`:""}><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`; }
  function mapUrl(query){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || "Amsterdam")}`; }
  function directionsUrl(dest){ return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(HOME_QUERY)}&destination=${encodeURIComponent(dest || "Amsterdam")}&travelmode=walking`; }
  function mapLink(query, label="Maps", cls=""){ return `<a class="${cls}" href="${mapUrl(query)}" target="_blank" rel="noopener">📍 ${escapeHtml(label)}</a>`; }
  function directionsLink(query, label="Cómo ir"){ return `<a href="${directionsUrl(query)}" target="_blank" rel="noopener">🧭 ${escapeHtml(label)}</a>`; }
  function labelCategory(c){ return ({food:"Comida", flight:"Vuelo", transport:"Trayecto", museum:"Museo", walk:"Paseo", hotel:"Hotel", booking:"Reserva", market:"Mercado", activity:"Actividad"})[c] || "Actividad"; }
  function getLeadingEmoji(text){ const m = String(text).trim().match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\uFE0F)?)/u); return m ? m[1] : ""; }
  function stripLeadingEmoji(text){ return String(text || "").replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\ufe0f?\s*/u, ""); }
  function hay(obj, q){ return JSON.stringify(obj).toLowerCase().includes(q); }
  function escapeHtml(v){ return String(v ?? "").replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }
  function escapeAttr(v){ return escapeHtml(v).replace(/`/g, '&#96;'); }
  async function copyText(text){
    try { await navigator.clipboard.writeText(text); toast("Copiado"); } catch { toast("No se pudo copiar"); }
  }
  function toast(text){
    const el = document.createElement("div"); el.className = "toast"; el.textContent = text; document.body.appendChild(el);
    setTimeout(()=>el.remove(), 1600);
  }
  function registerServiceWorker(){
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }
})();
