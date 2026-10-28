const DATA_DIR = '../json/covid19json/';
const DATA_URL = `${DATA_DIR}covid19_summary.json`;
const TITLES = {
  country_summary: 'Resumen por país', latest: 'Último registro',
  top10_countries: 'Top 10 · serie histórica', complete: 'Histórico completo',
  data_verification_report: 'Verificación de datos', data_dictionary: 'Diccionario de variables',
  sample_submission_format: 'Formato de ejemplo'
};
const NUMBER_FORMAT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const el = Object.fromEntries(['dataset','search','country','metric','date-from','date-to','country-wrap','metric-wrap','from-wrap','to-wrap','status','stats','chart-panel','chart','chart-title','chart-unit','chart-note','table-title','table-head','table-body','table-note','result-count'].map(id=>[id,document.getElementById(id)]));
let data, completeCache=new Map(), currentRows=[], currentColumns=[], resizeObserver;

function rowsOf(table){return table.rows.map(values=>Object.fromEntries(table.columns.map((key,i)=>[key,values[i]??null])))}
function fmt(value){if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return '—';return NUMBER_FORMAT.format(Number(value))}
function niceName(key){return key.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}
function showError(message){el.status.textContent=message;el.status.classList.add('error')}

async function init(){
  try{
    el.status.textContent='Cargando el archivo de datos…';
    const response=await fetch(DATA_URL);
    if(!response.ok)throw new Error(`No se pudo cargar el JSON (${response.status}).`);
    data=await response.json();
    const names=rowsOf(data.datasets.latest).filter(row=>String(row.iso_code??'').length===3).map(row=>row.location).filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'));
    el.country.innerHTML='<option value="">Todos</option>'+names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    el.status.textContent=`Índice cargado · ${fmt(data.metadata.complete_rows)} filas históricas en ${data.metadata.complete_chunks.length} archivos · ${data.metadata.date_range}`;
    el.status.classList.remove('error');
    render();
    el.dataset.addEventListener('change',async()=>{
      if(el.dataset.value==='complete'){
        data.datasets.complete={source:data.metadata.sources.complete,columns:completeColumnNames(),rows:[]};
        if(el.country.value){try{await loadComplete(el.country.value)}catch(error){showError(error.message)}}
        else el.status.textContent='Elige un país para cargar sus datos históricos.';
      }
      render();
    });
    el.country.addEventListener('change',async()=>{
      if(el.dataset.value==='complete'&&el.country.value){
        try{await loadComplete(el.country.value)}catch(error){showError(error.message)}
      }else if(el.dataset.value==='complete'){
        data.datasets.complete={source:data.metadata.sources.complete,columns:completeColumnNames(),rows:[]};
        el.status.textContent='Elige un país para cargar sus datos históricos.';
      }
      render();
    });
    ['search','metric','date-from','date-to'].forEach(id=>el[id].addEventListener(id==='search'?'input':'change',render));
    resizeObserver=new ResizeObserver(()=>drawChart());resizeObserver.observe(el.chart.parentElement);
  }catch(error){showError(`${error.message} Comprueba que la web se sirve por HTTP y que ${DATA_URL} existe.`)}
}
function completeColumnNames(){
  const dictionary=data.datasets.data_dictionary,index=dictionary.columns.indexOf('Column');
  return dictionary.rows.map(row=>row[index]);
}
async function loadComplete(country){
  if(completeCache.has(country)){
    data.datasets.complete=completeCache.get(country);
    el.status.textContent=`Histórico cargado · ${fmt(data.datasets.complete.rows.length)} filas de ${country}`;
    return;
  }
  const columns=completeColumnNames(),locationIndex=columns.indexOf('location'),rows=[];
  const chunks=data.metadata.complete_chunks.filter(chunk=>chunk.locations.includes(country));
  for(let i=0;i<chunks.length;i++){
    const chunk=chunks[i];
    el.status.textContent=`Cargando ${country} · parte ${i+1} de ${chunks.length}…`;
    const response=await fetch(`${DATA_DIR}${chunk.file}`);
    if(!response.ok)throw new Error(`No se pudo cargar ${chunk.file} (${response.status}).`);
    const part=await response.json();
    for(const row of part.rows)if(row[locationIndex]===country)rows.push(row);
  }
  const table={source:data.metadata.sources.complete,columns,rows};
  completeCache.set(country,table);
  data.datasets.complete=table;
  el.status.textContent=`Histórico cargado · ${fmt(rows.length)} filas de ${country}`;
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toggleFilters(isHistorical){['country-wrap','metric-wrap','from-wrap','to-wrap'].forEach(id=>el[id].hidden=!isHistorical)}

function render(){
  if(!data)return;
  const key=el.dataset.value, isHistorical=key==='complete'||key==='top10_countries';
  toggleFilters(isHistorical);
  const table=data.datasets[key]||(key==='complete'?{columns:completeColumnNames(),rows:[]}:null);
  currentColumns=table.columns;
  currentRows=table.rows;
  const query=el.search.value.trim().toLocaleLowerCase('es');
  let filtered=currentRows;
  if(query){
    const searchable=isHistorical?['location','iso_code','continent','date']:currentColumns;
    const indexes=searchable.map(column=>currentColumns.indexOf(column)).filter(index=>index>=0);
    filtered=filtered.filter(row=>indexes.some(index=>String(row[index]??'').toLocaleLowerCase('es').includes(query)));
  }
  if(isHistorical){
    const country=el.country.value;
    const locationIndex=currentColumns.indexOf('location');
    if(country)filtered=filtered.filter(row=>row[locationIndex]===country);
    const from=el['date-from'].value,to=el['date-to'].value;
    const dateIndex=currentColumns.indexOf('date');
    if(from)filtered=filtered.filter(row=>row[dateIndex]>=from);
    if(to)filtered=filtered.filter(row=>row[dateIndex]<=to);
  }
  el['table-title'].textContent=TITLES[key];
  el['chart-panel'].hidden=!isHistorical;
  renderStats(key,filtered,currentColumns);
  renderTable(filtered,currentColumns);
  if(isHistorical)drawChart(filtered,currentColumns);
}
function renderStats(key,rows,columns){
  const chosen=(key==='complete'||key==='top10_countries')?el.country.value:'';
  if(key==='country_summary'||key==='latest'){
    let summaryRows=rowsOf(data.datasets.country_summary).filter(row=>!chosen||row.location===chosen);
    const latest=rowsOf(data.datasets.latest).filter(row=>String(row.iso_code??'').length===3&&(!chosen||row.location===chosen));
    const total=(field)=>latest.reduce((sum,row)=>sum+(Number(row[field])||0),0);
    const items=[['Países',chosen?'1':String(latest.length),'en la vista'],['Casos acumulados',fmt(chosen?summaryRows[0]?.total_cases:total('total_cases')),'casos confirmados'],['Muertes acumuladas',fmt(chosen?summaryRows[0]?.total_deaths:total('total_deaths')),'muertes notificadas'],['Vacunación',chosen?`${fmt(summaryRows[0]?.vaccination_rate)}%`:'—','personas vacunadas (%)']];
    el.stats.innerHTML=items.map(([label,value,sub])=>`<article class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></article>`).join('');
  }else if(key==='complete'||key==='top10_countries'){
    const loc=columns.indexOf('location'),caseIndex=columns.indexOf('total_cases'),deathIndex=columns.indexOf('total_deaths');
    const countries=new Set();let maxCases=0,maxDeaths=0;
    for(const row of rows){if(row[loc])countries.add(row[loc]);maxCases=Math.max(maxCases,Number(row[caseIndex])||0);maxDeaths=Math.max(maxDeaths,Number(row[deathIndex])||0)}
    const items=[['Filas',fmt(rows.length),'según filtros'],['Países',fmt(countries.size),'en la selección'],['Casos acumulados',fmt(maxCases),'máximo visible'],['Muertes acumuladas',fmt(maxDeaths),'máximo visible']];
    el.stats.innerHTML=items.map(([label,value,sub])=>`<article class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></article>`).join('');
  }else el.stats.innerHTML=`<article class="stat"><div class="stat-label">Filas</div><div class="stat-value">${fmt(rows.length)}</div><div class="stat-sub">${TITLES[key]}</div></article>`;
}
function renderTable(rows,columns){
  const cap=250, shown=rows.slice(0,cap);
  el['table-head'].innerHTML=`<tr>${columns.map(col=>`<th>${escapeHtml(niceName(col))}</th>`).join('')}</tr>`;
  el['result-count'].textContent=`${fmt(rows.length)} resultados`;
  el['table-body'].innerHTML=shown.length?shown.map(row=>`<tr>${columns.map((col,index)=>{const value=row[index];const numeric=typeof value==='number';return `<td${numeric?' class="num"':''}>${escapeHtml(numeric?fmt(value):value??'—')}</td>`}).join('')}</tr>`).join(''):`<tr><td class="empty" colspan="${columns.length}">No hay resultados para esta búsqueda.</td></tr>`;
  el['table-note'].textContent=rows.length>cap?`Se muestran ${fmt(cap)} filas de ${fmt(rows.length)}. Refina la búsqueda para acotar los resultados.`:'';
}
function drawChart(rows=currentRows,columns=currentColumns){
  if(!data||el['chart-panel'].hidden)return;
  const canvas=el.chart,ctx=canvas.getContext('2d'),box=canvas.getBoundingClientRect();
  if(!box.width||!box.height)return;
  const dpr=window.devicePixelRatio||1;canvas.width=box.width*dpr;canvas.height=box.height*dpr;ctx.scale(dpr,dpr);
  const metric=el.metric.value,country=el.country.value;
  const dateIndex=columns.indexOf('date'),metricIndex=columns.indexOf(metric),grouped=new Map();
  for(const row of rows){const date=row[dateIndex],val=Number(row[metricIndex]);if(!date||!Number.isFinite(val))continue;grouped.set(date,(grouped.get(date)||0)+val)}
  const points=[...grouped].sort((a,b)=>a[0].localeCompare(b[0]));
  const w=box.width,h=box.height,pad={l:62,r:18,t:14,b:32},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  ctx.clearRect(0,0,w,h);ctx.font='10px DM Sans, sans-serif';ctx.fillStyle='#8792a4';ctx.strokeStyle='#edf0f5';ctx.lineWidth=1;
  if(!country||points.length<2){ctx.fillStyle='#8792a4';ctx.fillText('Selecciona un país para ver la serie histórica.',pad.l,h/2);return}
  const vals=points.map(p=>p[1]),max=Math.max(...vals,1),min=Math.min(0,...vals),range=max-min||1;
  for(let i=0;i<=4;i++){const y=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(fmt(max-(range*i/4)),4,y+3)}
  ctx.beginPath();points.forEach(([date,value],i)=>{const x=pad.l+pw*i/(points.length-1),y=pad.t+ph*(max-value)/range;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle='#4169e1';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();
  const fill=ctx.createLinearGradient(0,pad.t,0,pad.t+ph);fill.addColorStop(0,'rgba(65,105,225,.19)');fill.addColorStop(1,'rgba(65,105,225,0)');ctx.lineTo(pad.l+pw,pad.t+ph);ctx.lineTo(pad.l,pad.t+ph);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  ctx.fillStyle='#8792a4';ctx.fillText(points[0][0],pad.l,h-7);const last=points.at(-1)[0];ctx.textAlign='right';ctx.fillText(last,w-pad.r,h-7);ctx.textAlign='left';
  el['chart-title'].textContent=`${niceName(metric)} · ${country}`;
  el['chart-unit'].textContent=metric.includes('per_hundred')?'%':'Casos / muertes';
  el['chart-note'].textContent='Serie diaria del país seleccionado.';
}
init();
