// Tous les sélecteurs Google Maps sont centralisés ici.
// Google modifie souvent son DOM : en cas de panne, c'est ce fichier qu'il faut ajuster.
// On privilégie les attributs stables (role, aria-label, data-item-id) aux classes CSS.
var MSE_SEL = {
  // Liste des résultats
  feed: 'div[role="feed"]',
  placeLink: 'a[href*="/maps/place/"]',
  endOfList: ['span.HlvSq', 'p.fontBodyMedium > span > span'],
  endOfListText: /arrivé à la fin de la liste|reached the end of the list/i,

  // Fiche détaillée
  mainPanel: 'div[role="main"]',
  name: ['h1.DUwDvf', 'div[role="main"] h1', 'h1'],
  category: ['button[jsaction*="category"]', 'button.DkEaL', 'span.DkEaL'],
  ratingBlock: ['div.F7nice', 'div.fontBodyMedium.dmRWX'],
  ratingStars: 'span[role="img"][aria-label*="étoile"], span[role="img"][aria-label*="star"]',
  reviewsCount: 'span[aria-label*="avis"], span[aria-label*="review"]',
  price: [
    'span[aria-label^="Prix"]',
    'span[aria-label^="Price"]',
    'span[aria-label*="Niveau de prix"]'
  ],
  hotelClass: ['span[aria-label*="étoiles"]', 'span[aria-label*="-star hotel"]'],
  address: 'button[data-item-id="address"]',
  phone: 'button[data-item-id^="phone:tel:"]',
  website: 'a[data-item-id="authority"]',
  plusCode: 'button[data-item-id="oloc"]',
  hoursTable: ['div[aria-label*="Horaires"]', 'div[aria-label*="hours"]', 'table.eK4R0e'],
  hoursSummary: ['div[jsaction*="openhours"]', 'span.ZDu9vd'],
  description: [
    'div.PYvSYb',
    'div[aria-label^="À propos"] div.PbZDve',
    'div.WeS02d'
  ],
  aboutTab: [
    'button[role="tab"][aria-label^="À propos"]',
    'button[role="tab"][aria-label^="About"]'
  ],
  aboutContent: ['div[aria-label^="À propos"]', 'div[aria-label^="About"]'],
  aboutItems: 'li span[aria-label]',
  overviewTab: [
    'button[role="tab"][aria-label^="Présentation"]',
    'button[role="tab"][aria-label^="Overview"]'
  ],

  emailRegex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
};

// Renvoie le premier élément trouvé parmi une liste de sélecteurs.
function mseQuery(selectors, root) {
  root = root || document;
  var list = Array.isArray(selectors) ? selectors : [selectors];
  for (var i = 0; i < list.length; i++) {
    var el = root.querySelector(list[i]);
    if (el) return el;
  }
  return null;
}
