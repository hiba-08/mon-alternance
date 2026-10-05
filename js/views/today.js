import { h, ic, sectionTitre, vide } from '../ui.js';
import { getState } from '../store.js';
import { infoJour, prochaineBascule, prochainJourTravaille, STATUTS, TYPES_CONGE } from '../calendar.js';
import { coursDuJour, regrouper, infoSource, TYPES_COURS } from '../courses.js';
import { aFaire, compteARebours, rappelsDuJour, TYPES_ECHEANCE, PRIORITES } from '../deadlines.js';
import { sujet } from '../subjects.js';
import { todayISO, addDays, formatLong, formatShort, formatTime, cap, isoWeek, isValidISO, toMinutes, nowMinutes, durationLabel, relative } from '../dates.js';
import { ouvrirCours, ouvrirEcheance, basculerFait } from './sheets.js';

export function vueAujourdhui(racine, param) {
  const state = getState();
  const aujourdhui = todayISO();
  const iso = isValidISO(param) ? param : aujourdhui;
  const estAujourdhui = iso === aujourdhui;
  const ctx = { reglages: state.reglages, conges: state.conges };
  const info = infoJour(iso, ctx);
  const blocs = regrouper(coursDuJour(iso, state));

  racine.append(
    enTete(iso, estAujourdhui, info),
    h('div', { class: 'today-grid' },
      h('div', { class: 'today-main' },
        carteStatut(iso, info, blocs.filter((b) => !b.annulee), ctx, state),
        sectionCours(iso, info, blocs, estAujourdhui, state)),
      h('div', { class: 'today-side' },
        sectionEcheances(iso, estAujourdhui, state),
        sectionRappels(iso, state),
        estAujourdhui && carteDemain(iso, ctx, state))));
}

function enTete(iso, estAujourdhui, info) {
  const semaine = `Semaine ${isoWeek(iso)}${info.semestre ? ` · Semestre ${info.semestre}` : ''}`;
  const choixDate = h('input', {
    type: 'date', class: 'visually-hidden-input', value: iso, 'aria-label': 'Choisir une date',
    onchange: (e) => { if (e.target.value) location.hash = `#/aujourdhui/${e.target.value}`; },
  });
  return h('header', { class: 'day-head' },
    h('p', { class: 'eyebrow' }, estAujourdhui ? `Aujourd’hui · ${semaine}` : semaine),
    h('div', { class: 'day-nav' },
      h('a', { class: 'icon-btn', href: `#/aujourdhui/${addDays(iso, -1)}`, 'aria-label': 'Jour précédent' }, ic('chevronLeft')),
      h('span', { class: 'date-picker' },
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Choisir une date',
          onclick: () => { try { choixDate.showPicker(); } catch { choixDate.focus(); } },
        }, ic('calendar')),
        choixDate),
      h('a', { class: 'icon-btn', href: `#/aujourdhui/${addDays(iso, 1)}`, 'aria-label': 'Jour suivant' }, ic('chevronRight'))),
    h('h1', { class: 'page-title' }, cap(formatLong(iso))),
    !estAujourdhui && h('a', { class: 'btn btn-soft btn-small back-today', href: '#/aujourdhui' }, ic('sun'), 'Revenir à aujourd’hui'));
}

function lieuxDuJour(blocs) {
  const lieux = [];
  for (const b of blocs) if (!lieux.includes(b.lieu)) lieux.push(b.lieu);
  return lieux;
}

