import { h, ic, vide, segmente } from '../ui.js';
import { getState } from '../store.js';
import { TYPES_ECHEANCE, PRIORITES, compteARebours, trier } from '../deadlines.js';
import { sujet } from '../subjects.js';
import { todayISO, addDays, weekday, formatShort, formatTime } from '../dates.js';
import { ouvrirEcheance, basculerFait } from './sheets.js';

// Filtres conservés le temps de la session.
const filtres = { vue: 'afaire', type: 'tous' };

function groupes(liste, aujourdhui) {
  const finSemaine = addDays(aujourdhui, (7 - weekday(aujourdhui)) % 7); // dimanche
  const finSemaineProchaine = addDays(finSemaine, 7);
  const g = [
    ['En retard', (e) => e.date < aujourdhui],
    ['Aujourd’hui', (e) => e.date === aujourdhui],
    ['Demain', (e) => e.date === addDays(aujourdhui, 1)],
    ['Cette semaine', (e) => e.date > addDays(aujourdhui, 1) && e.date <= finSemaine],
    ['Semaine prochaine', (e) => e.date > finSemaine && e.date <= finSemaineProchaine],
    ['Plus tard', (e) => e.date > finSemaineProchaine],
  ];
  return g.map(([titre, test]) => [titre, liste.filter(test)]).filter(([, l]) => l.length);
}

function item(e, aujourdhui) {
  const t = TYPES_ECHEANCE[e.type];
  const s = sujet(e.matiere);
  const cr = compteARebours(e, aujourdhui);
  return h('li', { class: `dl-item prio-${e.priorite}${e.fait ? ' is-done' : ''}`, style: { '--c': s?.couleur || 'var(--text-3)' } },
    h('button', { class: 'dl-check', type: 'button', 'aria-pressed': e.fait ? 'true' : 'false', 'aria-label': e.fait ? `Marquer « ${e.titre} » comme à faire` : `Marquer « ${e.titre} » comme fait`, onclick: () => basculerFait(e.id) }, ic('check')),
    h('button', { class: 'dl-main', type: 'button', onclick: () => ouvrirEcheance(e) },
      h('span', { class: 'dl-title' }, e.titre),
      h('span', { class: 'dl-meta' },
        h('span', { class: 'dl-type' }, ic(t.icone), t.label),
        s && h('span', { class: 'dl-subject' }, h('i', { class: 'dot' }), s.court),
        h('span', {}, `${formatShort(e.date)}${e.heure ? ` · ${formatTime(e.heure)}` : ''}`),
        h('span', { class: `prio-label prio-${e.priorite}` }, PRIORITES[e.priorite].label),
        e.rappels?.length > 0 && !e.fait && h('span', { class: 'dl-bell', title: 'Rappels programmés' }, ic('bell'), e.rappels.length))),
    !e.fait && h('span', { class: `countdown ${cr.classe}` }, cr.texte));
}

export function vueEcheances(racine) {
  const state = getState();
  const aujourdhui = todayISO();
  const toutes = state.echeances;
  const nbAFaire = toutes.filter((e) => !e.fait).length;
  const nbFaites = toutes.length - nbAFaire;

  const rerender = () => { racine.replaceChildren(); vueEcheances(racine); };

  racine.append(
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `${nbAFaire} à faire`), h('h1', { class: 'page-title' }, 'Échéances')),
      h('button', { class: 'btn btn-primary desktop-only', type: 'button', onclick: () => ouvrirEcheance(null) }, ic('plus'), 'Ajouter')),
    h('div', { class: 'toolbar' },
      segmente('vue', [['afaire', `À faire (${nbAFaire})`], ['faites', `Terminées (${nbFaites})`]], filtres.vue, (v) => { filtres.vue = v; rerender(); }),
      h('div', { class: 'chip-scroll', role: 'group', 'aria-label': 'Filtrer par type' },
        [['tous', 'Tous'], ...Object.entries(TYPES_ECHEANCE).map(([k, t]) => [k, t.label])].map(([k, label]) =>
          h('button', { class: `chip${filtres.type === k ? ' is-active' : ''}`, type: 'button', 'aria-pressed': filtres.type === k ? 'true' : 'false', onclick: () => { filtres.type = k; rerender(); } }, label)))));

  let liste = toutes.filter((e) => (filtres.vue === 'afaire' ? !e.fait : e.fait));
  if (filtres.type !== 'tous') liste = liste.filter((e) => e.type === filtres.type);

  if (!liste.length) {
    racine.append(filtres.vue === 'afaire'
      ? vide('listChecks', toutes.length ? 'Rien dans ce filtre' : 'Aucune échéance', 'Contrôles, devoirs, rendus, oraux… ajoute-les pour ne rien oublier.',
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ouvrirEcheance(null) }, ic('plus'), 'Ajouter une échéance'))
      : vide('check', 'Rien de terminé pour l’instant', 'Les échéances cochées apparaîtront ici.'));
  } else if (filtres.vue === 'afaire') {
    for (const [titre, l] of groupes(liste.sort(trier), aujourdhui)) {
      racine.append(h('section', { class: 'dl-group' },
        h('h2', { class: `dl-group-title${titre === 'En retard' ? ' late' : ''}` }, titre, h('span', { class: 'section-count' }, l.length)),
        h('ul', { class: 'dl-list' }, l.map((e) => item(e, aujourdhui)))));
    }
  } else {
    liste.sort((a, b) => (b.faitLe || '').localeCompare(a.faitLe || ''));
    racine.append(h('ul', { class: 'dl-list' }, liste.map((e) => item(e, aujourdhui))));
  }

  racine.append(h('button', { class: 'fab mobile-only', type: 'button', 'aria-label': 'Ajouter une échéance', onclick: () => ouvrirEcheance(null) }, ic('plus')));
}
