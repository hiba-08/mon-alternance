import { h, ic, segmente } from '../ui.js';
import { getState } from '../store.js';
import { infoJour, STATUTS } from '../calendar.js';
import { coursDuJour, regrouper } from '../courses.js';
import { TYPES_ECHEANCE } from '../deadlines.js';
import { LISTES } from '../tasks.js';
import {
  todayISO, addDays, parseISO, weekday, isoWeek, isWeekend, formatShort, formatLong, formatTime,
  cap, isValidISO, JOURS_COURTS, MOIS, toMinutes,
} from '../dates.js';
import { ouvrirCours, ouvrirEcheance, ouvrirTache, basculerTache } from './sheets.js';

const grandEcran = () => window.matchMedia('(min-width: 900px)').matches;
const lundiDe = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
const premierDuMois = (iso) => `${iso.slice(0, 8)}01`;

function moisDecale(iso, n) {
  const d = parseISO(premierDuMois(iso));
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function lieuxActifs(blocs) {
  const lieux = [];
  for (const b of blocs) if (!b.annulee && !lieux.includes(b.lieu)) lieux.push(b.lieu);
  return lieux;
}

function libelleJour(info, blocs) {
  switch (info.statut) {
    case 'ecole': {
      const lieux = lieuxActifs(blocs);
      return lieux.length ? `École · ${lieux.join(' puis ')}` : 'École';
    }
    case 'entreprise':
      return info.horaires ? `Entreprise · ${formatTime(info.horaires.debut)} – ${formatTime(info.horaires.fin)}` : 'Entreprise';
    case 'ferie':
      return info.nomFerie;
    default:
      return STATUTS[info.statut].label;
  }
}

// Tout ce qui concerne un jour : statut, cours, échéances et tâches à faire.
function contenuJour(iso, state, ctx) {
  return {
    info: infoJour(iso, ctx),
    blocs: regrouper(coursDuJour(iso, state)),
    echeances: state.echeances.filter((e) => !e.fait && e.date === iso).sort((a, b) => (a.heure || '99').localeCompare(b.heure || '99')),
    taches: state.taches.filter((t) => !t.fait && t.date === iso),
  };
}

function enTete(mode, ref, aujourdhui) {
  const debut = mode === 'semaine' ? lundiDe(ref) : premierDuMois(ref);
  const precedent = mode === 'semaine' ? addDays(debut, -7) : moisDecale(debut, -1);
  const suivant = mode === 'semaine' ? addDays(debut, 7) : moisDecale(debut, 1);
  const contientAujourdhui = mode === 'semaine'
    ? aujourdhui >= debut && aujourdhui <= addDays(debut, 6)
    : aujourdhui.slice(0, 7) === debut.slice(0, 7);
  const titre = mode === 'semaine'
    ? `Semaine ${isoWeek(debut)} · ${formatShort(debut)} – ${formatShort(addDays(debut, 6))}`
    : `${cap(MOIS[parseISO(debut).getMonth()])} ${debut.slice(0, 4)}`;
  return h('header', { class: 'day-head' },
    h('p', { class: 'eyebrow' }, titre),
    h('div', { class: 'day-nav' },
      h('a', { class: 'icon-btn', href: `#/agenda/${mode}/${precedent}`, 'aria-label': mode === 'semaine' ? 'Semaine précédente' : 'Mois précédent' }, ic('chevronLeft')),
      h('a', { class: 'icon-btn', href: `#/agenda/${mode}/${suivant}`, 'aria-label': mode === 'semaine' ? 'Semaine suivante' : 'Mois suivant' }, ic('chevronRight'))),
    h('h1', { class: 'page-title' }, 'Agenda'),
    h('div', { class: 'agenda-tools' },
      segmente('agenda-mode', [['semaine', 'Semaine'], ['mois', 'Mois']], mode, (v) => { location.hash = `#/agenda/${v}/${ref}`; }),
      !contientAujourdhui && h('a', { class: 'btn btn-soft btn-small', href: `#/agenda/${mode}/${aujourdhui}` }, ic('sun'), mode === 'semaine' ? 'Cette semaine' : 'Ce mois-ci')));
}

// ---------- Éléments communs ----------

function itemCours(b) {
  const c = b.seances[0];
  const m = c.matiere;
  return h('button', {
    class: `agenda-item item-cours${c.annulee ? ' is-cancelled' : ''}${c.type === 'examen' ? ' is-exam' : ''}`,
    type: 'button', style: { '--c': m?.couleur || '#94a3b8' }, onclick: () => ouvrirCours(b),
  },
  h('span', { class: 'agenda-time' }, `${formatTime(b.debut)}–${formatTime(b.fin)}`),
  h('span', { class: 'agenda-icon' }, ic(m?.icone || 'star')),
  h('span', { class: 'agenda-label' }, m?.court || c.nom),
  c.type === 'examen' && h('span', { class: 'badge badge-examen' }, 'Examen'),
  c.annulee ? h('span', { class: 'badge badge-annule' }, 'Annulé') : h('span', { class: `agenda-lieu lieu-${c.lieu === 'Supméca' ? 'supmeca' : 'cfai'}` }, c.lieu));
}

function itemEvenement(ev) {
  return h('div', { class: 'agenda-item item-evenement' },
    h('span', { class: 'agenda-icon' }, ic(ev.titre.includes('R.M.A') ? 'users' : 'star')),
    h('span', { class: 'agenda-label' }, ev.titre),
    h('span', { class: 'agenda-time' }, ev.heure ? formatTime(ev.heure) : ev.note || ''));
}

function itemEcheance(e) {
  const t = TYPES_ECHEANCE[e.type];
  return h('button', { class: `agenda-item item-echeance prio-${e.priorite}`, type: 'button', title: e.titre, onclick: () => ouvrirEcheance(e) },
    h('span', { class: 'agenda-icon' }, ic(t.icone)),
    h('span', { class: 'agenda-label' }, e.titre),
    e.heure && h('span', { class: 'agenda-time' }, formatTime(e.heure)));
}

function itemTache(t) {
  const l = LISTES[t.liste] || LISTES.perso;
  return h('div', { class: 'agenda-item item-tache', title: t.titre, style: { '--c': l.couleur } },
    h('button', { class: 'mini-check', type: 'button', 'aria-label': `Marquer « ${t.titre} » comme faite`, onclick: () => basculerTache(t.id) }, ic('check')),
    h('button', { class: 'agenda-label', type: 'button', onclick: () => ouvrirTache(t) }, t.titre),
    h('span', { class: 'list-chip' }, h('i', { class: 'dot' }), l.label));
}

// ---------- Semaine : liste de jours (téléphone) ----------

function semaineListe(debut, state, ctx, aujourdhui) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(debut, i);
    const { info, blocs, echeances, taches } = contenuJour(iso, state, ctx);
    const vide = !blocs.length && !echeances.length && !taches.length && !info.evenements.length;
    const st = STATUTS[info.statut];
    jours.push(h('section', {
      class: `agenda-day${iso === aujourdhui ? ' is-today' : ''}${vide ? ' is-empty' : ''}`,
      style: { '--st': st.couleur },
    },
    h('a', { class: 'agenda-day-head', href: `#/aujourdhui/${iso}` },
      h('span', { class: 'agenda-date' },
        h('span', { class: 'agenda-dow' }, JOURS_COURTS[weekday(iso)]),
        h('span', { class: 'agenda-num' }, parseISO(iso).getDate())),
      h('span', { class: 'agenda-status' }, ic(st.icone), libelleJour(info, blocs)),
      ic('chevronRight')),
    !vide && h('div', { class: 'agenda-items' },
      info.evenements.map(itemEvenement),
      echeances.map(itemEcheance),
      blocs.map(itemCours),
      taches.map(itemTache))));
  }
  return h('div', { class: 'agenda-week' }, jours);
}

