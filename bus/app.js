const $ = (selector) => document.querySelector(selector);
const destinationInput = $('#destination');
const locationText = $('#locationText');
const locateButton = $('#locateButton');
const clearButton = $('#clearButton');
const suggestionsEl = $('#suggestions');
const favoritesEl = $('#favorites');
const favoritesSection = $('#favoritesSection');
const resultsSection = $('#resultsSection');
const routeLoading = $('#routeLoading');
const routeError = $('#routeError');
const routeResults = $('#routeResults');
const toast = $('#toast');

let position = null;
let selectedDestination = null;
let editingFavorites = false;
let toastTimer;
let searchTimer;
let searchController;
let routeController;

const MADRID_BBOX = '-4.7,39.7,-3.0,41.3';
const PHOTON_URL = 'https://photon.komoot.io/api/';
const ROUTER_URL = 'https://api.transitous.org/api/v6/plan';

const getFavorites = () => {
  try { return JSON.parse(localStorage.getItem('mibus-favorites') || '[]'); }
  catch { return []; }
};

const showToast = (message) => {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
};

const routeUrl = (destination) => {
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'transit' });
  if (position) params.set('origin', `${position.latitude},${position.longitude}`);
  return `https://www.google.com/maps/dir/?${params}`;
};

const getPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('Este navegador no permite ubicación'));
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    reject,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

const locate = async () => {
  locateButton.disabled = true;
  locateButton.textContent = 'Buscando…';
  locationText.textContent = 'Localizando tu iPhone…';
  try {
    position = await getPosition();
    locationText.textContent = 'Ubicación actual detectada';
    locateButton.textContent = 'Actualizar';
    showToast('Ubicación lista');
    return position;
  } catch (error) {
    locationText.textContent = error.code === 1 ? 'Permiso de ubicación no concedido' : 'No hemos podido localizarte';
    locateButton.textContent = 'Reintentar';
    showToast('Activa la ubicación para calcular la ruta');
    throw error;
  } finally {
    locateButton.disabled = false;
  }
};

const formatPlace = (feature) => {
  const p = feature.properties || {};
  const primary = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || 'Destino';
  const street = p.street && p.street !== primary ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
  const secondary = [street, p.district, p.city, p.state, p.postcode]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(' · ');
  return { primary, secondary, label: [primary, secondary].filter(Boolean).join(', ') };
};

const hideSuggestions = () => {
  suggestionsEl.hidden = true;
  destinationInput.setAttribute('aria-expanded', 'false');
};

const chooseSuggestion = (feature) => {
  const [lon, lat] = feature.geometry.coordinates;
  const place = formatPlace(feature);
  selectedDestination = { lat, lon, label: place.label, name: place.primary };
  destinationInput.value = place.label;
  clearButton.hidden = false;
  hideSuggestions();
};

const renderSuggestions = (features) => {
  suggestionsEl.replaceChildren();
  if (!features.length) {
    suggestionsEl.innerHTML = '<div class="suggestion-status">No encontramos ese lugar en Madrid</div>';
  } else {
    features.forEach((feature) => {
      const place = formatPlace(feature);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.setAttribute('role', 'option');
      button.innerHTML = '<span class="suggestion-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.16 7-12A7 7 0 1 0 5 9c0 5.84 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg></span><span class="suggestion-copy"><strong></strong><small></small></span>';
      button.querySelector('strong').textContent = place.primary;
      button.querySelector('small').textContent = place.secondary || 'Comunidad de Madrid';
      button.addEventListener('click', () => chooseSuggestion(feature));
      suggestionsEl.append(button);
    });
  }
  suggestionsEl.hidden = false;
  destinationInput.setAttribute('aria-expanded', 'true');
};

