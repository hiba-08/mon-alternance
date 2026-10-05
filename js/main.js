import { h, ic, toast } from './ui.js';
import { getState, update, subscribe } from './store.js';
import { chargerCalendrierLocal, calendrierPret } from './calendar.js';
import { chargerCours, tousLesCours } from './courses.js';
import { echeancesExamens, momentRappel, RAPPELS } from './deadlines.js';
import { formatShort } from './dates.js';
import * as cloud from './cloud.js';
import { vueAujourdhui } from './views/today.js';
import { vueEcheances } from './views/echeances.js';
import { vueAgenda } from './views/agenda.js';
import { vueTaches } from './views/taches.js';
import { vueConges } from './views/conges.js';
import { vueReglages } from './views/reglages.js';
import { vuePlus, vueSources } from './views/plus.js';
import { vueConnexion, vueNouveauMotDePasse } from './views/connexion.js';

const ROUTES = {
  aujourdhui: { vue: vueAujourdhui, titre: 'Aujourd’hui', onglet: 'aujourdhui' },
  agenda: { vue: vueAgenda, titre: 'Agenda', onglet: 'agenda' },
  echeances: { vue: vueEcheances, titre: 'Échéances', onglet: 'echeances' },
  taches: { vue: vueTaches, titre: 'Tâches', onglet: 'taches' },
  plus: { vue: vuePlus, titre: 'Plus', onglet: 'plus' },
  conges: { vue: vueConges, titre: 'Congés', onglet: 'plus' },
  reglages: { vue: vueReglages, titre: 'Réglages', onglet: 'plus' },
  sources: { vue: vueSources, titre: 'Sources et règles', onglet: 'plus' },
};

const NAV = [
  { route: 'aujourdhui', icone: 'sun', label: 'Aujourd’hui' },
  { route: 'agenda', icone: 'calendar', label: 'Agenda' },
  { route: 'echeances', icone: 'listChecks', label: 'Échéances' },
  { route: 'taches', icone: 'checkSquare', label: 'Tâches' },
  { route: 'conges', icone: 'umbrella', label: 'Congés', bureau: true },
  { route: 'reglages', icone: 'sliders', label: 'Réglages', bureau: true },
  { route: 'sources', icone: 'info', label: 'Sources et règles', bureau: true },
  { route: 'plus', icone: 'grid', label: 'Plus', mobile: true },
];

const LIBELLES_SYNCHRO = {
  'a-jour': 'Synchronisé',
  synchro: 'Synchronisation…',
  'hors-ligne': 'Hors ligne',
  erreur: 'Synchronisation interrompue',
  inactif: '',
};

function routeCourante() {
  const [, nom = 'aujourdhui', param = ''] = location.hash.match(/^#\/?([^/]*)\/?(.*)$/) || [];
  return { nom: ROUTES[nom] ? nom : 'aujourdhui', param };
}

function construireNavigation() {
  const lien = (item) => h('a', { href: `#/${item.route}`, dataset: { route: item.route } }, ic(item.icone), h('span', {}, item.label));
  document.querySelector('.sidebar').append(
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 32, height: 32 }), h('span', {}, 'Mon Alternance')),
    ...NAV.filter((i) => !i.mobile).map(lien),
    h('p', { class: 'sidebar-foot', id: 'etat-synchro' }));
  document.querySelector('.tabbar').append(...NAV.filter((i) => !i.bureau).map(lien));
}

function majPiedDePage() {
  const pied = document.getElementById('etat-synchro');
  if (!pied) return;
  if (cloud.modeLocal()) {
    pied.textContent = 'Mode local · ce navigateur uniquement';
    pied.className = 'sidebar-foot';
    return;
  }
  const { statut, enAttente } = cloud.etat;
  pied.textContent = `${LIBELLES_SYNCHRO[statut] || ''}${enAttente ? ` · ${enAttente} en attente` : ''}`;
  pied.className = `sidebar-foot sync-${statut}`;
}

