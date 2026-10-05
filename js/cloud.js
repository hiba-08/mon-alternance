// Synchronisation avec Supabase (V2) : connexion, échange des données personnelles entre appareils,
// emploi du temps et calendrier stockés en ligne, notifications push.
//
// Principe : l'app travaille toujours sur ses données locales (affichage immédiat, hors ligne possible).
// Chaque modification locale est détectée par comparaison, mise en file puis envoyée ;
// les modifications des autres appareils arrivent en temps réel ou à la prochaine synchronisation.
// En cas de conflit, la modification la plus récente l'emporte, élément par élément.
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, SUPABASE_JS } from './config.js';
import { getState, update, subscribe, reinitialiser } from './store.js';
import { definirCalendrier, FICHIER_CALENDRIER } from './calendar.js';
import { definirSeancesNuage, FICHIER_COURS } from './courses.js';

export const cloudConfigure = Boolean(SUPABASE_URL && SUPABASE_CLE_PUBLIQUE);

const CLE_SYNCHRO = 'mon-alternance:synchro';
const CLE_CACHE = 'mon-alternance:cache';
const CLE_MODE_LOCAL = 'mon-alternance:mode-local';
const PAGE = 1000;

let supabase = null;
let canal = null;
let minuterieSeances = null;

// État affiché par l'interface.
export const etat = {
  pret: false,
  bibliotheque: false,
  session: null,
  email: null,
  sessionMemorisee: false,
  recuperation: false, // lien « mot de passe oublié » ouvert : choisir un nouveau mot de passe
  statut: 'inactif', // inactif | synchro | a-jour | hors-ligne | erreur
  erreur: null,
  enAttente: 0,
  derniereSynchro: null,
  synchroEdt: null, // dernière mise à jour de l'emploi du temps (table synchros)
  lienEdt: undefined, // date d'enregistrement du lien NetYParéo, null s'il n'y en a pas
};

const ecouteurs = new Set();
export function surChangement(fn) {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}
const signaler = () => ecouteurs.forEach((fn) => fn(etat));

// ---------- Mode local (test sur le Mac sans compte) ----------

export const estLocalhost = () => ['localhost', '127.0.0.1'].includes(location.hostname);
export function modeLocal() {
  if (!cloudConfigure) return true;
  try { return estLocalhost() && localStorage.getItem(CLE_MODE_LOCAL) === '1'; } catch { return false; }
}
export function choisirModeLocal(actif) {
  try {
    if (actif) localStorage.setItem(CLE_MODE_LOCAL, '1');
    else localStorage.removeItem(CLE_MODE_LOCAL);
  } catch { /* stockage indisponible */ }
  signaler();
}

// ---------- Mémoire locale de la synchronisation ----------