const searchPlaces = async (query, { firstOnly = false } = {}) => {
  searchController?.abort();
  searchController = new AbortController();
  const params = new URLSearchParams({ q: query, limit: firstOnly ? '1' : '6', countrycode: 'ES', bbox: MADRID_BBOX });
  if (position) {
    params.set('lat', position.latitude);
    params.set('lon', position.longitude);
    params.set('location_bias_scale', '0.15');
  }
  const response = await fetch(`${PHOTON_URL}?${params}`, { signal: searchController.signal });
  if (!response.ok) throw new Error('No se pudo buscar la dirección');
  const data = await response.json();
  return data.features || [];
};

destinationInput.addEventListener('input', () => {
  selectedDestination = null;
  clearButton.hidden = !destinationInput.value;
  clearTimeout(searchTimer);
  const query = destinationInput.value.trim();
  if (query.length < 3) return hideSuggestions();
  suggestionsEl.innerHTML = '<div class="suggestion-status">Buscando direcciones…</div>';
  suggestionsEl.hidden = false;
  destinationInput.setAttribute('aria-expanded', 'true');
  searchTimer = setTimeout(async () => {
    try { renderSuggestions(await searchPlaces(query)); }
    catch (error) { if (error.name !== 'AbortError') hideSuggestions(); }
  }, 420);
});

document.addEventListener('click', (event) => {
  if (!$('#destinationWrap').contains(event.target)) hideSuggestions();
});

clearButton.addEventListener('click', () => {
  destinationInput.value = '';
  selectedDestination = null;
  clearButton.hidden = true;
  hideSuggestions();
  destinationInput.focus();
});

const formatTime = (iso) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const minutes = (seconds) => Math.max(1, Math.round(seconds / 60));
const cleanLine = (leg) => (leg.routeShortName || leg.displayName || 'Bus').replace(/^(ALSA|CRTM|EMT)\s*-\s*/i, '');

const renderLeg = (leg, index, legs) => {
  const item = document.createElement('li');
  const isBus = leg.mode === 'BUS' || leg.routeType === 3;
  item.className = `leg ${isBus ? 'bus' : 'walk'}`;
  const icon = isBus ? cleanLine(leg) : '↗';
  const title = isBus ? `Coge el bus ${cleanLine(leg)}` : `Camina ${minutes(leg.duration)} min`;
  let description;
  let detail = '';
  if (isBus) {
    description = `En ${leg.from?.name || 'la parada indicada'}`;
    detail = `Dirección ${leg.headsign || leg.tripTo?.name || 'destino'} · Baja en ${leg.to?.name || 'la parada indicada'} a las ${formatTime(leg.endTime)}`;
  } else if (index === legs.length - 1) {
    description = 'Desde la última parada hasta tu destino';
  } else {
    description = `Hasta ${leg.to?.name || 'la parada indicada'}`;
  }
  item.innerHTML = '<span class="leg-icon"></span><div class="leg-copy"><strong></strong><p></p><p class="leg-detail"></p></div>';
  item.querySelector('.leg-icon').textContent = icon;
  item.querySelector('strong').textContent = title;
  item.querySelector('p').textContent = description;
  const detailEl = item.querySelector('.leg-detail');
  detailEl.textContent = detail;
  detailEl.hidden = !detail;
  if (isBus) {
    const status = document.createElement('span');
    status.className = `realtime ${leg.realTime ? '' : 'planned'}`;
    status.textContent = leg.realTime ? '● Tiempo real' : '◷ Horario previsto';
    item.querySelector('.leg-copy').append(status);
    if (leg.intermediateStops?.length) {
      const stops = document.createElement('details');
      stops.className = 'intermediate';
      stops.innerHTML = `<summary>${leg.intermediateStops.length} paradas intermedias</summary><p></p>`;
      stops.querySelector('p').textContent = leg.intermediateStops.map((stop) => stop.name).join(' · ');
      item.querySelector('.leg-copy').append(stops);
    }
  }
  return item;
};

