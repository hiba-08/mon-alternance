import { h, ic, vide } from '../ui.js';
import { getState } from '../store.js';
import { TYPES_CONGE, joursOuvres } from '../calendar.js';
import { todayISO, formatShort } from '../dates.js';
import { ouvrirConge } from './sheets.js';

export function vueConges(racine) {
  const state = getState();
  const aujourdhui = todayISO();
  const conges = [...state.conges].sort((a, b) => a.du.localeCompare(b.du));
  const aVenir = conges.filter((c) => c.au >= aujourdhui);
  const passes = conges.filter((c) => c.au < aujourdhui).reverse();
  const total = conges.reduce((n, c) => n + joursOuvres(c.du, c.au), 0);
  const parType = {};
  for (const c of conges) parType[c.type] = (parType[c.type] || 0) + joursOuvres(c.du, c.au);

  racine.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Entreprise'), h('h1', { class: 'page-title' }, 'Congés')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ouvrirConge(null) }, ic('plus'), 'Poser')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, total), h('span', { class: 'stat-label' }, `jour${total > 1 ? 's' : ''} ouvré${total > 1 ? 's' : ''} posé${total > 1 ? 's' : ''}`)),
      Object.keys(parType).length > 1 && Object.entries(parType).map(([t, n]) => h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, n), h('span', { class: 'stat-label' }, TYPES_CONGE[t])))),
    h('p', { class: 'hint' }, ic('info'), 'Les jours de congé remplacent « Entreprise » dans la vue Aujourd’hui. Jours ouvrés comptés du lundi au vendredi, hors jours fériés.'));

  if (!conges.length) {
    racine.append(vide('umbrella', 'Aucun congé posé', 'Ajoute tes congés pour savoir chaque jour où tu dois être.',
      h('button', { class: 'btn btn-soft', type: 'button', onclick: () => ouvrirConge(null) }, ic('plus'), 'Poser un congé')));
    return;
  }

  const carte = (c) => {
    const n = joursOuvres(c.du, c.au);
    const enCours = c.du <= aujourdhui && aujourdhui <= c.au;
    return h('li', {},
      h('button', { class: `leave-card${enCours ? ' is-current' : ''}`, type: 'button', onclick: () => ouvrirConge(c) },
        h('span', { class: 'status-icon small', style: { '--st': 'var(--st-conge)' } }, ic('umbrella')),
        h('span', { class: 'leave-text' },
          h('strong', {}, c.du === c.au ? formatShort(c.du, { annee: true }) : `Du ${formatShort(c.du)} au ${formatShort(c.au, { annee: true })}`),
          h('span', { class: 'muted' }, `${TYPES_CONGE[c.type]} · ${n} jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''}${c.note ? ` · ${c.note}` : ''}`)),
        enCours ? h('span', { class: 'badge badge-conge' }, 'En cours') : ic('chevronRight')));
  };
  if (aVenir.length) racine.append(h('section', { class: 'section' }, h('h2', { class: 'section-title' }, 'À venir'), h('ul', { class: 'leave-list' }, aVenir.map(carte))));
  if (passes.length) racine.append(h('section', { class: 'section' }, h('h2', { class: 'section-title' }, 'Passés'), h('ul', { class: 'leave-list' }, passes.map(carte))));
}
