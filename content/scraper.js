// Orchestrateur : traite la file de carrés (mse_job.queue) un par un et enregistre les fiches.
// Chaque fiche est stockée sous sa propre clé "mse_p_<id>". Une tâche n'est retirée de la file
// qu'une fois terminée : après une interruption, on reprend sur la même tâche.
(function () {
  if (window.__mseLoaded) return;
  window.__mseLoaded = true;

  var api = chrome; // chrome.* (callbacks) est aussi supporté par Firefox
  var store = api.storage.local;
  var HEARTBEAT_STALE_MS = 30000;
  var PLACE_PREFIX = 'mse_p_';
  var running = false;
  var known = null; // id -> type, fiches déjà enregistrées
  var ui = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter(min, max) { return sleep(min + Math.random() * (max - min)); }

  function get(keys) { return new Promise(function (r) { store.get(keys, r); }); }
  function set(obj) { return new Promise(function (r) { store.set(obj, r); }); }

  function ownerId() {
    var id = sessionStorage.getItem('mse_owner');
    if (!id) {
      id = Math.random().toString(36).slice(2);
      sessionStorage.setItem('mse_owner', id);
    }
    return id;
  }

  async function getJob() { return (await get('mse_job')).mse_job || null; }
  async function updateJob(patch) {
    var job = await getJob();
    if (!job) return null;
    Object.assign(job, patch, { heartbeat: Date.now() });
    await set({ mse_job: job });
    return job;
  }

  async function isStopped() {
    var job = await getJob();
    return !job || job.status !== 'running' || job.owner !== ownerId();
  }

  async function loadKnown() {
    if (known) return known;
    var all = await get(null);
    known = {};
    Object.keys(all).forEach(function (k) {
      if (k.indexOf(PLACE_PREFIX) === 0) known[k.slice(PLACE_PREFIX.length)] = all[k].type || '';
    });
    return known;
  }

  async function savePlace(place) {
    var obj = {};
    obj[PLACE_PREFIX + place.id] = place;
    await set(obj);
    known[place.id] = place.type;
  }

  // Établissement déjà connu trouvé dans une autre catégorie -> "Restaurant, Hôtel"
  async function mergeType(id, label) {
    var types = (known[id] || '').split(', ').filter(Boolean);
    if (types.indexOf(label) >= 0) return;
    var key = PLACE_PREFIX + id;
    var place = (await get(key))[key];
    if (!place) return;
    types.push(label);
    place.type = types.join(', ');
    var obj = {};
    obj[key] = place;
    await set(obj);
    known[id] = place.type;
  }

  function countKnown() { return Object.keys(known || {}).length; }

  // ---------- Panneau flottant ----------
  function buildUi() {
    if (ui) return ui;
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      '.box{font:13px/1.4 system-ui,sans-serif;background:#fff;color:#1f2937;border:1px solid #d1d5db;' +
      'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:12px 14px;width:300px}' +
      '.t{font-weight:600;color:#00853f;margin-bottom:6px}' +
      '.row{margin:2px 0;word-break:break-word}' +
      '.bar{height:6px;background:#e5e7eb;border-radius:3px;margin:6px 0;overflow:hidden}' +
      '.bar i{display:block;height:100%;width:0;background:#00853f;transition:width .3s}' +
      'button{margin-top:8px;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;' +
      'background:#e31b23;color:#fff}' +
      'button.close{background:#6b7280}' +
      '</style>' +
      '<div class="box"><div class="t">Teranga Leads</div>' +
      '<div class="row" id="q"></div><div class="bar"><i id="bar"></i></div>' +
      '<div class="row" id="c"></div><div class="row" id="s"></div>' +
      '<button id="stop">Arrêter</button></div>';
    document.documentElement.appendChild(host);
    var btn = root.getElementById('stop');
    btn.addEventListener('click', async function () {
      if (btn.classList.contains('close')) { host.remove(); ui = null; return; }
      await updateJob({ status: 'stopped', message: 'Arrêté par l\'utilisateur' });
    });
    ui = {
      set: function (q, c, s) {
        if (q !== undefined) root.getElementById('q').textContent = q;
        if (c !== undefined) root.getElementById('c').textContent = c;
        if (s !== undefined) root.getElementById('s').textContent = s;
      },
      progress: function (pct) { root.getElementById('bar').style.width = pct + '%'; },
      finish: function () { btn.textContent = 'Fermer'; btn.classList.add('close'); }
    };
    return ui;
  }

  // ---------- Utilitaires DOM ----------
  async function waitFor(fn, timeout) {
    var start = Date.now();
    while (Date.now() - start < (timeout || 15000)) {
      var v = fn();
      if (v) return v;
      await sleep(300);
    }
    return null;
  }

  function normalize(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function feedLinks(feed) {
    var seen = {};
    var out = [];
    feed.querySelectorAll(MSE_SEL.placeLink).forEach(function (a) {
      var id = msePlaceId(a.href);
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, href: a.href, name: a.getAttribute('aria-label') || '' });
    });
    return out;
  }

  function endOfListReached(feed) {
    return MSE_SEL.endOfListText.test(feed.innerText.slice(-400));
  }

  async function scrollFeed(feed, onProgress) {
    var stableRounds = 0;
    var last = 0;
    while (true) {
      if (await isStopped()) return;
      feed.scrollTop = feed.scrollHeight;
      await jitter(1500, 2500);
      var count = feedLinks(feed).length;
      onProgress(count);
      if (endOfListReached(feed)) return;
      stableRounds = count === last ? stableRounds + 1 : 0;
      if (stableRounds >= 3) return;
      last = count;
      await updateJob({});
    }
  }

  async function openPlace(link) {
    var a = document.querySelector('a[href="' + CSS.escape(link.href) + '"]');
    if (!a) return false;
    a.scrollIntoView({ block: 'center' });
    a.click();
    var target = normalize(link.name);
    var ok = await waitFor(function () {
      var h1 = mseQuery(MSE_SEL.name, mseDetailPanel());
      if (!h1) return false;
      return !target || normalize(h1.textContent) === target;
    }, 12000);
    // Laisse le temps aux boutons (adresse, téléphone…) de s'afficher.
    await sleep(900);
    return !!ok;
  }

  async function extractCurrent(job, task, url) {
    var place = extractPlace(url);
    if (!place.name) return null;
    if (job.withServices) {
      var extra = await extractServices(sleep);
      place.services = extra.services;
      if (!place.description && extra.description) place.description = extra.description;
    }
    place.type = task.label;
    place.city = job.city;
    place.query = task.cat + ' @' + task.lat + ',' + task.lng;
    place.extractedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return place;
  }

  function inCity(area, url) {
    var c = mseCoordsFromUrl(url);
    if (c.lat === '') return true; // pas de coordonnées : on garde
    return MSE_GRID.pointInPolygon(c.lat, c.lng, area && area.polygon);
  }

  function taskLabel(job, task) {
    var n = job.doneTasks + 1;
    var size = task.size >= 1000 ? (task.size / 1000) + ' km' : task.size + ' m';
    return 'Carré ' + n + ' / ' + job.totalTasks + ' · ' + task.label + 's · ' + size;
  }

  // ---------- Traitement d'une tâche (un carré × une catégorie) ----------
  // Renvoie les sous-carrés à ajouter si la recherche est saturée.
  async function runTask(job, area) {
    var task = job.queue[0];
    var u = buildUi();
    u.set(taskLabel(job, task), 'Fiches enregistrées : ' + countKnown(), 'Chargement des résultats…');
    u.progress(Math.round(100 * job.doneTasks / Math.max(1, job.totalTasks)));

    var found = await waitFor(function () {
      return document.querySelector(MSE_SEL.feed) ||
        (/\/maps\/place\//.test(location.href) && mseQuery(MSE_SEL.name) ? 'place' : null);
    }, 12000);

    if (!found) return []; // aucun résultat dans ce carré
    if (found === 'place') {
      // Un seul résultat : Google ouvre directement la fiche.
      var id = msePlaceId(location.href);
      if (known[id] !== undefined) await mergeType(id, task.label);
      else if (inCity(area, location.href)) {
        await sleep(900);
        var single = await extractCurrent(job, task, location.href);
        if (single) { single.id = id; await savePlace(single); }
      }
      return [];
    }

    var feed = found;
    await scrollFeed(feed, function (n) {
      u.set(undefined, 'Résultats chargés : ' + n + ' · Fiches : ' + countKnown(), 'Défilement de la liste…');
    });
    if (await isStopped()) return [];

    var links = feedLinks(feed);
    var children = [];
    if (links.length >= MSE_GRID.SATURATION && task.size / 2 >= MSE_GRID.MIN_SIZE) {
      children = MSE_GRID.subdivide(task)
        .filter(function (c) { return MSE_GRID.cellTouchesPolygon(c, area && area.polygon); })
        .map(function (c) { return { lat: c.lat, lng: c.lng, size: c.size, cat: task.cat, label: task.label }; });
    }

    var fresh = [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (known[l.id] !== undefined) await mergeType(l.id, task.label);
      else if (inCity(area, l.href)) fresh.push(l);
    }

    for (var j = 0; j < fresh.length; j++) {
      if (await isStopped()) return [];
      var link = fresh[j];
      u.set(undefined, 'Nouvelle fiche ' + (j + 1) + ' / ' + fresh.length + ' · Total : ' + countKnown(), link.name);
      if (await openPlace(link)) {
        var place = await extractCurrent(job, task, link.href);
        if (place) {
          place.id = link.id;
          await savePlace(place);
        }
      }
      await updateJob({ message: taskLabel(job, task) + ' — fiche ' + (j + 1) + '/' + fresh.length });
      await jitter(1500, 3000);
    }
    return children;
  }

  function finishUi(title, status) {
    var u = buildUi();
    u.set(title, 'Fiches enregistrées : ' + countKnown(), status);
    u.finish();
  }

  // ---------- Boucle principale ----------
  async function main() {
    if (running) return;
    var job = await getJob();
    if (!job || job.status !== 'running' || !job.queue || !job.queue.length) return;

    var me = ownerId();
    var stale = !job.heartbeat || Date.now() - job.heartbeat > HEARTBEAT_STALE_MS;
    var visible = document.visibilityState === 'visible';
    // Seul l'onglet propriétaire travaille ; un onglet visible peut reprendre une tâche abandonnée.
    var canClaim = job.owner === me || (visible && (!job.owner || stale));
    if (!canClaim) return;

    running = true;
    try {
      job = await updateJob({ owner: me });
      var task = job.queue[0];
      var key = MSE_GRID.taskKey(task);

      // Pas encore sur la page de cette tâche : on y va (la page se recharge, le script reprend).
      if (job.navigatedTo !== key) {
        await updateJob({ navigatedTo: key });
        location.href = MSE_GRID.taskUrl(task);
        return;
      }

      await loadKnown();
      var area = (await get('mse_area')).mse_area || null;
      var children = await runTask(job, area);

      if (await isStopped()) {
        var j = await getJob();
        finishUi('Extraction en pause', ((j && j.message) || 'Arrêté') + ' — reprenez depuis l\'extension.');
        return;
      }

      // Tâche terminée : on la retire, on ajoute les sous-carrés en tête de file.
      job = await getJob();
      if (MSE_GRID.taskKey(job.queue[0]) === key) job.queue.shift();
      job.queue = children.concat(job.queue);
      job.totalTasks += children.length;
      job.doneTasks += 1;
      job.message = children.length ? 'Zone dense : redécoupée en ' + children.length + ' carrés' : '';

      if (!job.queue.length) {
        job.status = 'done';
        job.message = 'Terminé';
        job.heartbeat = Date.now();
        await set({ mse_job: job });
        buildUi().progress(100);
        finishUi('Extraction terminée ✔', 'Ouvrez l\'extension pour exporter vers Excel.');
        return;
      }

      job.navigatedTo = MSE_GRID.taskKey(job.queue[0]);
      job.heartbeat = Date.now();
      await set({ mse_job: job });
      await jitter(800, 1500);
      location.href = MSE_GRID.taskUrl(job.queue[0]);
    } catch (e) {
      console.error('[Teranga Leads]', e);
      await updateJob({ status: 'stopped', message: 'Erreur : ' + e.message });
      finishUi('Erreur', 'Erreur : ' + e.message);
    } finally {
      running = false;
    }
  }

  // Démarrage quand la popup lance/reprend une tâche, ou à chaque chargement de page (reprise).
  api.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.mse_job) return;
    var nv = changes.mse_job.newValue;
    var ov = changes.mse_job.oldValue;
    if (nv && nv.status === 'running' && (!ov || ov.id !== nv.id || ov.status !== 'running')) main();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') main();
  });
  main();
})();