function carteStatut(iso, info, blocs, ctx, state) {
  const st = STATUTS[info.statut];
  let titre = st.label;
  let sous = null;

  if (info.statut === 'ecole') {
    const lieux = lieuxDuJour(blocs);
    titre = lieux.length ? `École · ${lieux.join(' puis ')}` : 'École';
    sous = blocs.length
      ? `${blocs.reduce((n, b) => n + b.seances.length, 0)} séance${blocs.length > 1 || blocs[0].seances.length > 1 ? 's' : ''} · de ${formatTime(blocs[0].debut)} à ${formatTime(blocs[blocs.length - 1].fin)}`
      : iso > (infoSource(state)?.au || '') ? 'Emploi du temps pas encore publié pour ce jour' : 'Aucune séance dans NetYParéo ce jour-là';
  } else if (info.statut === 'session2') {
    sous = 'Épreuves de session 2 du S5 (rattrapages)';
  } else if (info.statut === 'entreprise') {
    sous = info.horaires ? `${formatTime(info.horaires.debut)} – ${formatTime(info.horaires.fin)}` : 'Horaires non renseignés';
  } else if (info.statut === 'conge') {
    sous = `${TYPES_CONGE[info.conge.type] || 'Congé'} jusqu’au ${formatShort(info.conge.au)}${info.conge.note ? ` · ${info.conge.note}` : ''}`;
  } else if (info.statut === 'ferie') {
    titre = info.nomFerie;
    sous = `Jour férié${info.periode ? ` · période ${info.periode === 'ecole' ? 'école' : 'entreprise'}` : ''}`;
  } else if (info.statut === 'fermeture') {
    sous = `D’après le calendrier PDF${info.periode ? ` · période ${info.periode === 'ecole' ? 'école' : 'entreprise'}` : ''}`;
  } else if (info.statut === 'weekend') {
    const suivant = prochainJourTravaille(iso, ctx);
    if (suivant) sous = `Ensuite : ${formatShort(suivant.date)}, ${suivant.categorie === 'ecole' ? 'école' : 'entreprise'}`;
  } else if (info.statut === 'hors') {
    sous = 'Ce jour est en dehors du calendrier 2026-2027';
  }

  const bascule = prochaineBascule(iso, ctx);
  const corps = h('section', { class: `status-card status-${info.statut}`, style: { '--st': st.couleur } },
    h('div', { class: 'status-top' },
      h('div', { class: 'status-icon' }, ic(st.icone)),
      h('div', { class: 'status-text' },
        h('p', { class: 'status-title' }, titre),
        sous && h('p', { class: 'status-sub' }, sous)),
      info.statut === 'entreprise' && h('a', { class: 'icon-btn icon-btn-quiet', href: '#/reglages', 'aria-label': 'Modifier mes horaires en entreprise' }, ic('pencil'))),
    info.evenements.length > 0 && h('ul', { class: 'status-events' },
      info.evenements.map((ev) => h('li', {},
        ic(ev.titre.includes('R.M.A') ? 'users' : 'star'),
        h('span', {}, h('strong', {}, ev.titre), ev.heure ? ` · ${formatTime(ev.heure)}` : '', ev.note ? ` · ${ev.note}` : '')))),
    bascule && bascule.dans <= 90 && h('p', { class: 'status-next' },
      ic('arrowRight'),
      h('span', {},
        `${bascule.vers === 'ecole' ? 'Retour à l’école' : 'Retour en entreprise'} ${formatLong(bascule.date)}`,
        h('span', { class: 'muted' }, ` · ${relative(bascule.dans)}`))));

  const notes = info.notes.length > 0 && h('ul', { class: 'source-notes' },
    info.notes.map((n) => h('li', { class: `source-${n.source}` }, ic('info'), h('span', {}, n.texte))));
  return h('div', { class: 'status-wrap' }, corps, notes);
}

function badgeType(type) {
  if (!type) return null;
  const t = TYPES_COURS[type];
  return h('span', { class: `badge badge-${type}` }, ic(t.icone), t.label);
}

