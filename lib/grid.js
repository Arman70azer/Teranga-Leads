// Découpage d'une ville en carrés de recherche (partagé entre la popup et le content script).
// Un carré = { lat, lng, size } : centre + côté en mètres.
// Un contour = tableau de polygones, chaque polygone = tableau d'anneaux [[lng, lat], ...]
// (le premier anneau est l'extérieur, les suivants sont des trous) — format GeoJSON.

var MSE_GRID = (function () {
  var M_PER_DEG_LAT = 111320;
  var INITIAL_SIZE = 1000;
  var MIN_SIZE = 250;
  var SATURATION = 100; // nombre de résultats à partir duquel on redécoupe

  function degLat(m) { return m / M_PER_DEG_LAT; }
  function degLng(m, lat) { return m / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180)); }

  function cellBounds(cell) {
    var hl = degLat(cell.size / 2);
    var hg = degLng(cell.size / 2, cell.lat);
    return { south: cell.lat - hl, north: cell.lat + hl, west: cell.lng - hg, east: cell.lng + hg };
  }

  // GeoJSON (Polygon | MultiPolygon) -> tableau de polygones
  function fromGeoJson(geo) {
    if (!geo) return null;
    if (geo.type === 'Polygon') return [geo.coordinates];
    if (geo.type === 'MultiPolygon') return geo.coordinates;
    return null;
  }

  // Carré de secours autour d'un point (ville sans contour dans OSM).
  function squareAround(lat, lng, sizeM) {
    var b = cellBounds({ lat: lat, lng: lng, size: sizeM });
    return {
      bbox: b,
      polygon: [[[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]]]
    };
  }

  function inRing(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(lat, lng, polygons) {
    if (!polygons) return true;
    for (var p = 0; p < polygons.length; p++) {
      var rings = polygons[p];
      if (!inRing(lat, lng, rings[0])) continue;
      var inHole = false;
      for (var h = 1; h < rings.length; h++) {
        if (inRing(lat, lng, rings[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  function cellTouchesPolygon(cell, polygons) {
    if (!polygons) return true;
    var b = cellBounds(cell);
    var pts = [[cell.lat, cell.lng], [b.south, b.west], [b.south, b.east], [b.north, b.west], [b.north, b.east]];
    for (var i = 0; i < pts.length; i++) {
      if (pointInPolygon(pts[i][0], pts[i][1], polygons)) return true;
    }
    // Un sommet du contour dans le carré (ville plus petite que le carré, presqu'île…)
    for (var p = 0; p < polygons.length; p++) {
      var ring = polygons[p][0];
      for (var k = 0; k < ring.length; k++) {
        var lng = ring[k][0], lat = ring[k][1];
        if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) return true;
      }
    }
    return false;
  }

  function buildGrid(bbox, polygons, sizeM) {
    sizeM = sizeM || INITIAL_SIZE;
    var cells = [];
    var midLat = (bbox.south + bbox.north) / 2;
    var stepLat = degLat(sizeM);
    var stepLng = degLng(sizeM, midLat);
    for (var lat = bbox.south + stepLat / 2; lat < bbox.north + stepLat / 2; lat += stepLat) {
      for (var lng = bbox.west + stepLng / 2; lng < bbox.east + stepLng / 2; lng += stepLng) {
        var cell = { lat: round(lat), lng: round(lng), size: sizeM };
        if (cellTouchesPolygon(cell, polygons)) cells.push(cell);
      }
    }
    return cells;
  }

  function subdivide(cell) {
    var half = cell.size / 2;
    var ql = degLat(half / 2);
    var qg = degLng(half / 2, cell.lat);
    return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(function (d) {
      return { lat: round(cell.lat + d[0] * ql), lng: round(cell.lng + d[1] * qg), size: half };
    });
  }

  // 1 km -> 16, 500 m -> 17, 250 m -> 18
  function zoomForSize(sizeM) {
    return Math.max(12, Math.min(19, Math.round(16 + Math.log2(INITIAL_SIZE / sizeM))));
  }

  function round(x) { return Math.round(x * 1e6) / 1e6; }

  return {
    INITIAL_SIZE: INITIAL_SIZE,
    MIN_SIZE: MIN_SIZE,
    SATURATION: SATURATION,
    CATEGORIES: [
      { cat: 'restaurants', label: 'Restaurant' },
      { cat: 'hôtels', label: 'Hôtel' }
    ],
    fromGeoJson: fromGeoJson,
    squareAround: squareAround,
    pointInPolygon: pointInPolygon,
    cellTouchesPolygon: cellTouchesPolygon,
    buildGrid: buildGrid,
    subdivide: subdivide,
    zoomForSize: zoomForSize,
    // Toutes les tâches de départ : chaque carré × chaque catégorie (restaurants d'abord).
    buildTasks: function (cells) {
      var tasks = [];
      this.CATEGORIES.forEach(function (c) {
        cells.forEach(function (cell) {
          tasks.push({ lat: cell.lat, lng: cell.lng, size: cell.size, cat: c.cat, label: c.label });
        });
      });
      return tasks;
    },
    taskKey: function (t) { return t.cat + '|' + t.lat + '|' + t.lng + '|' + t.size; },
    taskUrl: function (t) {
      return 'https://www.google.com/maps/search/' + encodeURIComponent(t.cat) + '/@' +
        t.lat + ',' + t.lng + ',' + zoomForSize(t.size) + 'z?hl=fr';
    }
  };
})();

if (typeof module !== 'undefined') module.exports = MSE_GRID;
