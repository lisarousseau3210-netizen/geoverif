const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('geoverif.html', 'utf8');

// ===== AUDIT STATIQUE =====
const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
// 1. Chaque onclick="fn(...)" doit référencer une fonction définie
const onclicks = [...src.matchAll(/onclick="(\w+)\(/g), ...html.matchAll(/onclick="(\w+)\(/g)]
  .map(m => m[1]).filter(f => !['document'].includes(f));
const definies = new Set([...src.matchAll(/function (\w+)/g)].map(m => m[1]));
for (const f of new Set(onclicks)) {
  if (!definies.has(f) && f !== 'event') throw new Error('onclick vers fonction inconnue : ' + f);
}
// 2. Chaque $('#id') doit exister dans le HTML
const idsUtilises = new Set([...src.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]));
const idsExistants = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
for (const id of idsUtilises) if (!idsExistants.has(id)) throw new Error('$ vers id inexistant : #' + id);
// 3. Le hack script fendu a bien disparu, l'impression est au onload
if (src.includes('<scr` + `ipt>')) throw new Error('hack script fendu encore présent');
if (!src.includes('setTimeout(function(){window.print()},300)')) throw new Error('print au onload absent');
console.log('AUDIT STATIQUE : onclick OK (' + new Set(onclicks).size + ' fonctions), ids OK (' + idsUtilises.size + '), impression onload OK');

// ===== AUDIT DYNAMIQUE (DOM réel) =====
// Neutraliser les scripts externes (pas de réseau ici) et injecter des stubs Leaflet/shpjs
html = html.replace(/<script src="[^"]+"><\/script>/g, '');
const stub = `<script>
window.L = {
  map: () => ({ setView(){return this}, removeLayer(){}, fitBounds(){}, addLayer(){} }),
  tileLayer: () => ({ addTo(){} }),
  geoJSON: (fc, opts) => {
    if (opts && opts.onEachFeature) for (const f of fc.features || [])
      opts.onEachFeature(f, { bindPopup(){} });
    return { addTo(){ return this }, getBounds: () => ({ isValid: () => false }), setStyle(){} };
  },
};
window.shp = Object.assign(() => Promise.resolve({}), { parseShp(){}, parseDbf(){}, combine(){} });
</scr` + `ipt>`;
const dernierScript = html.lastIndexOf('<script>');
html = html.slice(0, dernierScript) + stub + html.slice(dernierScript);

const virtualConsole = new (require('jsdom').VirtualConsole)();
let erreursPage = [];
virtualConsole.on('jsdomError', e => erreursPage.push(String(e)));
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, url: 'https://geoverif.test/' });
const w = dom.window, d = w.document;
if (erreursPage.length) throw new Error('Erreur au chargement : ' + erreursPage[0]);

// Capture des impressions
let pageImprimee = null;
w.open = () => ({ document: { write: s => pageImprimee = s, close(){} }, focus(){}, print(){} });

const couchesLen = () => {
  let n = 0;
  while (true) { try { w.rapportComplet; } catch(e){} 
    // compte via la liste rendue
    break; }
  const el = d.getElementById('couches');
  return (el.innerHTML.match(/class="couche/g) || []).length;
};
const P = (c, props) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [c] }, properties: props });
const carre = [[3.85,43.6],[3.9,43.6],[3.9,43.64],[3.85,43.64],[3.85,43.6]];
const carre2 = [[3.7,43.5],[3.75,43.5],[3.75,43.55],[3.7,43.5]]; // dégénéré possible? 4 pts ok

// --- Parcours 1 : couche saine ---
w.ajouterCouche({type:'FeatureCollection', features:[P(carre,{nom:'A',pop:12})]}, 'saine.geojson',
                {reprojetee:true, completudeConnue:true, crsNom:'Lambert-93'});
let bd = d.getElementById('bandeau');
if (bd.style.display !== 'flex') throw new Error('bandeau non affiché');
if (!bd.className.includes('b-vert')) throw new Error('bandeau pas vert : ' + bd.className);
if (!bd.textContent.includes('Rapport complet')) throw new Error('bouton bandeau absent');