const renderJourney = (journey, index, destination) => {
  const details = document.createElement('details');
  details.className = 'journey';
  details.open = index === 0;
  const busLegs = journey.legs.filter((leg) => leg.mode === 'BUS' || leg.routeType === 3);
  const transferLabel = journey.transfers === 0 ? 'Sin transbordos' : `${journey.transfers} transbordo${journey.transfers > 1 ? 's' : ''}`;
  details.innerHTML = '<summary><span class="journey-time"></span><span class="journey-duration"></span><span class="journey-meta"></span><span class="journey-lines"></span></summary><div class="journey-body"><ol class="timeline"></ol><div class="journey-actions"><a target="_blank" rel="noreferrer">Comprobar en Maps</a><button type="button" class="save-route">Guardar destino</button></div><p class="journey-note">Los horarios pueden cambiar. Comprueba el tiempo real antes de salir.</p></div>';
  details.querySelector('.journey-time').textContent = `${formatTime(journey.startTime)} → ${formatTime(journey.endTime)}`;
  details.querySelector('.journey-duration').textContent = `${minutes(journey.duration)} min`;
  details.querySelector('.journey-meta').textContent = transferLabel;
  const lines = details.querySelector('.journey-lines');
  busLegs.forEach((leg) => {
    const chip = document.createElement('span');
    chip.className = 'line-chip';
    chip.textContent = cleanLine(leg);
    if (/^[0-9a-f]{6}$/i.test(leg.routeColor || '')) chip.style.backgroundColor = `#${leg.routeColor}`;
    lines.append(chip);
  });
  const timeline = details.querySelector('.timeline');
  journey.legs.forEach((leg, legIndex) => timeline.append(renderLeg(leg, legIndex, journey.legs)));
  details.querySelector('a').href = routeUrl(destination.label);
  details.querySelector('.save-route').addEventListener('click', () => {
    destinationInput.value = destination.label;
    selectedDestination = destination;
    $('#saveButton').click();
  });
  return details;
};

const showRouteError = (title, message, destination) => {
  routeLoading.hidden = true;
  routeResults.replaceChildren();
  routeError.hidden = false;
  routeError.innerHTML = '<strong></strong><p></p><a class="secondary-button" target="_blank" rel="noreferrer">Ver ruta completa en Google Maps</a>';
  routeError.querySelector('strong').textContent = title;
  routeError.querySelector('p').textContent = message;
  routeError.querySelector('a').href = routeUrl(destination?.label || destinationInput.value);
};

const planRoute = async (destination) => {
  routeController?.abort();
  routeController = new AbortController();
  resultsSection.hidden = false;
  routeError.hidden = true;
  routeResults.replaceChildren();
  routeLoading.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const params = new URLSearchParams({
    fromPlace: `${position.latitude},${position.longitude}`,
    toPlace: `${destination.lat},${destination.lon}`,
    transitModes: 'BUS',
    directModes: '',
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    maxPreTransitTime: '1800',
    maxPostTransitTime: '1800',
    maxTransfers: '2',
    maxTravelTime: '240',
    detailedLegs: 'true',
    language: 'es'
  });

  try {
    const response = await fetch(`${ROUTER_URL}?${params}`, { signal: routeController.signal });
    if (!response.ok) throw new Error('El servicio de rutas no responde');
    const data = await response.json();
    const journeys = (data.itineraries || [])
      .filter((item) => item.legs?.some((leg) => leg.mode === 'BUS' || leg.routeType === 3))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, 3);
    routeLoading.hidden = true;
    if (!journeys.length) {
      showRouteError('No encontramos un autobús ahora', 'Puede que el trayecto necesite Metro o Cercanías, o que el operador aún no publique este horario. Puedes comprobarlo en Google Maps.', destination);
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'results-heading';
    heading.innerHTML = '<p class="eyebrow">TU RUTA</p><h2></h2><p></p>';
    heading.querySelector('h2').textContent = `Cómo llegar a ${destination.name}`;
    heading.querySelector('p:last-child').textContent = `Estas son las próximas ${journeys.length} opciones en autobús.`;
    routeResults.append(heading, ...journeys.map((journey, index) => renderJourney(journey, index, destination)));
  } catch (error) {
    if (error.name !== 'AbortError') showRouteError('No hemos podido consultar los horarios', 'Revisa la conexión e inténtalo de nuevo. También puedes abrir la ruta completa en Google Maps.', destination);
  }
};

