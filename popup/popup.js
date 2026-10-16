var api = chrome; // chrome.* (callbacks) est aussi supporté par Firefox
var store = api.storage.local;
var PLACE_PREFIX = 'mse_p_';
var HOSTS = ['https://www.google.com/maps/*', 'https://nominatim.openstreetmap.org/*'];

var $ = function (id) { return document.getElementById(id); };

var COLUMNS = [
  ['type', 'Type', 16],
  ['city', 'Ville recherchée', 16],
  ['name', 'Nom', 34],
  ['category', 'Catégorie', 22],
  ['rating', 'Note', 7],
  ['reviews', 'Nombre d\'avis', 13],
  ['price', 'Gamme de prix', 16],
  ['hotelClass', 'Classement hôtel', 16],
  ['address', 'Adresse', 45],
  ['phone', 'Téléphone', 18],
  ['website', 'Site web', 35],
  ['email', 'Email', 28],
  ['plusCode', 'Plus code', 22],
  ['hours', 'Horaires', 60],
  ['description', 'Description', 60],
  ['services', 'Services / équipements', 60],
  ['lat', 'Latitude', 12],
  ['lng', 'Longitude', 12],
  ['url', 'Lien Google Maps', 50],
  ['extractedAt', 'Date d\'extraction', 19]
];

var placeCount = 0;

function get(keys) { return new Promise(function (r) { store.get(keys, r); }); }
function set(obj) { return new Promise(function (r) { store.set(obj, r); }); }
function remove(keys) { return new Promise(function (r) { store.remove(keys, r); }); }

function msg(text) { $('msg').textContent = text || ''; }

async function allPlaces() {
  var all = await get(null);
  return Object.keys(all)
    .filter(function (k) { return k.indexOf(PLACE_PREFIX) === 0; })
    .map(function (k) { return { key: k, place: all[k] }; });
}

// Les popups Firefox ne supportent pas confirm() : petite confirmation intégrée.
function askConfirm(text) {
  return new Promise(function (resolve) {
    var box = document.createElement('div');
    box.className = 'status confirm';
    box.innerHTML = '<div></div><div class="row2"><button class="danger">Oui</button><button class="ghost">Annuler</button></div>';
    box.firstChild.textContent = text;
    document.body.insertBefore(box, document.body.children[1]);
    var btns = box.querySelectorAll('button');
    btns[0].onclick = function () { box.remove(); resolve(true); };
    btns[1].onclick = function () { box.remove(); resolve(false); };
  });
}

// Doit être appelé directement dans un clic (Firefox demande l'accord de l'utilisateur).
function requestHosts() {
  return new Promise(function (resolve) {
    try {
      api.permissions.request({ origins: HOSTS }, function (ok) { resolve(ok !== false); });
    } catch (e) { resolve(true); }
  });
}

async function openTab(url) {
  var tabs = await new Promise(function (r) { api.tabs.query({ active: true, currentWindow: true }, r); });
  var tab = tabs[0];
  if (tab && /^https:\/\/www\.google\.[a-z.]+\/maps/.test(tab.url || '')) api.tabs.update(tab.id, { url: url });
  else api.tabs.create({ url: url, active: true });
}