// ---------- Semaine : grille horaire (iPad, Mac) ----------

function semaineGrille(debut, state, ctx, aujourdhui) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(debut, i);
    const contenu = contenuJour(iso, state, ctx);
    const occupe = contenu.blocs.length || contenu.echeances.length || contenu.taches.length;
    if (!isWeekend(iso) || occupe) jours.push({ iso, ...contenu });
  }
  // Plage horaire : 8h–18h, élargie si un cours ou des horaires en sortent.
  let debutGrille = 8 * 60, finGrille = 18 * 60;
  for (const j of jours) {
    for (const b of j.blocs) {
      debutGrille = Math.min(debutGrille, Math.floor(toMinutes(b.debut) / 60) * 60);
      finGrille = Math.max(finGrille, Math.ceil(toMinutes(b.fin) / 60) * 60);
    }
    if (j.info.horaires?.debut && j.info.horaires?.fin) {
      debutGrille = Math.min(debutGrille, Math.floor(toMinutes(j.info.horaires.debut) / 60) * 60);
      finGrille = Math.max(finGrille, Math.ceil(toMinutes(j.info.horaires.fin) / 60) * 60);
    }
  }
  const plage = finGrille - debutGrille;
  const position = (debutMin, finMin) => ({
    top: `${((debutMin - debutGrille) / plage) * 100}%`,
    height: `${((finMin - debutMin) / plage) * 100}%`,
  });
  const heures = [];
  for (let m = debutGrille; m < finGrille; m += 60) heures.push(m);

  const colonnes = jours.map((j) => {
    const st = STATUTS[j.info.statut];
    const fond = [];
    if (j.info.statut === 'entreprise' && j.info.horaires?.debut && j.info.horaires?.fin && !j.blocs.length) {
      fond.push(h('div', { class: 'wg-periode', style: position(toMinutes(j.info.horaires.debut), toMinutes(j.info.horaires.fin)) },
        ic('briefcase'), `Entreprise ${formatTime(j.info.horaires.debut)} – ${formatTime(j.info.horaires.fin)}`));
    } else if (['conge', 'ferie', 'fermeture'].includes(j.info.statut)) {
      fond.push(h('div', { class: 'wg-periode', style: { top: '0', height: '100%' } }, ic(st.icone), libelleJour(j.info, j.blocs)));
    }
    return h('div', { class: `wg-col${j.iso === aujourdhui ? ' is-today' : ''}`, style: { '--st': st.couleur } },
      fond,
      j.blocs.map((b) => {
        const c = b.seances[0];
        return h('button', {
          class: `wg-cours${c.annulee ? ' is-cancelled' : ''}${c.type === 'examen' ? ' is-exam' : ''}`,
          type: 'button',
          style: { '--c': c.matiere?.couleur || '#94a3b8', ...position(toMinutes(b.debut), toMinutes(b.fin)) },
          onclick: () => ouvrirCours(b),
          title: `${c.matiere?.officiel || c.nom} · ${formatTime(b.debut)}–${formatTime(b.fin)} · ${c.lieu}${c.salle ? ` · ${c.salle}` : ''}`,
        },
        h('span', { class: 'wg-titre' }, ic(c.matiere?.icone || 'star'), c.matiere?.court || c.nom),
        h('span', { class: 'wg-detail' }, `${formatTime(b.debut)}–${formatTime(b.fin)} · ${c.annulee ? 'Annulé' : c.lieu}${c.salle ? ` · ${c.salle}` : ''}`),
        c.type === 'examen' && h('span', { class: 'badge badge-examen' }, 'Examen'));
      }));
  });

  return h('div', { class: 'week-grid card', style: { '--cols': jours.length } },
    h('div', { class: 'wg-corner' }),
    jours.map((j) => h('a', { class: `wg-head${j.iso === aujourdhui ? ' is-today' : ''}`, href: `#/aujourdhui/${j.iso}`, style: { '--st': STATUTS[j.info.statut].couleur } },
      h('span', { class: 'wg-date' }, `${cap(JOURS_COURTS[weekday(j.iso)])} ${parseISO(j.iso).getDate()}`),
      h('span', { class: 'wg-statut' }, h('i', { class: 'dot' }), libelleJour(j.info, j.blocs)))),
    h('div', { class: 'wg-allday-label' }, 'À faire'),
    jours.map((j) => h('div', { class: 'wg-allday' }, j.info.evenements.map(itemEvenement), j.echeances.map(itemEcheance), j.taches.map(itemTache))),
    h('div', { class: 'wg-hours' }, heures.map((m) => h('span', { class: 'wg-hour', style: { top: `${((m - debutGrille) / plage) * 100}%` } }, formatTime(`${String(m / 60).padStart(2, '0')}:00`)))),
    h('div', { class: 'wg-body', style: { '--lignes': heures.length } }, colonnes));
}