function appliquerTheme() {
  const { theme } = getState().reglages;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function acces() {
  if (cloud.modeLocal()) return 'app';
  const e = cloud.etat;
  if (!e.pret) return 'chargement';
  if (e.recuperation) return 'mot-de-passe';
  if (e.session) return 'app';
  if (!e.bibliotheque && e.sessionMemorisee) return 'app'; // hors ligne, déjà connectée sur cet appareil
  return 'connexion';
}

function vueAttente() {
  const e = cloud.etat;
  const enCours = e.statut === 'synchro' || e.statut === 'inactif';
  return h('div', { class: 'empty attente' },
    h('div', { class: 'empty-icon' }, ic(enCours ? 'refresh' : 'calendar')),
    h('p', { class: 'empty-title' }, enCours ? 'Préparation de ton calendrier…' : 'Calendrier pas encore disponible'),
    !enCours && h('p', { class: 'empty-text' }, e.erreur
      ? `La synchronisation a échoué : ${e.erreur}`
      : 'Il sera envoyé dans ton compte depuis ton Mac : ouvre l’app avec « Lancer l’app.command » et connecte-toi.'),
    !enCours && h('button', { class: 'btn btn-soft', type: 'button', onclick: () => cloud.synchroniser() }, ic('refresh'), 'Réessayer'));
}

function afficher({ hautDePage = false } = {}) {
  const vue = document.getElementById('view');
  const etape = acces();
  document.body.classList.toggle('sans-nav', etape !== 'app');
  majPiedDePage();
  const defilement = window.scrollY;
  vue.replaceChildren();
  if (etape === 'chargement') {
    vue.append(h('div', { class: 'empty attente' }, h('p', { class: 'empty-title' }, 'Chargement…')));
    return;
  }
  if (etape === 'connexion') {
    document.title = 'Connexion · Mon Alternance';
    vueConnexion(vue);
    return;
  }
  if (etape === 'mot-de-passe') {
    document.title = 'Nouveau mot de passe · Mon Alternance';
    vueNouveauMotDePasse(vue);
    return;
  }

  const { nom, param } = routeCourante();
  const route = ROUTES[nom];
  if (!calendrierPret() && nom !== 'reglages') {
    vue.append(vueAttente());
  } else {
    route.vue(vue, param);
  }
  document.title = `${route.titre} · Mon Alternance`;
  document.querySelectorAll('.sidebar a, .tabbar a').forEach((a) => {
    const actif = a.dataset.route === nom || (a.closest('.tabbar') && a.dataset.route === route.onglet);
    if (actif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, hautDePage ? 0 : defilement);
}

// Regroupe les demandes d'affichage ; attend la fin d'une saisie pour ne pas effacer un champ en cours.
// Exception : un champ marqué data-garder-focus (ajout rapide) est recréé par sa vue avec son texte,
// et il retrouve aussitôt le focus et la position du curseur.
let affichagePrevu = false;
function planifierAffichage() {
  if (affichagePrevu) return;
  affichagePrevu = true;
  const lancer = () => requestAnimationFrame(() => {
    // Vérifié au moment d'afficher : une saisie a pu commencer depuis la demande.
    const actif = document.activeElement;
    const enSaisie = actif?.closest?.('#view') && actif.matches('input, textarea, select');
    const garder = enSaisie ? actif.dataset.garderFocus : null;
    if (enSaisie && !garder) {
      actif.addEventListener('blur', lancer, { once: true });
      return;
    }
    const curseur = garder && { texte: actif.value, debut: actif.selectionStart, fin: actif.selectionEnd };
    affichagePrevu = false;
    afficher();
    if (garder) rendreFocus(garder, curseur);
  });
  lancer();
}

function rendreFocus(cle, curseur) {
  const champ = document.querySelector(`#view [data-garder-focus="${cle}"]`);
  if (!champ) return;
  champ.focus({ preventScroll: true });
  const memeTexte = champ.value === curseur.texte;
  champ.setSelectionRange(memeTexte ? curseur.debut : champ.value.length, memeTexte ? curseur.fin : champ.value.length);
}

// Les séances marquées « EXAMEN » dans NetYParéo deviennent des échéances (une seule fois par séance).
function ajouterExamens() {
  if (!cloud.modeLocal() && cloud.etat.session && !cloud.premiereSynchroFaite()) return;
  const examens = echeancesExamens(getState(), tousLesCours(getState()));
  if (!examens.length) return;
  update((s) => { s.echeances.push(...examens); });
  toast(`${examens.length} examen${examens.length > 1 ? 's' : ''} trouvé${examens.length > 1 ? 's' : ''} dans NetYParéo et ajouté${examens.length > 1 ? 's' : ''} aux échéances`);
}

// Mode local uniquement : notification système pendant que l'app est ouverte.
// En ligne, les rappels sont envoyés par le serveur (fonction « rappels »).
function verifierRappels() {
  if (!cloud.modeLocal()) return;
  const state = getState();
  const { reglages } = state;
  if (!reglages.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const maintenant = new Date();
  const envoyes = [];
  for (const e of state.echeances) {
    if (e.fait) continue;
    for (const j of e.rappels || []) {
      const cle = `${e.id}:${j}:${e.date}`;
      if (state.rappelsEnvoyes[cle]) continue;
      const moment = momentRappel(e, j, reglages.heureRappels);
      if (moment <= maintenant && maintenant - moment < 24 * 3600 * 1000) {
        const quand = RAPPELS.find((r) => r.j === j)?.label.toLowerCase() || '';
        new Notification(e.titre, { body: `${j === 0 ? 'C’est aujourd’hui' : `Rappel (${quand})`} · ${formatShort(e.date)}`, icon: 'icons/icon-192.png', tag: cle });
        envoyes.push(cle);
      }
    }
  }
  if (envoyes.length) update((s) => { envoyes.forEach((c) => { s.rappelsEnvoyes[c] = new Date().toISOString(); }); });
}

async function demarrer() {
  appliquerTheme();
  construireNavigation();
  afficher();

  // Fichiers locaux (présents seulement sur le Mac, absents de la version en ligne) et connexion au compte.
  const fichiersLocaux = cloud.estLocalhost() || !cloud.cloudConfigure;
  await Promise.all([cloud.initialiser(), fichiersLocaux ? chargerCours() : null]);
  if (!calendrierPret() && fichiersLocaux) await chargerCalendrierLocal();
  ajouterExamens();

  window.addEventListener('hashchange', () => afficher({ hautDePage: true }));
  window.matchMedia('(min-width: 900px)').addEventListener('change', () => {
    if (routeCourante().nom === 'agenda') planifierAffichage();
  });
  subscribe(() => { appliquerTheme(); planifierAffichage(); });
  let examensPrevus = null;
  cloud.surChangement(() => {
    planifierAffichage();
    clearTimeout(examensPrevus);
    examensPrevus = setTimeout(ajouterExamens, 500);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) planifierAffichage(); });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const nom = routeCourante().nom;
    if (nom !== 'aujourdhui' && nom !== 'agenda') return;
    const fleche = (nom === 'aujourdhui'
      ? { ArrowLeft: 'Jour précédent', ArrowRight: 'Jour suivant' }
      : { ArrowLeft: 'Semaine précédente|Mois précédent', ArrowRight: 'Semaine suivante|Mois suivant' })[e.key];
    if (fleche) {
      const cible = fleche.split('|').map((l) => document.querySelector(`[aria-label="${l}"]`)).find(Boolean);
      cible?.click();
    }
  });
  setInterval(() => {
    verifierRappels();
    if (routeCourante().nom === 'aujourdhui' && !document.querySelector('dialog[open]')) planifierAffichage();
  }, 60 * 1000);

  afficher();
  verifierRappels();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré', err));
    // Clic sur une notification alors que l'app est déjà ouverte : aller à la bonne page.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'ouvrir' && e.data.hash) location.hash = e.data.hash;
    });
  }
}

demarrer();