// ---------- Délimitation de la ville (OpenStreetMap / Nominatim) ----------
function cityKey(city) {
  return city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Contours déjà téléchargés : OpenStreetMap n'est appelé qu'une seule fois par ville.
async function geocodeCached(city) {
  var cache = (await get('mse_areas')).mse_areas || {};
  var key = cityKey(city);
  if (cache[key]) return cache[key];
  var area = await geocode(city);
  cache[key] = area;
  await set({ mse_areas: cache });
  return area;
}

async function geocode(city) {
  var params = new URLSearchParams({
    q: city, countrycodes: 'sn', format: 'jsonv2', limit: '1',
    polygon_geojson: '1', polygon_threshold: '0.0005', 'accept-language': 'fr'
  });
  var res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
  if (!res.ok) throw new Error('OpenStreetMap indisponible (' + res.status + ')');
  var data = await res.json();
  if (!data.length) throw new Error('Ville introuvable au Sénégal : « ' + city + ' »');

  var r = data[0];
  var bb = r.boundingbox.map(Number); // [sud, nord, ouest, est]
  var area = {
    name: r.display_name,
    bbox: { south: bb[0], north: bb[1], west: bb[2], east: bb[3] },
    polygon: MSE_GRID.fromGeoJson(r.geojson),
    fallback: false
  };
  var tooSmall = (bb[1] - bb[0]) < 0.009 || (bb[3] - bb[2]) < 0.009; // < ~1 km
  if (!area.polygon || tooSmall) {
    var sq = MSE_GRID.squareAround(Number(r.lat), Number(r.lon), 5000);
    area.bbox = sq.bbox;
    area.polygon = sq.polygon;
    area.fallback = true;
  }
  return area;
}

async function startJob(city, area, withServices) {
  var cells = MSE_GRID.buildGrid(area.bbox, area.polygon);
  var queue = MSE_GRID.buildTasks(cells);
  var job = {
    id: Date.now().toString(36),
    city: city,
    areaName: area.name,
    queue: queue,
    doneTasks: 0,
    totalTasks: queue.length,
    withServices: withServices,
    status: 'running',
    owner: null,
    heartbeat: 0,
    navigatedTo: MSE_GRID.taskKey(queue[0]),
    message: 'Démarrage…',
    startedAt: new Date().toISOString()
  };
  await set({ mse_job: job, mse_area: area, mse_last_city: city });
  await openTab(MSE_GRID.taskUrl(queue[0]));
}

async function resumeJob() {
  var job = (await get('mse_job')).mse_job;
  if (!job || !job.queue.length) return;
  job.status = 'running';
  job.owner = null;
  job.heartbeat = 0;
  job.navigatedTo = MSE_GRID.taskKey(job.queue[0]);
  job.message = 'Reprise…';
  await set({ mse_job: job });
  await openTab(MSE_GRID.taskUrl(job.queue[0]));
}

// ---------- Affichage ----------
async function refresh() {
  var job = (await get('mse_job')).mse_job;
  $('count').textContent = placeCount;
  $('export').disabled = placeCount === 0;

  $('jobBox').hidden = !job;
  if (!job) return;

  var labels = { running: 'En cours', stopped: 'En pause', done: 'Terminée' };
  var pct = Math.round(100 * job.doneTasks / Math.max(1, job.totalTasks));
  $('jobTitle').textContent = job.city + ' — ' + (labels[job.status] || job.status);
  $('bar').style.width = (job.status === 'done' ? 100 : pct) + '%';
  $('jobStats').textContent = job.doneTasks + ' / ' + job.totalTasks + ' carrés traités (' + pct + ' %) · ' +
    job.queue.length + ' restant(s)';
  $('state').textContent = job.message || '';

  var running = job.status === 'running';
  $('resume').hidden = running || job.status === 'done';
  $('stop').hidden = !running;
  $('start').textContent = running ? 'Extraction en cours…' : 'Lancer l\'extraction';
  $('start').disabled = running;
}

// ---------- Actions ----------
$('form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var granted = requestHosts(); // appelé tout de suite, dans le clic
  var city = $('city').value.trim();
  if (!city) return;
  if (!(await granted)) { msg('Autorisation refusée : l\'extension ne peut pas accéder à Google Maps.'); return; }

  var job = (await get('mse_job')).mse_job;
  if (job && job.status !== 'done' && job.queue.length) {
    if (job.city.toLowerCase() === city.toLowerCase()) { await resumeJob(); refresh(); return; }
    var ok = await askConfirm('Une extraction de « ' + job.city + ' » n\'est pas terminée. La remplacer par « ' +
      city + ' » ? (les fiches déjà enregistrées sont conservées)');
    if (!ok) return;
  }

  $('start').disabled = true;
  msg('Recherche des limites de « ' + city + ' » sur OpenStreetMap…');
  try {
    var area = await geocodeCached(city);
    var cells = MSE_GRID.buildGrid(area.bbox, area.polygon);
    var note = area.fallback ? ' (contour introuvable : carré de 5 km autour du centre)' : '';
    var ok2 = await askConfirm('Zone trouvée : ' + area.name + note + '. ' + cells.length +
      ' carrés de 1 km × 2 catégories = ' + (cells.length * 2) +
      ' recherches (les zones denses seront redécoupées). Lancer ?');
    if (!ok2) { msg(''); $('start').disabled = false; return; }
    await startJob(city, area, $('withServices').checked);
    msg('');
  } catch (err) {
    msg(err.message);
  }
  $('start').disabled = false;
  refresh();
});