// --- Parcours 2 : couche shp seul (incomplète) + doublons ---
w.ajouterCouche({type:'FeatureCollection', features:[P(carre,{c:null}), P(carre,{c:null})]}, 'seul.shp',
  {manquants:[{fichier:'.dbf',bloquant:false,message:'dbf absent — attributs indisponibles'},
              {fichier:'.prj',bloquant:false,message:'prj absent — positionnement à vérifier'}], completudeConnue:true});
if (!bd.className.includes('b-orange')) throw new Error('verdict orange attendu : ' + bd.className);
if (!bd.textContent.includes('incomplet')) throw new Error('complétude absente du bandeau');

// --- Panneau condensé : verdict + résumé, SANS les tableaux détaillés ---
const pan = d.getElementById('panneau');
if (pan.style.display !== 'block') throw new Error('rapport pas ouvert automatiquement');
for (const attendu of ['UTILISABLE AVEC RÉSERVES', 'Résumé', 'Livrable incomplet', 'Rapport complet',
                       'Champs (', 'Aperçu (5 premières entités)'])
  if (!pan.innerHTML.includes(attendu)) throw new Error('panneau : "' + attendu + '" absent');
if (pan.innerHTML.includes('Vérifications effectuées')) throw new Error('panneau : tableaux détaillés devraient être dans le rapport complet');

// --- Clic bandeau -> modale rapport complet avec TOUTES les sections ---
bd.querySelector('button').dispatchEvent(new w.Event('click', {bubbles:true}));
const rc = d.getElementById('rapportcomplet');
if (rc.style.display !== 'flex') throw new Error('BUG : Rapport complet ne s\'ouvre pas');
for (const attendu of ['Vérifications effectuées', 'Contrôle attributaire', 'Complétude du livrable',
                       'Doublons de géométrie', '5 premières entités', 'manquant(s) : .dbf, .prj'])
  if (!rc.innerHTML.includes(attendu)) throw new Error('rapport complet : "' + attendu + '" absent');
rc.style.display = 'none';

// --- Contrôle attributaire : variantes de casse détectées (ENEDIS / eNEDIS) ---
w.ajouterCouche({type:'FeatureCollection', features:[
  P(carre,{exploitant:'ENEDIS'}), P(carre2,{exploitant:'eNEDIS'}),
  {type:'Feature', geometry:{type:'Point', coordinates:[3.8,43.6]}, properties:{exploitant:'Veolia'}}
]}, 'reseaux.geojson', {reprojetee:true, completudeConnue:true});
w.rapportComplet(couchesLen() - 1);
if (!rc.innerHTML.includes('variantes')) throw new Error('variantes de casse non détectées');
if (!rc.innerHTML.includes('ENEDIS / eNEDIS') && !rc.innerHTML.includes('eNEDIS / ENEDIS'))
  throw new Error('groupe de variantes absent');
// Tableau épuré : plus de pastilles ×N dans le tableau, mais sous-page au clic
if (/×\d/.test(rc.querySelector('#tabattr').innerHTML)) throw new Error('pastilles ×N encore dans le tableau');
if (!rc.innerHTML.includes('Cliquez sur un champ')) throw new Error('indication de clic absente');
rc.querySelector('.ligneattr').dispatchEvent(new w.Event('click', {bubbles:true}));
if (!rc.innerHTML.includes('occurrences')) throw new Error('sous-page valeurs pas ouverte');
if (!rc.innerHTML.includes('ENEDIS')) throw new Error('valeurs absentes de la sous-page');
if (!rc.innerHTML.includes('Retour au rapport')) throw new Error('bouton retour absent');
d.querySelector('#rccontenu button:not(.fermer)') && w.rapportComplet(couchesLen() - 1);
if (!rc.querySelector('#tabattr')) throw new Error('retour au rapport cassé');
if (!pan.innerHTML.includes('casse/aux espaces près')) throw new Error('avertissement variantes absent du panneau');
rc.style.display = 'none';

// --- Seuil dur : 15 001 entités -> refus net, rien d'affiché ---
const avant = couchesLen();
const gros = {type:'FeatureCollection', features: Array.from({length: 15001}, () => P(carre, {n:1}))};
const ok = w.ajouterCouche(gros, 'admin-express.gpkg', {reprojetee:true});
if (ok !== false) throw new Error('couche géante acceptée');
if (couchesLen() !== avant) throw new Error('couche géante ajoutée quand même');
if (!d.getElementById('toast').textContent.includes('QGIS')) throw new Error('message de refus sans orientation QGIS');

