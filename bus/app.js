const $ = (selector) => document.querySelector(selector);
const destinationInput = $('#destination');
const locationText = $('#locationText');
const locateButton = $('#locateButton');
const clearButton = $('#clearButton');
const favoritesEl = $('#favorites');
const favoritesSection = $('#favoritesSection');
const toast = $('#toast');

let position = null;
let editingFavorites = false;
let toastTimer;

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
  const params = new URLSearchParams({
    api: '1',
    destination,
    travelmode: 'transit',
    transit_mode: 'bus'
  });
  if (position) params.set('origin', `${position.latitude},${position.longitude}`);
  return `https://www.google.com/maps/dir/?${params}`;
};

const openRoute = (destination) => {
  const value = destination.trim();
  if (!value) {
    destinationInput.focus();
    showToast('Escribe primero a dónde quieres ir');
    return;
  }
  window.location.href = routeUrl(value);
};

const locate = () => {
  if (!navigator.geolocation) {
    locationText.textContent = 'Este navegador no permite ubicación';
    showToast('Puedes continuar escribiendo el destino');
    return;
  }
  locateButton.disabled = true;
  locateButton.textContent = 'Buscando…';
  locationText.textContent = 'Localizando tu iPhone…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      position = { latitude: coords.latitude, longitude: coords.longitude };
      locationText.textContent = 'Ubicación actual detectada';
      locateButton.textContent = 'Actualizar';
      locateButton.disabled = false;
      showToast('Ubicación lista');
    },
    (error) => {
      locationText.textContent = error.code === 1 ? 'Permiso de ubicación no concedido' : 'No hemos podido localizarte';
      locateButton.textContent = 'Reintentar';
      locateButton.disabled = false;
      showToast('Puedes continuar: Maps pedirá tu punto de salida');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
};

const renderFavorites = () => {
  const favorites = getFavorites();
  favoritesSection.hidden = favorites.length === 0;
  favoritesEl.classList.toggle('editing', editingFavorites);
  favoritesEl.replaceChildren(...favorites.map((favorite, index) => {
    const card = document.createElement('div');
    card.className = 'favorite';
    card.innerHTML = `<button type="button" class="favorite-main"><span aria-hidden="true">★</span><strong></strong></button><button type="button" class="delete-favorite" aria-label="Eliminar destino">×</button>`;
    card.querySelector('strong').textContent = favorite.name;
    card.querySelector('.delete-favorite').setAttribute('aria-label', `Eliminar ${favorite.name}`);
    card.querySelector('.favorite-main').addEventListener('click', () => {
      if (!editingFavorites) openRoute(favorite.address);
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

locateButton.addEventListener('click', locate);
$('#locationCard').addEventListener('click', (event) => {
  if (event.target !== locateButton && !position) locate();
});

destinationInput.addEventListener('input', () => { clearButton.hidden = !destinationInput.value; });
clearButton.addEventListener('click', () => {
  destinationInput.value = '';
  clearButton.hidden = true;
  destinationInput.focus();
});

$('#routeForm').addEventListener('submit', (event) => {
  event.preventDefault();
  openRoute(destinationInput.value);
});

$('#nearbyButton').addEventListener('click', () => {
  const query = position
    ? `parada de autobús cerca de ${position.latitude},${position.longitude}`
    : 'parada de autobús cerca de mí';
  window.location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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
  $('#favoriteName').value = '';
  $('#saveDialog').showModal();
  setTimeout(() => $('#favoriteName').focus(), 80);
});

$('#saveForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const favorites = getFavorites();
  favorites.push({ name: $('#favoriteName').value.trim(), address: destinationInput.value.trim() });
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