$('#routeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideSuggestions();
  const query = destinationInput.value.trim();
  if (!query) return destinationInput.focus();
  try {
    if (!position) await locate();
    let destination = selectedDestination;
    if (!destination) {
      const [feature] = await searchPlaces(query, { firstOnly: true });
      if (!feature) return showToast('No encontramos ese destino en Madrid');
      const [lon, lat] = feature.geometry.coordinates;
      const place = formatPlace(feature);
      destination = { lat, lon, label: place.label, name: place.primary };
      selectedDestination = destination;
      destinationInput.value = place.label;
    }
    await planRoute(destination);
  } catch { /* El aviso de ubicación ya se muestra en locate(). */ }
});

const renderFavorites = () => {
  const favorites = getFavorites();
  favoritesSection.hidden = favorites.length === 0;
  favoritesEl.classList.toggle('editing', editingFavorites);
  favoritesEl.replaceChildren(...favorites.map((favorite, index) => {
    const card = document.createElement('div');
    card.className = 'favorite';
    card.innerHTML = '<button type="button" class="favorite-main"><span aria-hidden="true">★</span><strong></strong></button><button type="button" class="delete-favorite" aria-label="Eliminar destino">×</button>';
    card.querySelector('strong').textContent = favorite.name;
    card.querySelector('.delete-favorite').setAttribute('aria-label', `Eliminar ${favorite.name}`);
    card.querySelector('.favorite-main').addEventListener('click', () => {
      if (editingFavorites) return;
      destinationInput.value = favorite.address;
      selectedDestination = favorite.lat && favorite.lon ? { lat: favorite.lat, lon: favorite.lon, label: favorite.address, name: favorite.name } : null;
      clearButton.hidden = false;
      $('#routeForm').requestSubmit();
    });
    card.querySelector('.delete-favorite').addEventListener('click', () => {
      const next = getFavorites();
      next.splice(index, 1);
      localStorage.setItem('mibus-favorites', JSON.stringify(next));
      renderFavorites();
    });
    return card;
  }));
};

locateButton.addEventListener('click', () => locate().catch(() => {}));
$('#locationCard').addEventListener('click', (event) => {
  if (event.target !== locateButton && !position) locate().catch(() => {});
});

$('#nearbyButton').addEventListener('click', () => {
  const query = position ? `parada de autobús cerca de ${position.latitude},${position.longitude}` : 'parada de autobús cerca de mí';
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank', 'noopener');
});

$('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

$('#saveButton').addEventListener('click', () => {
  if (!destinationInput.value.trim()) {
    destinationInput.focus();
    showToast('Escribe primero el destino que quieres guardar');
    return;
  }
  $('#favoriteName').value = selectedDestination?.name || '';
  $('#saveDialog').showModal();
  setTimeout(() => $('#favoriteName').focus(), 80);
});

$('#saveForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const favorites = getFavorites();
  favorites.push({
    name: $('#favoriteName').value.trim(),
    address: destinationInput.value.trim(),
    lat: selectedDestination?.lat,
    lon: selectedDestination?.lon
  });
  localStorage.setItem('mibus-favorites', JSON.stringify(favorites.slice(-8)));
  $('#saveDialog').close();
  renderFavorites();
  showToast('Destino guardado en este iPhone');
});

$('#editFavoritesButton').addEventListener('click', (event) => {
  editingFavorites = !editingFavorites;
  event.target.textContent = editingFavorites ? 'Hecho' : 'Editar';
  renderFavorites();
});

renderFavorites();
