# GeoVerif

**Contrôle qualité de livrables SIG, directement dans le navigateur.**

GeoVerif réalise un contrôle de réception rapide et produit un verdict lisible — exploitable, utilisable avec réserves ou bloquant — accompagné d’un rapport détaillé.

[Ouvrir GeoVerif](https://geoverif.netlify.app/)

## Contrôles réalisés

- complétude des shapefiles (`.shp`, `.dbf`, `.shx`, `.prj`) ;
- référence spatiale, reprojection et coordonnées hors limites ;
- géométries vides, anneaux dégénérés et doublons exacts ;
- complétude, types et valeurs distinctes des attributs ;
- variantes de casse ou d’espacement dans les valeurs ;
- rapport détaillé imprimable en PDF et diagnostic texte pour les fichiers refusés.

## Formats pris en charge

| Format | Prise en charge |
| --- | --- |
| Shapefile | Archive `.zip` ou composants sélectionnés ensemble |
| GeoPackage | Couches vectorielles, depuis la version en ligne ou un serveur local |
| GeoJSON | `.geojson`, `.json` |
| KML / KMZ | `.kml`, `.kmz` |
| CSV / Excel | `.csv`, `.xlsx`, `.xls` avec détection des colonnes de coordonnées |

Les rasters, le GML et les formats BIM ne sont pas pris en charge.

## Confidentialité

La lecture et le contrôle des fichiers s’exécutent localement dans le navigateur. Aucun fichier importé, attribut ou géométrie exacte n’est transmis à GeoVerif.

Les fonds de carte, la recherche de lieu et la mesure d’audience utilisent des services externes : OpenStreetMap, Esri, Nominatim et GoatCounter. GoatCounter mesure une fréquentation agrégée sans cookie. Ces services ne reçoivent pas le contenu des fichiers contrôlés.

## Limites

- 5 fichiers ou couches simultanés ;
- 15 000 entités au maximum par couche ;
- 250 Mo au maximum par fichier ;
- 1 000 entrées au maximum par archive.

GeoVerif est un outil de contrôle de réception, pas un outil de certification. Une validation dans le logiciel SIG cible reste nécessaire pour un usage réglementaire ou contractuel.

## Utilisation locale

Le dossier `geoverif-pwa/` contient la version déployable. Pour bénéficier de toutes les fonctions, dont les GeoPackage et l’installation PWA, servez ce dossier en HTTP :

```bash
python -m http.server 8000 --directory geoverif-pwa
```

Ouvrez ensuite `http://localhost:8000/`. L’ouverture directe de `geoverif-pwa/index.html` par double-clic reste possible, sauf pour les GeoPackage et les fonctions nécessitant HTTP.

## Vérification

Le banc d’audit ne dépend d’aucun paquet externe et nécessite Node.js 18 ou une version ultérieure :

```bash
node audit.js
```

Il contrôle notamment la parité entre la source et la PWA, les ressources hors ligne, les contrats de confidentialité et de sécurité, ainsi que les principales règles d’analyse.

## Licence

Aucune licence de réutilisation n’est publiée à ce jour.
