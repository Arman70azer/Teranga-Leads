// Extraction des informations de la fiche Google Maps actuellement ouverte.

function mseClean(text) {
  return (text || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
}

// Les boutons d'infos ont un aria-label du type "Adresse: Rue X, Dakar".
// On prend le texte visible, sinon la partie après les deux-points.
function mseItemText(el) {
  if (!el) return '';
  var visible = el.querySelector('.Io6YTe, .fontBodyMedium');
  var txt = mseClean(visible ? visible.textContent : '');
  if (txt) return txt;
  var label = el.getAttribute('aria-label') || '';
  var idx = label.indexOf(':');
  return mseClean(idx >= 0 ? label.slice(idx + 1) : label);
}

function mseParseNumber(text) {
  if (!text) return '';
  var m = text.replace(/ | /g, ' ').match(/\d[\d\s.,]*/);
  if (!m) return '';
  var raw = m[0].trim();
  // "1 234" ou "1.234" (milliers) vs "4,5" (décimale)
  if (/^\d{1,3}([\s.]\d{3})+$/.test(raw)) return Number(raw.replace(/[\s.]/g, ''));
  return Number(raw.replace(/\s/g, '').replace(',', '.'));
}

function mseCoordsFromUrl(url) {
  var m = (url || '').match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = (url || '').match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  return { lat: '', lng: '' };
}

function msePlaceId(url) {
  var m = (url || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || (url || '').match(/!19s([^!?]+)/);
  if (m) return m[1];
  return (url || '').split('?')[0];
}

function mseHours(panel) {
  // Le tableau des horaires de la semaine a souvent un aria-label listant tous les jours.
  var nodes = panel.querySelectorAll('[aria-label]');
  for (var i = 0; i < nodes.length; i++) {
    var label = nodes[i].getAttribute('aria-label');
    if (/(lundi|monday)/i.test(label) && /(mardi|tuesday)/i.test(label)) {
      return mseClean(label.replace(/\.?\s*(Masquer|Hide|Afficher|Show).*$/i, ''));
    }
  }
  var table = panel.querySelector('table');
  if (table) {
    var rows = Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
      return mseClean(tr.innerText).replace(/\s*\n\s*/g, ' ');
    });
    if (rows.length) return rows.join(' ; ');
  }
  return mseClean((mseQuery(MSE_SEL.hoursSummary, panel) || {}).textContent);
}

function mseRating(panel) {
  var stars = panel.querySelector(MSE_SEL.ratingStars);
  var rating = stars ? mseParseNumber(stars.getAttribute('aria-label')) : '';
  var block = mseQuery(MSE_SEL.ratingBlock, panel);
  if (rating === '' && block) {
    var first = block.querySelector('span[aria-hidden="true"]');
    rating = first ? mseParseNumber(first.textContent) : '';
  }
  var reviewsEl = (block || panel).querySelector(MSE_SEL.reviewsCount);
  var reviews = reviewsEl ? mseParseNumber(reviewsEl.getAttribute('aria-label')) : '';
  if (reviews === '' && block) {
    var m = block.textContent.match(/\(([\d\s  .,]+)\)/);
    if (m) reviews = mseParseNumber(m[1]);
  }
  return { rating: rating, reviews: reviews };
}

function mseDescription(panel) {
  var el = mseQuery(MSE_SEL.description, panel);
  return el ? mseClean(el.textContent) : '';
}

// Récupère le panneau de détail (celui qui contient le h1 du lieu).
function mseDetailPanel() {
  var mains = document.querySelectorAll(MSE_SEL.mainPanel);
  for (var i = mains.length - 1; i >= 0; i--) {
    if (mains[i].querySelector('h1')) return mains[i];
  }
  return document;
}

function extractPlace(placeUrl) {
  var panel = mseDetailPanel();
  var nameEl = mseQuery(MSE_SEL.name, panel);
  var url = placeUrl || location.href;
  var coords = mseCoordsFromUrl(url);
  var r = mseRating(panel);

  var phoneEl = panel.querySelector(MSE_SEL.phone);
  var phone = '';
  if (phoneEl) {
    phone = mseItemText(phoneEl) ||
      decodeURIComponent((phoneEl.getAttribute('data-item-id') || '').replace('phone:tel:', ''));
  }

  var websiteEl = panel.querySelector(MSE_SEL.website);
  var priceEl = mseQuery(MSE_SEL.price, panel);
  var hotelClassEl = mseQuery(MSE_SEL.hotelClass, panel);
  var categoryEl = mseQuery(MSE_SEL.category, panel);

  var emails = (panel.innerText || '').match(MSE_SEL.emailRegex) || [];
  emails = emails.filter(function (e, i) { return emails.indexOf(e) === i; });

  return {
    id: msePlaceId(url),
    name: mseClean(nameEl ? nameEl.textContent : ''),
    category: mseClean(categoryEl ? categoryEl.textContent : ''),
    rating: r.rating,
    reviews: r.reviews,
    price: priceEl ? mseClean(priceEl.getAttribute('aria-label') || priceEl.textContent).replace(/^(Prix|Price)\s*:\s*/i, '') : '',
    hotelClass: hotelClassEl ? mseClean(hotelClassEl.getAttribute('aria-label') || hotelClassEl.textContent) : '',
    address: mseItemText(panel.querySelector(MSE_SEL.address)),
    phone: phone,
    website: websiteEl ? websiteEl.href : '',
    email: emails.join(', '),
    plusCode: mseItemText(panel.querySelector(MSE_SEL.plusCode)),
    hours: mseHours(panel),
    description: mseDescription(panel),
    services: '',
    lat: coords.lat,
    lng: coords.lng,
    url: url.split('?')[0]
  };
}

// Ouvre l'onglet "À propos" et liste les services / équipements.
async function extractServices(sleep) {
  var panel = mseDetailPanel();
  var tab = mseQuery(MSE_SEL.aboutTab, panel);
  if (!tab) return { services: '', description: '' };
  tab.click();
  await sleep(1200);
  var about = mseQuery(MSE_SEL.aboutContent, document);
  if (!about) return { services: '', description: '' };
  var items = Array.prototype.map.call(about.querySelectorAll(MSE_SEL.aboutItems), function (s) {
    return mseClean(s.getAttribute('aria-label'));
  }).filter(Boolean);
  var desc = about.querySelector('.PbZDve, .P1LL5e');
  return {
    services: items.filter(function (x, i) { return items.indexOf(x) === i; }).join(' ; '),
    description: desc ? mseClean(desc.textContent) : ''
  };
}
