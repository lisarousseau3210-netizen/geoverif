'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const SOURCE_PATH = path.join(ROOT, 'geoverif.html');
const PWA_DIR = path.join(ROOT, 'geoverif-pwa');
const PWA_HTML_PATH = path.join(PWA_DIR, 'index.html');
const MANIFEST_PATH = path.join(PWA_DIR, 'manifest.webmanifest');
const SERVICE_WORKER_PATH = path.join(PWA_DIR, 'sw.js');
const README_PATH = path.join(ROOT, 'README.md');

let assertions = 0;
const suites = [];

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) {
    throw new Error(`${message}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  }
}

function match(value, pattern, message) {
  assertions += 1;
  if (!pattern.test(String(value))) throw new Error(message);
}

function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function readUtf8(filePath) {
  assert(fs.existsSync(filePath), `Fichier requis absent : ${path.relative(ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function localPathFromUrl(reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith('data:') || /^[a-z]+:/i.test(clean) || clean.startsWith('//')) return null;
  return clean.replace(/^\.\//, '');
}

function extractScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map(matchResult => ({attributes: matchResult[1], source: matchResult[2]}));
}

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert(buffer.length >= 24, `PNG invalide ou tronqué : ${path.relative(ROOT, filePath)}`);
  equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `Signature PNG invalide : ${path.relative(ROOT, filePath)}`);
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

async function suite(name, callback) {
  const before = assertions;
  await callback();
  suites.push({name, assertions: assertions - before});
}

function createElement(name = 'div') {
  const listeners = new Map();
  const attributes = new Map();
  const children = [];
  const element = {
    nodeName: name.toUpperCase(),
    style: {},
    className: '',
    value: '',
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    children,
    files: [],
    onclick: null,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener.call(element, event);
      return true;
    },
    setAttribute(key, value) { attributes.set(key, String(value)); },
    getAttribute(key) { return attributes.get(key) ?? null; },
    removeAttribute(key) { attributes.delete(key); },
    appendChild(child) { children.push(child); return child; },
    querySelector() { return createElement(); },
    querySelectorAll() { return []; },
    contains() { return false; },
    focus() {},
    click() {}
  };
  return element;
}

function createRuntime(mainScript) {
  const elements = new Map();
  const bySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, createElement(selector.replace(/^#/, '')));
    return elements.get(selector);
  };
  const body = createElement('body');
  const head = createElement('head');
  const document = {
    body,
    head,
    activeElement: null,
    querySelector: bySelector,
    querySelectorAll() { return []; },
    createElement,
    addEventListener() {},
    contains() { return false; }
  };

  const map = {
    setView() { return this; },
    fitBounds() { return this; },
    removeLayer() { return this; },
    addLayer() { return this; },
    hasLayer() { return false; }
  };
  const tileLayer = () => ({
    addTo() { return this; },
    on() { return this; }
  });
  const geoJsonLayer = () => ({
    addTo() { return this; },
    setStyle() { return this; },
    getBounds() { return {isValid: () => false}; }
  });
  const L = {
    latLngBounds: () => ({isValid: () => true}),
    map: () => map,
    tileLayer,
    geoJSON: geoJsonLayer
  };
  const shp = Object.assign(async () => ({}), {
    parseShp() { return []; },
    parseDbf() { return []; },
    combine() { return {type: 'FeatureCollection', features: []}; }
  });

  const context = vm.createContext({
    console,
    document,
    L,
    shp,
    location: {protocol: 'https:', origin: 'https://geoverif.test'},
    navigator: {},
    requestAnimationFrame: callback => callback(),
    setTimeout,
    clearTimeout,
    fetch: async () => ({ok: true, json: async () => []}),
    alert() {},
    URL,
    Blob,
    DataView,
    Uint8Array,
    ArrayBuffer,
    TextDecoder,
    TextEncoder,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    RegExp,
    Promise,
    Intl,
    encodeURIComponent,
    decodeURIComponent,
    isFinite,
    parseFloat
  });
  context.window = context;
  context.globalThis = context;
  context.self = context;
  context.open = () => null;
  new vm.Script(mainScript, {filename: 'geoverif-inline.js'}).runInContext(context, {timeout: 5000});
  const api = vm.runInContext(`({
    analyser, ajouterRegle, finaliserRegles, detecterXY, lignesVersPoints,
    estVide, typeAttribut, fmtVal, echap, htmlRapport, diagnosticRefus,
    problemeArchive, nomCRS, typesChampsDbf, transformerCoords, lireWKBGeom,
    MAX_COUCHES, MAX_ENTITES, TAILLE_REFUS, MAX_ENTREES_ARCHIVE
  })`, context);
  return {context, api};
}

function feature(geometry, properties = {}) {
  return {type: 'Feature', geometry, properties};
}

function point(x, y, properties = {}) {
  return feature({type: 'Point', coordinates: [x, y]}, properties);
}

function collection(features) {
  return {type: 'FeatureCollection', features};
}

(async () => {
  const sourceHtml = readUtf8(SOURCE_PATH);
  const pwaHtml = readUtf8(PWA_HTML_PATH);
  const manifestText = readUtf8(MANIFEST_PATH);
  const serviceWorker = readUtf8(SERVICE_WORKER_PATH);
  const readme = readUtf8(README_PATH);

  const inlineScripts = extractScripts(sourceHtml).filter(script => !/\bsrc\s*=/i.test(script.attributes));
  const mainScript = [...inlineScripts].sort((a, b) => b.source.length - a.source.length)[0]?.source;
  assert(mainScript && mainScript.length > 30000, 'Script principal introuvable ou anormalement court.');

  await suite('Source, métadonnées et interface', () => {
    equal(normalizeText(sourceHtml), normalizeText(pwaHtml), 'geoverif.html et geoverif-pwa/index.html doivent rester identiques.');
    match(sourceHtml, /<!doctype html>/i, 'DOCTYPE HTML5 absent.');
    match(sourceHtml, /<html\s+lang="fr">/i, 'Langue française non déclarée.');
    match(sourceHtml, /<meta\s+charset="utf-8">/i, 'Encodage UTF-8 non déclaré.');
    match(sourceHtml, /<title>GeoVerif - Contrôle qualité<\/title>/, 'Titre d’onglet inattendu.');
    match(sourceHtml, /Responsable de la publication\s*:\s*Lisa Rousseau/, 'Responsable de la publication absent ou incorrect.');
    assert(!/Neura4/i.test(sourceHtml + readme), 'Une ancienne mention « Neura4 » subsiste.');
    assert(!/(?:entité|champ|géométrie|couche|fichier|valeur|ligne)\(s\)/i.test(sourceHtml), 'Une forme générique « (s) » subsiste dans l’interface.');
    assert(!/[ï¿½]|â(?:€|€™|€œ|€œ|€“|€”)/.test(sourceHtml), 'Le fichier HTML semble contenir du texte mal encodé.');

    const ids = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map(result => result[1]);
    equal(new Set(ids).size, ids.length, 'Des identifiants HTML sont dupliqués.');
    const referencedIds = [...mainScript.matchAll(/\$\(['"]#([A-Za-z][\w-]*)/g)].map(result => result[1]);
    for (const id of new Set(referencedIds)) assert(ids.includes(id), `Sélecteur vers un identifiant absent : #${id}`);

    const declaredFunctions = new Set([...mainScript.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(result => result[1]));
    const inlineHandlers = [...sourceHtml.matchAll(/\bonclick="([A-Za-z_$][\w$]*)\s*\(/g)].map(result => result[1]);
    for (const handler of new Set(inlineHandlers)) assert(declaredFunctions.has(handler), `Gestionnaire onclick non défini : ${handler}`);

    for (const script of inlineScripts) new vm.Script(script.source, {filename: 'inline-script.js'});
    match(sourceHtml, /@page\{size:A4 portrait;/, 'Les rapports imprimés ne sont pas forcés en A4 portrait.');
    match(sourceHtml, /Aperçu non affiché : nombre de colonnes trop important/, 'Message prévu pour les aperçus trop larges absent.');
    match(sourceHtml, /Exporter le diagnostic \(\.txt\)/, 'Export texte du diagnostic bloquant absent.');
  });

  await suite('Confidentialité et garde-fous', () => {
    match(sourceHtml, /Aucun fichier importé, attribut ni géométrie exacte n'est envoyé/, 'Engagement sur les fichiers importés absent.');
    for (const service of ['OpenStreetMap', 'Esri', 'Nominatim', 'GoatCounter']) {
      assert(sourceHtml.includes(service), `Service externe non documenté dans l’application : ${service}`);
      assert(readme.includes(service), `Service externe non documenté dans le README : ${service}`);
    }
    match(sourceHtml, /data-goatcounter="https:\/\/geoverif\.goatcounter\.com\/count"/, 'Configuration GoatCounter absente ou modifiée.');
    match(sourceHtml, /meta\s+name="referrer"\s+content="strict-origin-when-cross-origin"/, 'Politique Referrer absente.');
    const blankLinks = [...sourceHtml.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)].map(result => result[0]);
    for (const link of blankLinks) match(link, /rel="[^"]*noopener[^"]*"/i, 'Un lien externe ouvert dans un nouvel onglet n’utilise pas noopener.');
    match(mainScript, /const MAX_COUCHES = 5;/, 'Limite de cinq éléments absente.');
    match(mainScript, /const MAX_ENTITES = 15000;/, 'Limite de 15 000 entités absente.');
    match(mainScript, /const TAILLE_REFUS = 250 \* 1024 \* 1024;/, 'Limite de 250 Mo absente.');
    match(mainScript, /const MAX_ENTREES_ARCHIVE = 1000;/, 'Limite de 1 000 entrées d’archive absente.');
    match(mainScript, /sourceDejaPresente\(cle\) \|\| vusSelection\.has\(cle\)/, 'Prévention des fichiers ajoutés en double absente.');
    match(mainScript, /placesReservees >= MAX_COUCHES/, 'Réservation stricte des cinq places absente.');
  });

  await suite('PWA et ressources hors ligne', () => {
    const manifest = JSON.parse(manifestText);
    equal(manifest.short_name, 'GeoVerif', 'short_name du manifeste incorrect.');
    equal(manifest.display, 'standalone', 'La PWA doit utiliser le mode standalone.');
    equal(manifest.lang, 'fr', 'Langue du manifeste incorrecte.');
    equal(manifest.start_url, './', 'start_url du manifeste incorrecte.');
    equal(manifest.scope, './', 'scope du manifeste incorrect.');
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Icônes PWA incomplètes.');
    for (const icon of manifest.icons) {
      const iconPath = path.join(PWA_DIR, icon.src);
      assert(fs.existsSync(iconPath), `Icône PWA absente : ${icon.src}`);
      const dimensions = pngDimensions(iconPath);
      const expected = Number(icon.sizes.split('x')[0]);
      equal(dimensions.width, expected, `Largeur incorrecte pour ${icon.src}.`);
      equal(dimensions.height, expected, `Hauteur incorrecte pour ${icon.src}.`);
    }

    const shellBlock = serviceWorker.match(/const COQUILLE\s*=\s*\[([\s\S]*?)\];/);
    assert(shellBlock, 'Liste COQUILLE du service worker introuvable.');
    const shellAssets = [...shellBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map(result => result[1]);
    assert(shellAssets.length >= 20, 'La coquille hors ligne contient trop peu de ressources.');
    for (const asset of shellAssets) {
      if (asset === './') continue;
      const local = localPathFromUrl(asset);
      assert(local && fs.existsSync(path.join(PWA_DIR, local)), `Ressource hors ligne absente : ${asset}`);
    }
    match(serviceWorker, /url\.origin !== self\.location\.origin/, 'Le service worker doit limiter son cache à la même origine.');
    assert(!/goatcounter|openstreetmap|arcgisonline|nominatim/i.test(shellBlock[1]), 'Un service externe ne doit pas être préchargé dans le cache hors ligne.');

    const assetReferences = [
      ...pwaHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi),
      ...pwaHtml.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/gi)
    ].map(result => result[1]);
    for (const reference of new Set(assetReferences)) {
      const local = localPathFromUrl(reference);
      if (local) assert(fs.existsSync(path.join(PWA_DIR, local)), `Ressource locale référencée mais absente : ${reference}`);
    }
  });

  const {context, api} = createRuntime(mainScript);

  await suite('Utilitaires et import tabulaire', () => {
    for (const value of [null, undefined, '', '   ', NaN, Infinity]) assert(api.estVide(value), `Valeur vide non reconnue : ${String(value)}`);
    for (const value of [0, false, '0', 1]) assert(!api.estVide(value), `Valeur renseignée classée vide : ${String(value)}`);
    equal(api.typeAttribut(12), 'number', 'Type numérique incorrect.');
    equal(api.typeAttribut(true), 'boolean', 'Type booléen incorrect.');
    equal(api.typeAttribut('texte'), 'string', 'Type texte incorrect.');
    equal(vm.runInContext(`typeAttribut(new Date('2026-07-20'))`, context), 'date', 'Type date incorrect.');
    equal(api.echap(`<img src=x onerror="alert(1)">`), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', 'Échappement HTML incorrect.');

    const xy = api.detecterXY(['Identifiant', 'Latitude', 'Longitude']);
    equal(xy.ix, 2, 'Colonne longitude mal détectée.');
    equal(xy.iy, 1, 'Colonne latitude mal détectée.');
    equal(api.detecterXY(['nom', 'valeur']), null, 'Faux positif dans la détection des coordonnées.');
    const points = api.lignesVersPoints([
      ['A', '48.85', '2.35'],
      ['B', 'invalide', '2.40'],
      ['', '', '']
    ], ['nom', 'latitude', 'longitude']);
    equal(points.fc.features.length, 1, 'Nombre de points CSV valides incorrect.');
    equal(points.ignorees, 1, 'Nombre de lignes CSV invalides incorrect.');
    equal(points.fc.features[0].geometry.coordinates.join(','), '2.35,48.85', 'Ordre longitude/latitude incorrect.');

    const header = new ArrayBuffer(65);
    const bytes = new Uint8Array(header);
    new DataView(header).setUint16(8, 65, true);
    bytes.set(Buffer.from('score\0\0\0\0\0\0', 'ascii').subarray(0, 11), 32);
    bytes[43] = 'N'.charCodeAt(0);
    bytes[64] = 0x0d;
    equal(api.typesChampsDbf(header).score, 'number', 'Type DBF non conservé pour un champ entièrement NULL.');
  });

  await suite('Moteur d’analyse', async () => {
    const healthy = await api.analyser(collection([
      point(2.35, 48.85, {nom: 'A', population: 100}),
      point(2.36, 48.86, {nom: 'B', population: 200})
    ]), {crsNom: 'WGS 84', reprojetee: true, completudeConnue: true});
    equal(healthy.verdict, 'vert', 'Une couche saine doit être exploitable.');
    equal(healthy.completude, 'complet', 'Une couche saine doit être complète.');
    equal(healthy.anomalies.length, 0, 'Une couche saine ne doit pas avoir de problème bloquant.');
    equal(healthy.avertissements.length, 0, 'Une couche saine ne doit pas avoir d’avertissement.');
    equal(healthy.champs.find(field => field.nom === 'population').type, 'number', 'Type de champ numérique incorrect.');
    equal(healthy.champs.find(field => field.nom === 'population').taux, 100, 'Taux de remplissage incorrect.');

    const nullFields = await api.analyser(collection([
      point(2.35, 48.85, {score: null, remarque: null}),
      point(2.36, 48.86, {score: NaN, remarque: ''})
    ]), {
      crsNom: 'WGS 84', reprojetee: true, completudeConnue: true,
      typesChamps: {score: 'number', remarque: 'string'}
    });
    equal(nullFields.champs.find(field => field.nom === 'score').type, 'number', 'Le type déclaré d’un champ NULL doit être conservé.');
    equal(nullFields.champs.find(field => field.nom === 'score').taux, 0, 'NaN et NULL ne doivent pas être comptés comme remplis.');
    equal(nullFields.champs.find(field => field.nom === 'remarque').type, 'string', 'Le type texte déclaré doit être conservé.');
    equal(nullFields.avertissements.filter(message => /entièrement vides?/.test(message)).length, 1, 'Les champs vides doivent produire une seule règle synthétique.');

    const duplicate = await api.analyser(collection([
      point(2.35, 48.85, {exploitant: 'ENEDIS'}),
      point(2.35, 48.85, {exploitant: ' enedis '})
    ]), {crsNom: 'WGS 84', reprojetee: true, completudeConnue: true});
    equal(duplicate.verdict, 'orange', 'Doublons et variantes doivent produire des réserves.');
    equal(duplicate.avertissements.filter(message => /doublon exact/.test(message)).length, 1, 'Le doublon exact doit être signalé une seule fois.');
    equal(duplicate.avertissements.filter(message => /casse ou aux espaces/.test(message)).length, 1, 'Les variantes doivent être signalées une seule fois.');
    equal(duplicate.attributs[0].variantes.length, 1, 'Groupe de variantes attributaires absent.');

    const projectedRing = [[700000, 6600000], [701000, 6600000], [701000, 6601000], [700000, 6601000], [700000, 6600000]];
    const incomplete = await api.analyser(collection([
      feature({type: 'Polygon', coordinates: [projectedRing]}, {code: 'A'})
    ]), {
      manquants: [
        {fichier: '.dbf', bloquant: true, message: 'Fichier .dbf absent du livrable.'},
        {fichier: '.prj', bloquant: true, message: 'Fichier .prj absent du livrable.'},
        {fichier: '.shx', bloquant: true, message: 'Fichier .shx absent du livrable.'}
      ],
      completudeConnue: true
    });
    equal(incomplete.verdict, 'rouge', 'Un shapefile incomplet et non positionnable doit être bloquant.');
    equal(incomplete.completude, 'incomplet', 'La complétude doit être « incomplet ».');
    equal(incomplete.anomalies.filter(message => /\.prj absent/.test(message)).length, 1, 'L’absence du .prj ne doit pas être répétée.');
    equal(incomplete.controles[0].statut, 'Incomplet', 'Le contrôle de complétude doit afficher « Incomplet ».');
    equal(incomplete.controles.find(control => control.nom === 'Table attributaire').etat, 'pb', 'Un .dbf absent doit être un problème.');

    const degenerate = await api.analyser(collection([
      feature({type: 'Polygon', coordinates: [[[2, 48], [3, 48], [2, 48]]]}, {})
    ]), {crsNom: 'WGS 84', reprojetee: true, completudeConnue: true});
    equal(degenerate.verdict, 'rouge', 'Un anneau dégénéré doit être bloquant.');
    assert(degenerate.anomalies.some(message => /moins de 4 points/.test(message)), 'Le motif de géométrie dégénérée est absent.');
  });

  await suite('Rapports, sécurité de rendu et diagnostic', async () => {
    const fields = Array.from({length: 7}, (_, index) => ({nom: `champ_${index + 1}`, type: 'string', taux: 100}));
    const report = {
      verdict: 'vert', completude: 'complet', nb: 1, types: {Point: 1}, crs: 'WGS 84',
      emprise: [2, 48, 2, 48], horsMonde: false, anomalies: [], avertissements: [],
      champs: fields, apercu: [Object.fromEntries(fields.map(field => [field.nom, 'valeur']))],
      controles: [], attributs: [], attributsPartiels: false, attributsLimites: false
    };
    const reportHtml = api.htmlRapport(report, '<img src=x onerror=alert(1)>', true);
    assert(!reportHtml.includes('<img src=x'), 'Le nom de fichier permet une injection HTML.');
    match(reportHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, 'Le nom de fichier malveillant n’est pas échappé.');
    match(reportHtml, /nombre de colonnes trop important \(7\)/, 'L’aperçu imprimé trop large n’est pas remplacé par un message clair.');
    for (const field of fields) assert(reportHtml.includes(field.nom), `Champ absent du rapport complet : ${field.nom}`);

    const diagnostic = api.diagnosticRefus({nom: 'archive-cassee.zip', message: 'Archive ZIP invalide.'});
    match(diagnostic, /^GEOVERIF v1\.0 — DIAGNOSTIC D’OUVERTURE/m, 'En-tête du diagnostic incorrect.');
    match(diagnostic, /Fichier : archive-cassee\.zip/, 'Nom du fichier absent du diagnostic.');
    match(diagnostic, /Cause : Archive ZIP invalide\./, 'Cause absente du diagnostic.');
    match(diagnostic, /Contrôle du fichier exécuté localement\./, 'Mention du traitement local absente du diagnostic.');

    const rules = {};
    api.ajouterRegle(rules, 'general', 'avertissement', 'Message général');
    api.ajouterRegle(rules, 'precis', 'probleme', 'Message précis', ['general']);
    api.ajouterRegle(rules, 'precis', 'probleme', 'Message répété');
    api.finaliserRegles(rules);
    equal(rules.anomalies.length, 1, 'Une règle identique ne doit pas être répétée.');
    equal(rules.anomalies[0], 'Message précis', 'La règle précise doit remplacer la règle générale.');

    const tooManyEntries = {files: Object.fromEntries(Array.from({length: 1001}, (_, index) => [`f${index}`, {dir: false, _data: {uncompressedSize: 1}}]))};
    match(api.problemeArchive(tooManyEntries), /limite de sécurité : 1[\s\u202f]?000/, 'Archive contenant trop d’entrées non refusée.');
    const tooLarge = {files: {huge: {dir: false, _data: {uncompressedSize: api.TAILLE_REFUS + 1}}}};
    match(api.problemeArchive(tooLarge), /Archive décompressée/, 'Archive décompressée trop volumineuse non refusée.');

    const wkb = new ArrayBuffer(21);
    const view = new DataView(wkb);
    view.setUint8(0, 1);
    view.setUint32(1, 1, true);
    view.setFloat64(5, 2.35, true);
    view.setFloat64(13, 48.85, true);
    const parsed = api.lireWKBGeom(view, 0);
    equal(parsed.geom.type, 'Point', 'Type WKB Point incorrect.');
    equal(parsed.geom.coordinates.join(','), '2.35,48.85', 'Coordonnées WKB incorrectes.');
  });

  await suite('README et cohérence éditoriale', () => {
    assert(readme.split(/\r?\n/).length < 100, 'Le README n’est plus synthétique.');
    match(readme, /^# GeoVerif$/m, 'Titre du README incorrect.');
    match(readme, /https:\/\/geoverif\.netlify\.app\//, 'Lien vers l’application absent.');
    match(readme, /Aucun fichier importé, attribut ou géométrie exacte n’est transmis/, 'Description de la confidentialité imprécise.');
    match(readme, /5 fichiers ou couches simultanés/, 'Limite de couches absente du README.');
    match(readme, /15 000 entités/, 'Limite d’entités absente du README.');
    match(readme, /250 Mo/, 'Limite de taille absente du README.');
    match(readme, /1 000 entrées/, 'Limite d’archive absente du README.');
    match(readme, /GeoVerif est un outil de contrôle de réception, pas un outil de certification/, 'Limite méthodologique absente du README.');
    assert(!/npm install jsdom/i.test(readme), 'Le README mentionne encore l’ancien audit jsdom.');
  });

  for (const result of suites) {
    console.log(`✓ ${result.name} (${result.assertions} contrôles)`);
  }
  console.log(`\nAudit GeoVerif réussi — ${assertions} contrôles, ${suites.length} domaines.`);
})().catch(error => {
  console.error(`\n✗ Audit GeoVerif échoué\n${error.stack || error.message || error}`);
  process.exitCode = 1;
});