function sectionCours(iso, info, blocs, estAujourdhui, state) {
  const ecole = info.statut === 'ecole' || info.statut === 'session2';
  if (!blocs.length && !ecole) return null;

  const actives = blocs.filter((b) => !b.annulee).reduce((n, b) => n + b.seances.length, 0);
  const section = h('section', { class: 'section' }, sectionTitre('Cours', actives ? h('span', { class: 'section-count' }, `${actives}`) : null));
  if (!blocs.length) {
    const src = infoSource(state);
    const apres = src && iso > src.au;
    section.append(vide('book',
      apres ? 'Pas encore publié' : 'Aucun cours',
      apres ? `NetYParéo ne publie pour l’instant que jusqu’au ${formatShort(src.au)}.` : 'Aucune séance n’est prévue ce jour-là dans NetYParéo.'));
    return section;
  }

  const maintenant = estAujourdhui ? nowMinutes() : null;
  let prochainMarque = false;
  const liste = h('div', { class: 'course-list' });
  for (const b of blocs) {
    const c = b.seances[0];
    const m = c.matiere;
    const couleur = m?.couleur || '#94a3b8';
    let etat = null;
    if (maintenant != null && !c.annulee) {
      const d = toMinutes(b.debut), f = toMinutes(b.fin);
      if (maintenant >= d && maintenant < f) etat = h('span', { class: 'live' }, h('span', { class: 'live-dot' }), `En cours · encore ${durationLabel(f - maintenant)}`);
      else if (maintenant < d && !prochainMarque) { prochainMarque = true; etat = h('span', { class: 'next-chip' }, `Dans ${durationLabel(d - maintenant)}`); }
      else if (maintenant >= f) etat = 'passe';
    }
    const carte = h('button', {
      class: `course-card${etat === 'passe' ? ' is-past' : ''}${c.type === 'examen' ? ' is-exam' : ''}${c.annulee ? ' is-cancelled' : ''}`,
      type: 'button',
      style: { '--c': couleur },
      onclick: () => ouvrirCours(b),
      'aria-label': `${m?.officiel || c.nom}, de ${formatTime(b.debut)} à ${formatTime(b.fin)}`,
    },
      h('div', { class: 'course-time' }, h('span', { class: 'course-start' }, formatTime(b.debut)), h('span', { class: 'course-end' }, formatTime(b.fin))),
      h('div', { class: 'course-body' },
        h('div', { class: 'course-head' },
          h('span', { class: 'subject-icon' }, ic(m?.icone || 'star')),
          h('div', { class: 'course-titles' },
            h('h3', { class: 'course-name' }, m?.officiel || c.nom),
            h('p', { class: 'course-code' }, c.ue ? `${c.ue} · ${c.code}` : 'Événement', b.seances.length > 1 ? ` · ${b.seances.length} séances` : ''))),
        h('div', { class: 'course-facts' },
          c.enseignant && h('span', { class: 'fact' }, ic('user'), c.enseignant),
          h('span', { class: `fact lieu lieu-${c.lieu === 'Supméca' ? 'supmeca' : 'cfai'}` }, ic('building'), c.lieu),
          h('span', { class: `fact${c.salle ? '' : ' fact-missing'}` }, ic('door'), c.salle || 'Salle ?')),
        (c.annulee || c.type || etat && etat !== 'passe' || c.mentions.length || c.note) && h('div', { class: 'course-extra' },
          etat && etat !== 'passe' ? etat : null,
          c.annulee && h('span', { class: 'badge badge-annule' }, ic('x'), 'Annulé (retiré de NetYParéo)'),
          badgeType(c.type),
          c.mentions.map((x) => h('span', { class: 'mention' }, x)),
          c.note && h('span', { class: 'mention mention-perso' }, ic('pencil'), c.note))));
    liste.append(carte);
  }
  section.append(liste);
  return section;
}

function ligneEcheance(e, aujourdhui) {
  const t = TYPES_ECHEANCE[e.type];
  const s = sujet(e.matiere);
  const cr = compteARebours(e, aujourdhui);
  return h('li', { class: `dl-item prio-${e.priorite}`, style: { '--c': s?.couleur || 'var(--text-3)' } },
    h('button', { class: 'dl-check', type: 'button', 'aria-label': `Marquer « ${e.titre} » comme fait`, onclick: () => basculerFait(e.id) }, ic('check')),
    h('button', { class: 'dl-main', type: 'button', onclick: () => ouvrirEcheance(e) },
      h('span', { class: 'dl-title' }, e.titre),
      h('span', { class: 'dl-meta' },
        h('span', { class: 'dl-type' }, ic(t.icone), t.label),
        s && h('span', { class: 'dl-subject' }, h('i', { class: 'dot' }), s.court),
        h('span', {}, `${formatShort(e.date)}${e.heure ? ` · ${formatTime(e.heure)}` : ''}`))),
    h('span', { class: `countdown ${cr.classe}`, title: PRIORITES[e.priorite].label }, cr.texte));
}