// --- Impression = version complète ---
pageImprimee = null;
w.imprimerRapport(avant - 1);
for (const attendu of ['Contrôle attributaire', 'Vérifications effectuées', 'onload="setTimeout'])
  if (!pageImprimee || !pageImprimee.includes(attendu)) throw new Error('impression : "' + attendu + '" absent');
if (pageImprimee.includes('undefined')) throw new Error('impression : undefined');

// --- Overlay de chargement : helper fonctionnel ---
w.chargement('Test…');
if (d.getElementById('chargement').style.display !== 'flex') throw new Error('overlay ne s\'affiche pas');
w.chargement(null);
if (d.getElementById('chargement').style.display !== 'none') throw new Error('overlay ne se cache pas');

// --- Retrait / accueil : tout se referme ---
w.accueil();
if (bd.style.display !== 'none') throw new Error('bandeau pas caché');
if (rc.style.display === 'flex') throw new Error('rapport complet pas fermé à l\'accueil');

// --- XSS : nom, champ et VALEUR d'attribut piégés (chips du contrôle attributaire) ---
w.ajouterCouche({type:'FeatureCollection', features:[P(carre,{'<img src=x onerror=alert(1)>':'<script>alert(2)</script>'})]},
                '<b>piégé</b>.geojson', {reprojetee:true});
w.rapportComplet(couchesLen() - 1);
if (rc.querySelector('img') || rc.innerHTML.includes('<script>alert(2)'))
  throw new Error('XSS via contrôle attributaire');
if (bd.innerHTML.includes('<b>piégé</b>')) throw new Error('XSS bandeau');

// --- Méthodologie : bouton, modale, contenu académique, fond blanc partagé ---
d.getElementById('btnmethodo').dispatchEvent(new w.Event('click', {bubbles:true}));
const met = d.getElementById('methodo');
if (met.style.display !== 'flex') throw new Error('méthodologie ne s\'ouvre pas');
for (const attendu of ['GEOS', 'Simple Features', 'FME', 'GeometryValidator', 'Shapefile Technical Description',
                       'invariants communs', 'auto-intersections', 'ISO 19107', 'Synthèse des contrôles',
                       'Ce que GéoVerif ne vérifie pas'])
  if (!met.innerHTML.includes(attendu)) throw new Error('méthodologie : "' + attendu + '" absent');
if (met.innerHTML.includes('\u2014') || met.innerHTML.includes('\u2013'))
  throw new Error('cadratin restant dans la méthodologie');
if (d.getElementById('modal').innerHTML.includes('\u2014'))
  throw new Error('cadratin restant dans Formats');
if (!met.querySelector('thead')) throw new Error('tableau de synthèse méthodologie sans thead');
if (!rc.querySelector('#tabattr thead')) throw new Error('tableaux du rapport complet sans thead');
met.style.display = 'none';
const css = html.match(/<style>[\s\S]*?<\/style>/)[0];
if (!css.includes('#rapportcomplet .boite,#methodo .boite{background:#fff') &&
    !css.includes('#modal .boite,#apropos .boite,#rapportcomplet .boite,#methodo .boite{background:#fff'))
  throw new Error('fond blanc non partagé (bug transparence)');

// --- UX modales : Échap et clic sur le voile ---
w.rapportComplet(0);
d.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
if (rc.style.display !== 'none') throw new Error('Échap ne ferme pas les modales');
d.getElementById('btnmethodo').dispatchEvent(new w.Event('click', {bubbles:true}));
met.dispatchEvent(new w.Event('click', {bubbles:true}));  // clic sur le voile lui-même
if (met.style.display !== 'none') throw new Error('clic sur le voile ne ferme pas');
if (!html.includes('rel="icon"')) throw new Error('favicon absent');
if (!/GéoVerif v1\.0/.test(html)) throw new Error('version absente');

console.log('AUDIT DYNAMIQUE : 10 parcours passent (panneau condensé, modale complète, attributaire + sous-page,');
console.log('  variantes, seuil dur, impression, overlay, accueil, XSS, méthodologie, transparence, Échap/voile, favicon, version)');