// ---------- Mois ----------

const LEGENDE = [['ecole', 'École'], ['entreprise', 'Entreprise'], ['conge', 'Congé'], ['ferie', 'Férié'], ['fermeture', 'Fermeture'], ['weekend', 'Week-end']];
const LEGENDE_POINTS = [['pt-evenement', 'Événement (R.M.A., rentrée)'], ['prio-haute', 'Échéance'], ['pt-tache', 'Tâche']];

function vueMois(debut, state, ctx, aujourdhui) {
  const mois = debut.slice(0, 7);
  const premiereCase = lundiDe(debut);
  const cases = [];
  let iso = premiereCase;
  do {
    for (let i = 0; i < 7; i++) {
      const info = infoJour(iso, ctx);
      const echeances = state.echeances.filter((e) => !e.fait && e.date === iso);
      const nbTaches = state.taches.filter((t) => !t.fait && t.date === iso).length;
      const horsMois = iso.slice(0, 7) !== mois;
      cases.push(h('a', {
        class: `mois-case st-${info.statut}${horsMois ? ' is-out' : ''}${iso === aujourdhui ? ' is-today' : ''}`,
        href: `#/aujourdhui/${iso}`,
        style: { '--st': STATUTS[info.statut].couleur },
        'aria-label': `${cap(formatLong(iso))} : ${info.statut === 'ferie' ? info.nomFerie : STATUTS[info.statut].label}${info.evenements.map((ev) => `, ${ev.titre}`).join('')}${echeances.length ? `, ${echeances.length} échéance(s)` : ''}`,
      },
      h('span', { class: 'mois-num' }, parseISO(iso).getDate()),
      (echeances.length > 0 || nbTaches > 0 || info.evenements.length > 0) && h('span', { class: 'mois-points' },
        info.evenements.length > 0 && h('i', { class: 'pt pt-evenement' }),
        echeances.slice(0, 3).map((e) => h('i', { class: `pt prio-${e.priorite}` })),
        nbTaches > 0 && h('i', { class: 'pt pt-tache' }))));
      iso = addDays(iso, 1);
    }
  } while (iso.slice(0, 7) === mois);

  // Périodes du mois (jours travaillés consécutifs de même statut, week-ends ignorés).
  const periodes = [];
  for (let d = debut; d.slice(0, 7) === mois; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const info = infoJour(d, ctx);
    const libelle = info.statut === 'ferie' ? `Férié : ${info.nomFerie}` : STATUTS[info.statut].label;
    const derniere = periodes[periodes.length - 1];
    if (derniere && derniere.libelle === libelle && derniere.statut === info.statut) derniere.au = d;
    else periodes.push({ statut: info.statut, libelle, du: d, au: d });
  }
  const echeancesMois = state.echeances.filter((e) => !e.fait && e.date.slice(0, 7) === mois).sort((a, b) => a.date.localeCompare(b.date));

  return h('div', { class: 'mois' },
    h('div', { class: 'mois-grille card' },
      ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((j) => h('span', { class: 'mois-entete', 'aria-hidden': 'true' }, j)),
      cases),
    h('ul', { class: 'legende' },
      LEGENDE.map(([st, label]) => h('li', { style: { '--st': STATUTS[st].couleur } }, h('i', { class: `carre st-${st}` }), label)),
      LEGENDE_POINTS.map(([classe, label]) => h('li', {}, h('i', { class: `pt ${classe}` }), label))),
    h('div', { class: 'mois-bas' },
      h('section', { class: 'section' },
        h('h2', { class: 'section-title' }, 'Où je suis ce mois-ci'),
        h('ul', { class: 'periodes card' }, periodes.map((p) => h('li', { style: { '--st': STATUTS[p.statut].couleur } },
          h('i', { class: 'dot' }),
          h('span', { class: 'periode-label' }, p.libelle),
          h('span', { class: 'muted' }, p.du === p.au ? formatShort(p.du) : `${formatShort(p.du)} → ${formatShort(p.au)}`))))),
      echeancesMois.length > 0 && h('section', { class: 'section' },
        h('h2', { class: 'section-title' }, 'Échéances du mois'),
        h('div', { class: 'agenda-items card padded' }, echeancesMois.map((e) => {
          const item = itemEcheance(e);
          item.prepend(h('span', { class: 'agenda-time' }, formatShort(e.date)));
          return item;
        })))));
}

export function vueAgenda(racine, param) {
  const [modeBrut, dateBrute] = (param || '').split('/');
  const mode = modeBrut === 'mois' ? 'mois' : 'semaine';
  const aujourdhui = todayISO();
  const ref = isValidISO(dateBrute) ? dateBrute : aujourdhui;
  const state = getState();
  const ctx = { reglages: state.reglages, conges: state.conges };

  racine.append(enTete(mode, ref, aujourdhui));
  if (mode === 'mois') {
    racine.append(vueMois(premierDuMois(ref), state, ctx, aujourdhui));
  } else {
    const debut = lundiDe(ref);
    racine.append(grandEcran() ? semaineGrille(debut, state, ctx, aujourdhui) : semaineListe(debut, state, ctx, aujourdhui));
  }
}