$('resume').addEventListener('click', async function () {
  var granted = requestHosts();
  if (!(await granted)) return;
  await resumeJob();
  refresh();
});

$('stop').addEventListener('click', async function () {
  var job = (await get('mse_job')).mse_job;
  if (job) {
    job.status = 'stopped';
    job.message = 'Arrêté par l\'utilisateur';
    await set({ mse_job: job });
  }
  refresh();
});

$('restart').addEventListener('click', async function () {
  var granted = requestHosts();
  var data = await get(['mse_job', 'mse_area']);
  var job = data.mse_job;
  if (!job || !data.mse_area) return;
  var ok = await askConfirm('Recommencer « ' + job.city + ' » à zéro ? La progression et les fiches de cette ville seront supprimées.');
  if (!ok || !(await granted)) return;
  var keys = (await allPlaces())
    .filter(function (p) { return p.place.city === job.city; })
    .map(function (p) { return p.key; });
  await remove(keys);
  await startJob(job.city, data.mse_area, job.withServices);
  refresh();
});

$('clear').addEventListener('click', async function () {
  var ok = await askConfirm('Supprimer toutes les fiches enregistrées et la progression ?');
  if (!ok) return;
  var keys = (await allPlaces()).map(function (p) { return p.key; });
  await remove(keys.concat(['mse_job', 'mse_area', 'mse_places']));
  placeCount = 0;
  refresh();
});

$('export').addEventListener('click', async function () {
  var list = (await allPlaces()).map(function (p) { return p.place; });
  if (!list.length) return;

  list.sort(function (a, b) {
    return (a.city || '').localeCompare(b.city || '') ||
      (a.type || '').localeCompare(b.type || '') ||
      (a.name || '').localeCompare(b.name || '');
  });

  var rows = list.map(function (p) {
    var row = {};
    COLUMNS.forEach(function (c) { row[c[1]] = p[c[0]] === undefined ? '' : p[c[0]]; });
    return row;
  });

  var ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map(function (c) { return c[1]; }) });
  ws['!cols'] = COLUMNS.map(function (c) { return { wch: c[2] }; });
  ws['!autofilter'] = { ref: ws['!ref'] };
  // Téléphones forcés en texte pour garder le "+221" et les espaces.
  var phoneCol = COLUMNS.findIndex(function (c) { return c[0] === 'phone'; });
  for (var r = 1; r <= rows.length; r++) {
    var cell = ws[XLSX.utils.encode_cell({ r: r, c: phoneCol })];
    if (cell) { cell.t = 's'; cell.z = '@'; }
  }

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Établissements');
  var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  var cities = list.map(function (p) { return p.city; }).filter(function (c, i, a) { return c && a.indexOf(c) === i; });
  var cityPart = cities.length === 1 ? cities[0] : 'senegal';
  var slug = cityPart.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  var filename = 'teranga_leads_' + slug + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';

  var blobUrl = URL.createObjectURL(blob);
  try {
    await new Promise(function (resolve, reject) {
      api.downloads.download({ url: blobUrl, filename: filename, saveAs: false }, function (id) {
        if (api.runtime.lastError || id === undefined) reject(api.runtime.lastError);
        else resolve(id);
      });
    });
  } catch (err) {
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
});

// Mise à jour en direct : compteur incrémental (évite de relire tout le stockage).
api.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  var touched = false;
  Object.keys(changes).forEach(function (k) {
    if (k.indexOf(PLACE_PREFIX) !== 0) return;
    if (changes[k].newValue && !changes[k].oldValue) placeCount++;
    else if (!changes[k].newValue && changes[k].oldValue) placeCount--;
    touched = true;
  });
  if (touched || changes.mse_job) refresh();
});

(async function init() {
  var d = await get('mse_last_city');
  if (d.mse_last_city) $('city').value = d.mse_last_city;
  // Migration v1 : toutes les fiches étaient dans un seul objet "mse_places".
  var old = (await get('mse_places')).mse_places;
  if (old) {
    var obj = {};
    Object.keys(old).forEach(function (id) { obj[PLACE_PREFIX + id] = old[id]; });
    await set(obj);
    await remove('mse_places');
  }
  placeCount = (await allPlaces()).length;
  refresh();
})();
