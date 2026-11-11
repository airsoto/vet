const state = {
  species: 'feline',
  data: { feline: null, canine: null },
  selected: new Map(),
  specialty: 'Todas',
  search: '',
  results: []
};

const $ = (selector) => document.querySelector(selector);
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const speciesLabel = () => state.species === 'feline' ? 'Gato' : 'Perro';

async function loadData() {
  const urls = {
    feline: '../json/consultant_signs_feline_ES.json',
    canine: '../json/consultant_signs_canine_ES.json'
  };
  try {
    [state.data.feline, state.data.canine] = await Promise.all(Object.values(urls).map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
      return response.json();
    })));
    $('#data-status').textContent = 'Bases cargadas · 2 especies';
    renderSpecialties();
    renderFindings();
  } catch (error) {
    $('#data-status').textContent = 'No se pudo cargar la base';
    $('#finding-list').innerHTML = '<div class="no-results">Abre la aplicación desde un servidor local para permitir la carga de los JSON.</div>';
    console.error(error);
  }
}

function currentItems() { return state.data[state.species]?.[0]?.items || []; }
function findingId(item) { return `${item.meta?.sign_code || ''}¦${item.Proceso}`; }

function renderSpecialties() {
  const specialties = [...new Set(currentItems().map((item) => item.especialidades).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#specialty-filters').innerHTML = ['Todas', ...specialties].map((specialty) => `<button type="button" class="specialty-chip ${state.specialty === specialty ? 'active' : ''}" data-specialty="${escapeHtml(specialty)}">${escapeHtml(specialty)}</button>`).join('');
  $('#specialty-filters').querySelectorAll('[data-specialty]').forEach((button) => button.addEventListener('click', () => {
    state.specialty = button.dataset.specialty;
    renderSpecialties();
    renderFindings();
  }));
}

function renderFindings() {
  const query = normalize(state.search);
  const items = currentItems().filter((item) => {
    const matchesSpecialty = state.specialty === 'Todas' || item.especialidades === state.specialty;
    return matchesSpecialty && (!query || normalize(`${item.Proceso} ${item.especialidades}`).includes(query));
  });
  $('#finding-list').innerHTML = items.length ? items.map((item) => {
    const id = findingId(item);
    const checked = state.selected.has(id) ? 'checked' : '';
    return `<label class="finding-row"><input type="checkbox" data-finding-id="${escapeHtml(id)}" ${checked}><span class="finding-copy">${escapeHtml(item.Proceso)}<small class="finding-specialty">${escapeHtml(item.especialidades || 'General')}</small></span></label>`;
  }).join('') : '<div class="no-results">No hay hallazgos que coincidan con esa búsqueda.</div>';
  $('#finding-list').querySelectorAll('[data-finding-id]').forEach((input) => input.addEventListener('change', () => toggleFinding(input.dataset.findingId)));
}

function toggleFinding(id) {
  const item = currentItems().find((candidate) => findingId(candidate) === id);
  if (!item) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.set(id, { item, principal: false });
  renderSelected();
  renderFindings();
}

function renderSelected() {
  const list = $('#selected-list');
  const selected = [...state.selected.values()];
  $('#selection-count').textContent = `${selected.length} seleccionado${selected.length === 1 ? '' : 's'}`;
  $('#analyse-button').disabled = selected.length === 0;
  list.classList.toggle('empty', selected.length === 0);
  list.innerHTML = selected.length ? selected.map(({ item, principal }) => `<div class="selected-item"><p>${escapeHtml(item.Proceso)}<small>${escapeHtml(item.especialidades || 'General')} · ${principal ? 'Principal ×2' : 'Secundario ×1'}</small></p><button type="button" class="star-button ${principal ? 'principal' : ''}" data-star-id="${escapeHtml(findingId(item))}" aria-label="${principal ? 'Marcar como secundario' : 'Marcar como principal'}">★</button></div>`).join('') : '<div class="empty-state"><span>＋</span><p>Añade hallazgos desde la lista.<br><small>Se incorporan como secundarios; marca ★ para hacerlos principales.</small></p></div>';
  list.querySelectorAll('[data-star-id]').forEach((button) => button.addEventListener('click', () => {
    const selectedFinding = state.selected.get(button.dataset.starId);
    selectedFinding.principal = !selectedFinding.principal;
    renderSelected();
  }));
}

function analyse() {
  const selected = [...state.selected.values()];
  const totalWeight = selected.reduce((total, entry) => total + (entry.principal ? 2 : 1), 0);
  const diagnosisMap = new Map();
  selected.forEach(({ item, principal }) => {
    const weight = principal ? 2 : 1;
    [...new Set(item['Diagnósticos diferenciales'] || [])].forEach((diagnosis) => {
      if (!diagnosisMap.has(diagnosis)) diagnosisMap.set(diagnosis, { diagnosis, weight: 0, findings: [], urls: [] });
      const result = diagnosisMap.get(diagnosis);
      result.weight += weight;
      result.findings.push({ name: item.Proceso, principal });
      if (item.meta?.url) result.urls.push(item.meta.url);
    });
  });
  state.results = [...diagnosisMap.values()].map((result) => ({ ...result, score: result.weight / totalWeight })).sort((a, b) => b.score - a.score || b.weight - a.weight || a.diagnosis.localeCompare(b.diagnosis, 'es'));
  renderResults();
  $('#results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scoreLevel(score) {
  if (score >= .75) return ['Muy alta', 'very-high', '#188b59'];
  if (score >= .5) return ['Alta', 'high', '#d89024'];
  if (score >= .25) return ['Media', 'medium', '#8d816d'];
  return ['Baja', 'low', '#d26a51'];
}

function renderResults() {
  const list = $('#results-list');
  if (!state.results.length) { list.innerHTML = '<div class="result-placeholder">No se encontraron coincidencias.</div>'; return; }
  $('#result-count').textContent = `${state.results.length} diagnósticos`; 
  list.innerHTML = state.results.slice(0, 60).map((result) => {
    const [level, className, color] = scoreLevel(result.score);
    const percent = Math.round(result.score * 100);
    const link = result.urls[0] ? `<a href="${escapeAttribute(result.urls[0])}" target="_blank" rel="noopener" title="Abrir referencia Cornell">${escapeHtml(result.diagnosis)} ↗</a>` : escapeHtml(result.diagnosis);
    return `<article class="diagnosis-card"><div class="diagnosis-top"><div class="score-ring" style="--score:${percent};--score-color:${color}"><b>${percent}%</b></div><div class="diagnosis-main"><h3>${link}</h3><span class="level ${className}">Coincidencia ${level}</span></div></div><div class="evidence"><div class="evidence-label"><span>${result.weight} de ${selectedWeightTotal()} puntos ponderados</span><span>${result.findings.length} hallazgo${result.findings.length === 1 ? '' : 's'}</span></div><div class="evidence-bar"><i style="--score:${percent}%;--bar-color:${color}"></i></div><div class="matched">${result.findings.map((finding) => `<span class="${finding.principal ? 'principal' : ''}">${finding.principal ? '★ ' : ''}${escapeHtml(finding.name)}</span>`).join('')}</div></div></article>`;
  }).join('');
  if ($('#matrix-toggle').checked) renderMatrix();
}

function selectedWeightTotal() { return [...state.selected.values()].reduce((sum, entry) => sum + (entry.principal ? 2 : 1), 0); }

function renderMatrix() {
  const matrix = $('#matrix-panel');
  if (!state.results.length) { matrix.hidden = true; return; }
  matrix.hidden = false;
  const findings = [...state.selected.values()];
  const rows = state.results.slice(0, 25);
  $('#matrix-wrap').innerHTML = `<table class="matrix-table"><thead><tr><th>Diagnóstico</th>${findings.map(({ item }) => `<th title="${escapeAttribute(item.Proceso)}">${escapeHtml(shorten(item.Proceso, 18))}</th>`).join('')}</tr></thead><tbody>${rows.map((result) => `<tr><td>${escapeHtml(shorten(result.diagnosis, 46))}</td>${findings.map(({ item, principal }) => { const hit = result.findings.some((finding) => finding.name === item.Proceso); return `<td class="${hit ? (principal ? 'principal-hit' : 'hit') : ''}">${hit ? '●' : '·'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}

function shorten(text, max) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttribute(value) { return escapeHtml(value); }

document.querySelectorAll('[data-species]').forEach((button) => button.addEventListener('click', () => {
  state.species = button.dataset.species;
  state.selected.clear(); state.specialty = 'Todas'; state.search = '';
  document.querySelectorAll('[data-species]').forEach((candidate) => { const active = candidate.dataset.species === state.species; candidate.classList.toggle('active', active); candidate.setAttribute('aria-pressed', active); });
  $('#finding-search').value = '';
  renderSpecialties(); renderFindings(); renderSelected();
}));
$('#finding-search').addEventListener('input', (event) => { state.search = event.target.value; renderFindings(); });
$('#clear-selection').addEventListener('click', () => { state.selected.clear(); renderSelected(); renderFindings(); });
$('#analyse-button').addEventListener('click', analyse);
$('#matrix-toggle').addEventListener('change', (event) => { if (event.target.checked) renderMatrix(); else $('#matrix-panel').hidden = true; });
$('#close-matrix').addEventListener('click', () => { $('#matrix-toggle').checked = false; $('#matrix-panel').hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement.tagName !== 'INPUT') { event.preventDefault(); $('#finding-search').focus(); } });
renderSelected();
loadData();