const vierge = () => ({ userId: null, curseur: null, empreintes: {}, enAttente: {} });
function lireJSON(cle, defaut) {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrireJSON(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { console.warn('Stockage local plein ?', e); }
}
let synchro = lireJSON(CLE_SYNCHRO, vierge());
function sauverSynchro() {
  ecrireJSON(CLE_SYNCHRO, synchro);
  etat.enAttente = Object.keys(synchro.enAttente).length;
}

// JSON à clés triées : deux objets identiques donnent toujours la même empreinte.
function stable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map(stable).join(',')}]`;
  if (valeur && typeof valeur === 'object') {
    return `{${Object.keys(valeur).sort().filter((k) => valeur[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(valeur[k])}`).join(',')}}`;
  }
  return JSON.stringify(valeur ?? null);
}

// ---------- Correspondance état local ↔ éléments de la base ----------

function elementsLocaux(s) {
  const m = new Map();
  for (const e of s.echeances) m.set(e.id, { collection: 'echeances', donnees: e });
  for (const c of s.conges) m.set(c.id, { collection: 'conges', donnees: c });
  for (const [uid, modif] of Object.entries(s.coursModifies)) m.set(`cours:${uid}`, { collection: 'coursModifies', donnees: { uid, ...modif } });
  for (const uid of s.examensIgnores) m.set(`examen-ignore:${uid}`, { collection: 'examensIgnores', donnees: { uid } });
  const { notifications, ...reglages } = s.reglages; // l'activation des notifications est propre à chaque appareil
  m.set('reglages', { collection: 'reglages', donnees: reglages });
  return m;
}

function appliquerElement(s, l) {
  switch (l.collection) {
    case 'echeances':
    case 'conges': {
      const liste = s[l.collection];
      const i = liste.findIndex((x) => x.id === l.id);
      if (l.supprime) { if (i >= 0) liste.splice(i, 1); } else if (i >= 0) liste[i] = l.donnees;
      else liste.push(l.donnees);
      break;
    }
    case 'coursModifies': {
      const { uid, ...modif } = l.donnees;
      if (!uid) break;
      if (l.supprime) delete s.coursModifies[uid];
      else s.coursModifies[uid] = modif;
      break;
    }
    case 'examensIgnores': {
      const uid = l.donnees?.uid || l.id.replace('examen-ignore:', '');
      s.examensIgnores = s.examensIgnores.filter((u) => u !== uid);
      if (!l.supprime) s.examensIgnores.push(uid);
      break;
    }
    case 'reglages':
      if (!l.supprime) {
        s.reglages = { ...s.reglages, ...l.donnees, horaires: { ...s.reglages.horaires, ...l.donnees.horaires }, notifications: s.reglages.notifications };
      }
      break;
    default:
      break;
  }
}

function majEmpreintes(ids) {
  const actuels = elementsLocaux(getState());
  for (const id of ids) {
    const el = actuels.get(id);
    if (el) synchro.empreintes[id] = { c: el.collection, j: stable(el.donnees) };
    else delete synchro.empreintes[id];
  }
}

// Après chaque modification locale : ce qui a changé part dans la file d'envoi.
function detecterChangements() {
  if (!etat.session) return;
  const actuels = elementsLocaux(getState());
  const maintenant = new Date().toISOString();
  let change = false;
  for (const [id, el] of actuels) {
    const j = stable(el.donnees);
    if (synchro.empreintes[id]?.j !== j) {
      synchro.enAttente[id] = { id, collection: el.collection, donnees: el.donnees, supprime: false, modifie_le: maintenant };
      synchro.empreintes[id] = { c: el.collection, j };
      change = true;
    }
  }
  for (const [id, { c }] of Object.entries(synchro.empreintes)) {
    if (!actuels.has(id)) {
      synchro.enAttente[id] = { id, collection: c, donnees: {}, supprime: true, modifie_le: maintenant };
      delete synchro.empreintes[id];
      change = true;
    }
  }
  if (change) {
    sauverSynchro();
    planifierSynchro(600);
  }
}

// Modifications reçues : la plus récente l'emporte, élément par élément.
function appliquerDistants(lignes) {
  const retenues = [];
  for (const l of lignes) {
    const local = synchro.enAttente[l.id];
    if (local && Date.parse(local.modifie_le) > Date.parse(l.modifie_le)) continue;
    if (local) delete synchro.enAttente[l.id];
    const connu = synchro.empreintes[l.id];
    if (l.supprime ? !connu : connu?.j === stable(l.donnees)) continue;
    retenues.push(l);
  }
  if (retenues.length) update((s) => { for (const l of retenues) appliquerElement(s, l); }, { distant: true });
  majEmpreintes(retenues.map((l) => l.id));
  sauverSynchro();
}

// ---------- Échanges avec Supabase ----------

async function toutRecevoir(depuis) {
  const lignes = [];
  for (let page = 0; ; page++) {
    let q = supabase.from('elements').select('id,collection,donnees,supprime,modifie_le,synchro_le')
      .order('synchro_le').range(page * PAGE, page * PAGE + PAGE - 1);
    // Recouvrement de 2 minutes : rien n'est perdu si deux appareils écrivent en même temps.
    if (depuis) q = q.gt('synchro_le', new Date(Date.parse(depuis) - 120000).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    lignes.push(...data);
    if (data.length < PAGE) break;
  }
  return lignes;
}

const plusRecent = (lignes, depart) => lignes.reduce((m, l) => (!m || Date.parse(l.synchro_le) > Date.parse(m) ? l.synchro_le : m), depart);

async function envoyer() {
  const lignes = Object.values(synchro.enAttente);
  for (let i = 0; i < lignes.length; i += 200) {
    const lot = lignes.slice(i, i + 200);
    const { error } = await supabase.rpc('pousser_elements', { lignes: lot });
    if (error) throw error;
    for (const l of lot) if (synchro.enAttente[l.id] === l) delete synchro.enAttente[l.id];
    sauverSynchro();
  }
}

// Première connexion sur cet appareil : on récupère d'abord tout le compte, puis on envoie
// ce qui n'existe que sur l'appareil (par exemple les données saisies dans la V1 locale).
async function premiereSynchro() {
  const distants = await toutRecevoir(null);
  const presents = new Set(distants.map((l) => l.id));
  if (distants.length) update((s) => { for (const l of distants) appliquerElement(s, l); }, { distant: true });
  synchro.empreintes = {};
  const maintenant = new Date().toISOString();
  for (const [id, el] of elementsLocaux(getState())) {
    synchro.empreintes[id] = { c: el.collection, j: stable(el.donnees) };
    if (!presents.has(id)) {
      synchro.enAttente[id] = { id, collection: el.collection, donnees: el.donnees, supprime: false, modifie_le: maintenant };
    }
  }
  synchro.curseur = plusRecent(distants, null) || new Date(0).toISOString();
  sauverSynchro();
  await envoyer();
}

// Depuis le Mac (version locale) : envoie le calendrier du PDF et les séances extraites de NetYParéo
// s'ils ne sont pas encore en ligne. Sans effet sur la version en ligne, qui n'a pas ces fichiers.
async function televerserReferences() {
  const { data: doc, error } = await supabase.from('documents').select('cle').eq('cle', 'calendrier').maybeSingle();
  if (error) throw error;
  if (!doc) {
    const r = await fetch(FICHIER_CALENDRIER).catch(() => null);
    if (r?.ok) {
      const { error: e } = await supabase.from('documents').insert({ cle: 'calendrier', donnees: await r.json() });
      if (e) throw e;
    }
  }
  const { count, error: e2 } = await supabase.from('seances').select('uid', { count: 'exact', head: true });
  if (e2) throw e2;
  if (!count) {
    const r = await fetch(FICHIER_COURS).catch(() => null);
    if (r?.ok) {
      const j = await r.json();
      const lignes = j.seances.map((s) => ({
        uid: s.uid, date: s.date, debut: s.debut, fin: s.fin, intitule: s.intitule,
        enseignant: s.enseignant ?? null, salle: s.salle ?? null, groupes: s.groupes ?? j.groupesParDefaut ?? null,
        lieu: s.lieu ?? null, mentions: s.mentions ?? [], source: 'page-web',
      }));
      const { error: e } = await supabase.from('seances').insert(lignes);
      if (e) throw e;
    }
  }
}

async function chargerSeances() {
  const seances = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('seances')
      .select('uid,date,debut,fin,intitule,enseignant,salle,groupes,lieu,mentions,annulee')
      .order('date').order('debut').range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    seances.push(...data);
    if (data.length < PAGE) break;
  }
  const cache = lireJSON(CLE_CACHE, {});
  cache.seances = seances;
  ecrireJSON(CLE_CACHE, cache);
  definirSeancesNuage(seances.length ? seances : null);
}

async function chargerCalendrierNuage() {
  const { data, error } = await supabase.from('documents').select('donnees').eq('cle', 'calendrier').maybeSingle();
  if (error) throw error;
  if (data?.donnees) {
    definirCalendrier(data.donnees);
    const cache = lireJSON(CLE_CACHE, {});
    cache.calendrier = data.donnees;
    ecrireJSON(CLE_CACHE, cache);
  }
}

async function chargerInfosEdt() {
  const [derniere, lien] = await Promise.all([
    supabase.from('synchros').select('lancee_le,declencheur,statut,nb_seances,ajouts,modifications,annulations,message')
      .order('lancee_le', { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc('lien_netypareo_configure'),
  ]);
  if (!derniere.error) etat.synchroEdt = derniere.data;
  if (!lien.error) etat.lienEdt = lien.data ?? null;
}

let enCours = null;
let relancer = false;
let minuterie = null;

function planifierSynchro(delai = 0) {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => synchroniser(), delai);
}

export function synchroniser() {
  if (!supabase || !etat.session) return Promise.resolve();
  if (enCours) {
    relancer = true;
    return enCours;
  }
  enCours = (async () => {
    etat.statut = 'synchro';
    signaler();
    try {
      if (!synchro.curseur) {
        await premiereSynchro();
      } else {
        await envoyer();
        const lignes = await toutRecevoir(synchro.curseur);
        appliquerDistants(lignes);
        synchro.curseur = plusRecent(lignes, synchro.curseur);
        sauverSynchro();
      }
      const cache = lireJSON(CLE_CACHE, {});
      if (!cache.calendrier || !cache.seances?.length) await televerserReferences();
      await Promise.all([chargerSeances(), chargerCalendrierNuage(), chargerInfosEdt()]);
      etat.statut = 'a-jour';
      etat.erreur = null;
      etat.derniereSynchro = new Date().toISOString();
    } catch (e) {
      etat.statut = navigator.onLine ? 'erreur' : 'hors-ligne';
      etat.erreur = traduire(e);
      console.warn('Synchronisation interrompue', e);
    } finally {
      enCours = null;
      signaler();
      if (relancer) {
        relancer = false;
        planifierSynchro(0);
      } else if (etat.enAttente) {
        planifierSynchro(30000); // nouvel essai dans 30 s
      }
    }
  })();
  return enCours;
}

function demarrerTempsReel() {
  arreterTempsReel();
  const id = etat.session.user.id;
  canal = supabase.channel(`mon-alternance-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'elements', filter: `user_id=eq.${id}` }, (p) => {
      if (p.new?.id) appliquerDistants([p.new]);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'seances', filter: `user_id=eq.${id}` }, () => {
      clearTimeout(minuterieSeances);
      minuterieSeances = setTimeout(() => chargerSeances().then(signaler).catch(() => {}), 1500);
    })
    .subscribe();
}

function arreterTempsReel() {
  if (canal) supabase.removeChannel(canal);
  canal = null;
}

function appliquerSession(session) {
  const avant = etat.session?.user?.id;
  etat.session = session;
  etat.email = session?.user?.email ?? null;
  if (session) {
    if (synchro.userId && synchro.userId !== session.user.id) synchro = vierge(); // autre compte sur cet appareil
    synchro.userId = session.user.id;
    sauverSynchro();
    if (avant !== session.user.id) {
      demarrerTempsReel();
      synchroniser();
    }
  } else {
    arreterTempsReel();
  }
  signaler();
}

// ---------- Démarrage ----------

export async function initialiser() {
  if (!cloudConfigure) {
    etat.pret = true;
    return;
  }
  // Données déjà reçues : affichage immédiat, même hors ligne.
  const cache = lireJSON(CLE_CACHE, {});
  if (cache.calendrier) definirCalendrier(cache.calendrier);
  if (cache.seances?.length) definirSeancesNuage(cache.seances);
  try {
    etat.sessionMemorisee = Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch { /* stockage indisponible */ }

  try {
    const { createClient } = await import(SUPABASE_JS);
    supabase = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    etat.bibliotheque = true;
  } catch (e) {
    console.warn('Supabase indisponible', e);
    etat.statut = 'hors-ligne';
    etat.pret = true;
    signaler();
    return;
  }

  supabase.auth.onAuthStateChange((evenement, session) => {
    if (evenement === 'PASSWORD_RECOVERY') etat.recuperation = true;
    // Différé : la documentation Supabase déconseille d'appeler l'API dans ce rappel.
    setTimeout(() => appliquerSession(session), 0);
  });
  const { data } = await supabase.auth.getSession();
  appliquerSession(data.session);
  etat.pret = true;
  if (!data.session && !navigator.onLine) etat.statut = 'hors-ligne';

  window.addEventListener('online', () => synchroniser());
  window.addEventListener('offline', () => { etat.statut = 'hors-ligne'; signaler(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) synchroniser(); });
  subscribe((_s, { distant }) => { if (!distant) detecterChangements(); });
  signaler();
}

export const premiereSynchroFaite = () => Boolean(synchro.curseur);

// ---------- Compte ----------

const urlApp = () => location.origin + location.pathname;

export async function connexion(email, motDePasse) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error(traduire(error));
}

export async function inscription(email, motDePasse) {
  const { data, error } = await supabase.auth.signUp({ email, password: motDePasse, options: { emailRedirectTo: urlApp() } });
  if (error) throw new Error(traduire(error));
  return { confirmationRequise: !data.session };
}

export async function motDePasseOublie(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: urlApp() });
  if (error) throw new Error(traduire(error));
}

export async function nouveauMotDePasse(motDePasse) {
  const { error } = await supabase.auth.updateUser({ password: motDePasse });
  if (error) throw new Error(traduire(error));
  etat.recuperation = false;
  signaler();
}

// Se déconnecter efface les données de cet appareil : elles restent dans le compte.
export async function deconnexion() {
  arreterTempsReel();
  await supabase.auth.signOut();
  etat.session = null;
  synchro = vierge();
  sauverSynchro();
  ecrireJSON(CLE_CACHE, {});
  definirSeancesNuage(null);
  reinitialiser({ distant: true });
  signaler();
}

// ---------- Emploi du temps ----------

export async function enregistrerLienNetypareo(lien) {
  const { error } = await supabase.rpc('enregistrer_lien_netypareo', { lien });
  if (error) throw new Error(traduire(error));
  await chargerInfosEdt();
  signaler();
}

export async function mettreAJourEdt() {
  const { data, error } = await supabase.functions.invoke('synchro-netypareo', { body: {} });
  if (error) throw new Error(await messageFonction(error));
  await Promise.all([chargerSeances(), chargerInfosEdt()]);
  signaler();
  return data?.resultats?.[0] ?? null;
}

// ---------- Notifications push ----------

export const pushDisponible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const estInstallee = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const estIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function nomAppareil() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'Navigateur';
}

function versOctets(base64url) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function abonnementActuel() {
  if (!pushDisponible()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// À appeler directement depuis un clic : iOS exige un geste de l'utilisatrice pour demander l'autorisation.
export async function activerNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées. Tu peux les autoriser dans les réglages de l’appareil.');
  const { data, error } = await supabase.functions.invoke('rappels', { body: { action: 'cle' } });
  if (error) throw new Error(await messageFonction(error));
  const reg = await navigator.serviceWorker.ready;
  let abonnement = await reg.pushManager.getSubscription();
  if (!abonnement) {
    abonnement = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(data.cle) });
  }
  const json = abonnement.toJSON();
  const { error: e } = await supabase.from('abonnements_push')
    .upsert({ endpoint: json.endpoint, cles: json.keys, appareil: nomAppareil() }, { onConflict: 'endpoint' });
  if (e) throw new Error(traduire(e));
  update((s) => { s.reglages.notifications = true; });
}

export async function desactiverNotifications() {
  const abonnement = await abonnementActuel();
  if (abonnement) {
    await supabase.from('abonnements_push').delete().eq('endpoint', abonnement.endpoint);
    await abonnement.unsubscribe();
  }
  update((s) => { s.reglages.notifications = false; });
}

export async function notificationTest() {
  const { data, error } = await supabase.functions.invoke('rappels', { body: { action: 'test' } });
  if (error) throw new Error(await messageFonction(error));
  return data;
}

export async function appareilsAbonnes() {
  const { data } = await supabase.from('abonnements_push').select('appareil,cree_le,dernier_envoi').order('cree_le');
  return data ?? [];
}

// ---------- Messages d'erreur en français ----------

function traduire(e) {
  const m = (e?.message || String(e || '')).toString();
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cette adresse.';
  if (/Signups not allowed|signup.*disabled/i.test(m)) return 'Les inscriptions sont fermées sur ce projet.';
  if (/Email not confirmed/i.test(m)) return 'Confirme d’abord ton adresse e-mail (lien reçu par mail).';
  if (/Password should be|password.*(short|weak)/i.test(m)) return 'Mot de passe trop faible : au moins 8 caractères, avec lettres et chiffres.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives : réessaie dans quelques minutes.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Pas de connexion internet.';
  if (/NetYParéo/.test(m)) return m;
  return m || 'Erreur inconnue.';
}

async function messageFonction(error) {
  try {
    const corps = await error.context?.json();
    if (corps?.erreur) return corps.erreur;
    if (corps?.message) return corps.message;
  } catch { /* réponse illisible */ }
  return traduire(error);
}
