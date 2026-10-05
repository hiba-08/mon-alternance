import { h, ic, vide, segmente } from '../ui.js';
import { getState, update } from '../store.js';
import { LISTES, groupesTaches, nouvelleTache, listeDuJour } from '../tasks.js';
import { infoJour } from '../calendar.js';
import { sujet } from '../subjects.js';
import { todayISO, formatShort, formatTime, diffDays } from '../dates.js';
import { ouvrirTache, basculerTache } from './sheets.js';

// Filtres conservés le temps de la session, et texte en cours dans l'ajout rapide
// (la page peut se redessiner pendant la saisie, par exemple à l'arrivée d'une synchro).
const filtres = { liste: 'toutes', terminees: false };
let brouillon = '';

// jour : page d'un jour donné, où la date de la tâche serait redondante.
export function ligneTache(t, aujourdhui, { avecListe = true, jour = null } = {}) {
  const l = LISTES[t.liste] || LISTES.perso;
  const s = sujet(t.matiere);
  const retard = t.date && t.date < aujourdhui && !t.fait;
  const [jourRappel, heureRappel] = t.rappel ? t.rappel.split('T') : [];
  return h('li', { class: `task-item${t.fait ? ' is-done' : ''}${t.priorite ? ` prio-${t.priorite}` : ''}`, style: { '--c': l.couleur } },
    h('button', {
      class: 'dl-check', type: 'button', 'aria-pressed': t.fait ? 'true' : 'false',
      'aria-label': t.fait ? `Remettre « ${t.titre} » à faire` : `Marquer « ${t.titre} » comme faite`,
      onclick: () => basculerTache(t.id),
    }, ic('check')),
    h('button', { class: 'dl-main', type: 'button', onclick: () => ouvrirTache(t) },
      h('span', { class: 'dl-title' }, t.titre),
      h('span', { class: 'dl-meta' },
        avecListe && h('span', { class: 'list-chip' }, h('i', { class: 'dot' }), l.label),
        t.date && t.date !== jour && h('span', { class: retard ? 'late-text' : '' }, retard ? `${formatShort(t.date)} · ${diffDays(t.date, aujourdhui)} j de retard` : formatShort(t.date)),
        s && h('span', {}, s.court),
        t.priorite === 'haute' && h('span', { class: 'prio-label prio-haute' }, 'Haute'),
        t.rappel && !t.fait && h('span', { class: 'dl-bell', title: 'Notification programmée' }, ic('bell'),
          `${jourRappel === t.date ? '' : `${formatShort(jourRappel)} `}${formatTime(heureRappel)}`))));
}

export function vueTaches(racine) {
  const state = getState();
  const aujourdhui = todayISO();
  const rerender = () => { racine.replaceChildren(); vueTaches(racine); };
  const statutDuJour = infoJour(aujourdhui, { reglages: state.reglages, conges: state.conges }).statut;

  let toutes = state.taches;
  if (filtres.liste !== 'toutes') toutes = toutes.filter((t) => t.liste === filtres.liste);
  const aFaire = toutes.filter((t) => !t.fait);
  const faites = toutes.filter((t) => t.fait).sort((a, b) => (b.faitLe || '').localeCompare(a.faitLe || ''));

  // Ajout rapide : une ligne, la liste du jour par défaut (ou celle du filtre).
  const listeRapide = filtres.liste !== 'toutes' ? filtres.liste : listeDuJour(statutDuJour);
  // data-garder-focus : la page se redessine autour du champ sans lui faire perdre le focus (le clavier reste ouvert).
  const saisie = h('input', {
    type: 'text', class: 'quick-input', value: brouillon, dataset: { garderFocus: 'ajout-tache' },
    placeholder: `Ajouter une tâche (${LISTES[listeRapide].label.toLowerCase()})…`, maxlength: 140, autocomplete: 'off', 'aria-label': 'Nouvelle tâche',
    oninput: (e) => { brouillon = e.target.value; },
  });
  const viderSaisie = () => { brouillon = ''; saisie.value = ''; };
  const ajoutRapide = h('form', { class: 'quick-add card' },
    h('span', { class: 'quick-icon' }, ic('plus')),
    saisie,
    h('button', {
      class: 'btn btn-ghost btn-small', type: 'button',
      onclick: () => { const titre = saisie.value.trim(); viderSaisie(); ouvrirTache(null, { liste: listeRapide, titre }); },
    }, 'Détails'));
  ajoutRapide.addEventListener('submit', (e) => {
    e.preventDefault();
    const titre = saisie.value.trim();
    if (!titre) return;
    viderSaisie();
    update((s) => { s.taches.push(nouvelleTache({ titre, liste: listeRapide })); });
  });

  racine.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `${state.taches.filter((t) => !t.fait).length} à faire`), h('h1', { class: 'page-title' }, 'Tâches')),
      h('button', { class: 'btn btn-primary desktop-only', type: 'button', onclick: () => ouvrirTache(null, { liste: listeRapide }) }, ic('plus'), 'Nouvelle tâche')),
    h('div', { class: 'toolbar' },
      segmente('liste-filtre', [['toutes', 'Toutes'], ...Object.entries(LISTES).map(([k, l]) => [k, l.label])], filtres.liste, (v) => { filtres.liste = v; rerender(); }),
      ajoutRapide));

  if (!aFaire.length) {
    racine.append(vide('checkSquare', 'Rien à faire', 'Ajoute une tâche ci-dessus : une ligne suffit. Tu pourras ajouter une date, une matière ou une notification ensuite.'));
  } else {
    for (const [titre, liste] of groupesTaches(aFaire, aujourdhui)) {
      racine.append(h('section', { class: 'dl-group' },
        h('h2', { class: `dl-group-title${titre === 'En retard' ? ' late' : ''}` }, titre, h('span', { class: 'section-count' }, liste.length)),
        h('ul', { class: 'dl-list' }, liste.map((t) => ligneTache(t, aujourdhui, { avecListe: filtres.liste === 'toutes' })))));
    }
  }

  if (faites.length) {
    racine.append(h('section', { class: 'dl-group' },
      h('button', { class: 'collapse-toggle', type: 'button', 'aria-expanded': filtres.terminees ? 'true' : 'false', onclick: () => { filtres.terminees = !filtres.terminees; rerender(); } },
        ic(filtres.terminees ? 'chevronLeft' : 'chevronRight'), `Terminées (${faites.length})`),
      filtres.terminees && h('ul', { class: 'dl-list' }, faites.slice(0, 50).map((t) => ligneTache(t, aujourdhui)))));
  }

  racine.append(h('button', { class: 'fab mobile-only', type: 'button', 'aria-label': 'Nouvelle tâche', onclick: () => ouvrirTache(null, { liste: listeRapide }) }, ic('plus')));
}