function sectionEcheances(iso, estAujourdhui, state) {
  const aujourdhui = todayISO();
  const todo = aFaire(state.echeances);
  const enRetard = estAujourdhui ? todo.filter((e) => e.date < aujourdhui) : [];
  const duJour = todo.filter((e) => e.date === iso);
  const aVenir = todo.filter((e) => e.date > iso).slice(0, 5);

  const section = h('section', { class: 'section' },
    sectionTitre('Échéances', h('a', { class: 'link', href: '#/echeances' }, 'Tout voir')));
  if (!todo.length) {
    section.append(vide('listChecks', 'Rien à rendre', 'Ajoute tes contrôles, devoirs et rendus pour les suivre ici.',
      h('button', { class: 'btn btn-soft', type: 'button', onclick: () => ouvrirEcheance(null, { date: iso }) }, ic('plus'), 'Ajouter une échéance')));
    return section;
  }
  const groupe = (titre, liste) => liste.length > 0 && h('div', { class: 'dl-group' },
    h('p', { class: 'dl-group-title' }, titre),
    h('ul', { class: 'dl-list' }, liste.map((e) => ligneEcheance(e, aujourdhui))));
  section.append(
    groupe('En retard', enRetard) || '',
    groupe(estAujourdhui ? 'Aujourd’hui' : `Le ${formatShort(iso)}`, duJour) || '',
    groupe('À venir', aVenir) || '',
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => ouvrirEcheance(null, { date: iso >= aujourdhui ? iso : aujourdhui }) }, ic('plus'), 'Ajouter une échéance'));
  return section;
}

function sectionRappels(iso, state) {
  const rappels = rappelsDuJour(iso, state.echeances);
  if (!rappels.length) return null;
  return h('section', { class: 'section' },
    sectionTitre('Rappels du jour'),
    h('ul', { class: 'reminder-list' }, rappels.map(({ echeance: e, j }) => h('li', {},
      h('button', { class: 'reminder', type: 'button', onclick: () => ouvrirEcheance(e) },
        ic('bell'),
        h('span', {}, h('strong', {}, e.titre), ` · ${relative(j)} (${formatShort(e.date)})`))))));
}

function carteDemain(iso, ctx, state) {
  const demain = addDays(iso, 1);
  const info = infoJour(demain, ctx);
  const st = STATUTS[info.statut];
  const blocs = regrouper(coursDuJour(demain, state)).filter((b) => !b.annulee);
  let detail = '';
  if (info.statut === 'ecole' && blocs.length) {
    const premier = blocs[0];
    detail = `${premier.matiere?.court || premier.nom} à ${formatTime(premier.debut)} · ${lieuxDuJour(blocs).join(' puis ')}`;
  } else if (info.statut === 'entreprise' && info.horaires) {
    detail = `${formatTime(info.horaires.debut)} – ${formatTime(info.horaires.fin)}`;
  } else if (info.statut === 'ferie') {
    detail = info.nomFerie;
  }
  return h('section', { class: 'section' },
    sectionTitre('Demain'),
    h('a', { class: 'tomorrow', href: `#/aujourdhui/${demain}`, style: { '--st': st.couleur } },
      h('span', { class: 'status-icon small' }, ic(st.icone)),
      h('span', { class: 'tomorrow-text' }, h('strong', {}, `${cap(formatShort(demain))} · ${info.statut === 'ferie' ? 'Jour férié' : st.label}`), detail && h('span', { class: 'muted' }, detail)),
      ic('chevronRight')));
}

