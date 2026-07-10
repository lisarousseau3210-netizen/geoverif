# GéoVerif

**Contrôle qualité de livrables SIG, directement dans le navigateur.**

On dépose le fichier reçu d'un prestataire, on obtient en quelques secondes un verdict clair : exploitable, utilisable avec réserves, ou bloquant. Avec un rapport détaillé, un contrôle des données attributaires, et un rapport imprimable à joindre au renvoi d'un livrable.

Aucun serveur, aucun compte, aucune donnée transmise : **les fichiers ne quittent jamais votre ordinateur.**

## Pourquoi

En agence, en collectivité ou sur un chantier, on reçoit des données cartographiques produites par d'autres. Elles ont souvent un défaut invisible : un fichier de projection manquant qui décale tout de plusieurs centaines de kilomètres, des géométries vides, des doublons, une colonne à moitié vide, des saisies incohérentes. S'en apercevoir demande un logiciel SIG, du temps et de l'habitude — que la personne qui réceptionne n'a pas toujours. Le défaut se découvre alors trop tard.

GéoVerif fait cette vérification de réception en un dépôt de fichier, sans rien installer.

## Formats pris en charge

Shapefile (archive `.zip` ou fichiers séparés), GeoPackage, GeoJSON, KML/KMZ, CSV et Excel avec détection automatique des colonnes de coordonnées.

## Ce qui est vérifié

- **Complétude du livrable** : composants du shapefile manquants (`.dbf`, `.prj`, `.shx`), signalés avec leur conséquence
- **Référence spatiale** : lecture du WKT, reprojection automatique (Lambert 93 compris), détection des projections métriques non déclarées
- **Validité des géométries** : entités vides, anneaux dégénérés
- **Doublons de géométrie** exacts
- **Contrôle attributaire** : valeurs distinctes par champ, détection des saisies incohérentes (`ENEDIS` / `eNEDIS`, `actif` / `ACTIF `)
- **Rapport imprimable** en PDF, à joindre au renvoi d'un livrable

Une page **Méthodologie** intégrée documente chaque contrôle, sa méthode et ses limites, références OGC et ISO à l'appui. GéoVerif est un contrôle de réception, pas une certification : il vérifie les invariants communs à tous les modèles (QGIS/GEOS, ESRI, FME) et indique explicitement ce qu'il ne vérifie pas.

## Confidentialité et fonctionnement

Toute l'analyse s'exécute dans le navigateur, en local. Aucun fichier n'est envoyé sur un serveur, il n'y a d'ailleurs aucun serveur. Les seules requêtes réseau concernent le fond de carte et la recherche de lieu ; elles ne transportent jamais le contenu de vos fichiers. L'outil s'installe comme une application (PWA) et fonctionne ensuite hors connexion.

## Utilisation

Deux façons de l'utiliser :

- **En ligne** : déploiement en cours
- **En local** : télécharger `geoverif.html` et l'ouvrir dans un navigateur. Le fichier est autonome, il fonctionne par double-clic, sans installation ni connexion.

Le dossier `geoverif-pwa/` contient la version installable et hors-ligne, avec ses bibliothèques auto-hébergées.

## Limites de capacité

L'outil est conçu pour un contrôle de réception, pas pour manipuler de gros jeux de données. Au-delà de 15 000 entités ou 250 Mo, il refuse le fichier et oriente vers un SIG de bureau : mieux vaut un refus clair qu'un navigateur figé.

## Développement et qualité

Le projet est développé en un fichier HTML autonome, sans dépendance de build côté hébergement. Il est accompagné d'un banc de test automatisé (`audit.js`) qui vérifie un audit statique et une dizaine de parcours d'utilisation (chargements, verdicts, rapport, contrôle attributaire, gestion du poids, sécurité) à chaque modification.

```
npm install jsdom
node audit.js
```

## Équipe

- **Conception et développement** : Lisa Rousseau — Neura4
- **Cas d'usage BTP et interopérabilité BIM-SIG** : à venir
- **Usages en gestion de crise et terrains contraints** : à venir
- **Juridique, conformité et licence** : à venir
- **Communication et lancement** : à venir

## Licence

À définir. En attendant la publication d'une licence, l'usage de l'outil est libre et gratuit ; le code est consultable ici à titre de transparence.

---

*GéoVerif est un projet porté par Neura4. Contact : contact.geoverif@gmail.com*
