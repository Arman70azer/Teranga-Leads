# Teranga Leads

Extension pour Chrome, Edge et Firefox. Elle récupère les **restaurants** et **hôtels** d'une ville du Sénégal sur Google Maps, **carré par carré**, puis les exporte vers **Excel (.xlsx)**.

## Installation

### Chrome / Edge / Brave
1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **Mode développeur**.
3. Cliquer sur **Charger l'extension non empaquetée** et choisir ce dossier.
4. Après une mise à jour des fichiers, cliquer sur ↻ (Recharger) sur la carte de l'extension.

### Firefox (version 115 ou plus récente)
1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer sur **Charger un module complémentaire temporaire…** et choisir `manifest.json`.
3. Au premier lancement, Firefox demande l'autorisation d'accéder à Google Maps et à OpenStreetMap : acceptez.

> Sous Firefox, un module temporaire est retiré quand on ferme le navigateur. Pour l'installer durablement, il faut le signer sur addons.mozilla.org.

## Utilisation
1. Cliquer sur l'icône de l'extension, saisir une **ville** (Dakar, Saint-Louis, Mbour…), puis cliquer sur **Lancer l'extraction**.
2. L'extension récupère le contour de la ville sur OpenStreetMap et affiche le nombre de carrés à parcourir. Confirmez.
3. Google Maps s'ouvre et parcourt la ville carré par carré, d'abord les restaurants, puis les hôtels. Un panneau en bas à gauche de la page affiche la progression.
4. **Laissez l'onglet au premier plan.** Vous pouvez arrêter à tout moment.
5. Rouvrir l'extension → **Exporter Excel (.xlsx)**, à tout moment, même pendant l'extraction.

### Reprise après interruption
La progression (la liste des carrés restants) est enregistrée automatiquement après chaque carré. Si l'onglet se ferme, si le PC s'éteint ou si vous cliquez sur Arrêter :
- rouvrez l'extension → **Reprendre**, ou relancez la même ville ;
- l'extraction repart du carré où elle s'était arrêtée, et les fiches déjà enregistrées ne sont pas rouvertes.

**Recommencer à zéro** efface la progression et les fiches de la ville, puis relance tout depuis le premier carré.
**Vider toutes les données** supprime toutes les fiches de toutes les villes.

## Comment la ville est couverte
- La ville est découpée en **carrés de 1 km**. Seuls ceux qui touchent son contour sont gardés : pas de recherche en pleine mer.
- Pour chaque carré, Maps est ouvert sur une recherche « restaurants » puis « hôtels », zoomée sur ce carré.
- Si un carré renvoie **100 résultats ou plus**, c'est que Google en cache probablement (sa limite est d'environ 120). Le carré est alors **redécoupé en 4 carrés de 500 m**, puis de 250 m si besoin. Les zones denses (Plateau, Almadies…) sont ainsi couvertes presque rue par rue.
- Seuls les établissements **situés dans la ville** sont enregistrés. Les doublons entre carrés voisins sont ignorés.
- Un établissement trouvé dans les deux recherches aura le type « Restaurant, Hôtel ».

Ordre de grandeur : Dakar ≈ 150 carrés de départ (≈ 300 recherches avant redécoupage), Saint-Louis ≈ 90, Mbour ≈ 40, Saly ≈ 30. Comptez **plusieurs heures** pour Dakar. Grâce à la reprise, vous pouvez étaler l'extraction sur plusieurs sessions.

## Colonnes exportées
Type, Ville recherchée, Nom, Catégorie, Note, Nombre d'avis, Gamme de prix, Classement hôtel, Adresse, Téléphone, Site web, Email, Plus code, Horaires, Description, Services/équipements (si l'option est cochée), Latitude, Longitude, Lien Google Maps, Date d'extraction.

## Limites
- **Email** : Google Maps n'affiche presque jamais d'email, cette colonne sera donc souvent vide.
- Google modifie régulièrement sa page. Si un champ ne se remplit plus, il faut mettre à jour les sélecteurs dans `content/selectors.js`.
- Si une page de consentement aux cookies Google s'affiche, acceptez-la, puis cliquez sur **Reprendre**.
- L'extraction automatique va à l'encontre des conditions d'utilisation de Google : gardez un usage raisonnable.

## Structure
```
manifest.json          Configuration (MV3, compatible Chrome et Firefox)
popup/                 Interface : lancement, reprise, recommencer, export Excel
lib/grid.js            Découpage de la ville en carrés, contour, redécoupage
content/selectors.js   Sélecteurs Google Maps (à ajuster si Google change sa page)
content/extractor.js   Lecture des informations d'une fiche
content/scraper.js     File de carrés, défilement, parcours des fiches, panneau de progression
lib/xlsx.full.min.js   SheetJS 0.20.3 (génération du fichier Excel)
```

Données enregistrées dans le stockage de l'extension : `mse_job` (progression : carrés restants, compteurs), `mse_area` (contour de la ville en cours), `mse_areas` (contours déjà téléchargés, un par ville, conservés même après « Vider toutes les données »), `mse_p_<id>` (une entrée par fiche).

OpenStreetMap (Nominatim) : aucune clé API n'est nécessaire. L'extension ne l'appelle qu'une seule fois par ville, au premier lancement de cette ville.
