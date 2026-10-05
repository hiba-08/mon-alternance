import { h, ic } from '../ui.js';
import { getState } from '../store.js';
import { sourceCalendrier } from '../calendar.js';
import { infoSource } from '../courses.js';
import { formatShort } from '../dates.js';

const FEUILLE_DE_ROUTE = [
  ['V4', 'Sessions de révision et planning proposé selon tes créneaux libres, minuteur Pomodoro'],
  ['V5', 'Notes et moyennes par UE, récap du dimanche soir'],
  ['V6', 'Journal de missions en entreprise, préparation des réunions avec ton maître d’apprentissage, suivi des absences'],
];

export function vuePlus(racine) {
  const state = getState();
  const lien = (href, icone, titre, texte) => h('li', {},
    h('a', { class: 'menu-link', href },
      h('span', { class: 'menu-icon' }, ic(icone)),
      h('span', { class: 'menu-text' }, h('strong', {}, titre), h('span', { class: 'muted' }, texte)),
      ic('chevronRight')));

  racine.append(
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Mon Alternance'), h('h1', { class: 'page-title' }, 'Plus'))),
    h('ul', { class: 'menu card' },
      lien('#/agenda', 'calendar', 'Agenda', 'Semaine et mois, périodes école et entreprise'),
      lien('#/conges', 'umbrella', 'Congés', state.conges.length ? `${state.conges.length} période${state.conges.length > 1 ? 's' : ''} posée${state.conges.length > 1 ? 's' : ''}` : 'Pose tes jours de congé'),
      lien('#/reglages', 'sliders', 'Réglages', 'Horaires, thème, rappels, données'),
      lien('#/sources', 'info', 'Sources et règles', 'D’où viennent les informations affichées')),
    h('section', { class: 'section' },
      h('h2', { class: 'section-title' }, 'Prochaines étapes'),
      h('p', { class: 'hint' }, ic('check'), 'Déjà là : synchronisation et notifications (V2), agenda semaine/mois et tâches (V3).'),
      h('ol', { class: 'roadmap card' }, FEUILLE_DE_ROUTE.map(([v, texte]) => h('li', {}, h('span', { class: 'roadmap-tag' }, v), h('span', {}, texte))))));
}

export function vueSources(racine) {
  const state = getState();
  const cal = sourceCalendrier();
  const src = infoSource(state);
  const r = state.reglages;
  const item = (titre, ...texte) => h('li', {}, h('strong', {}, titre), h('span', {}, ...texte));

  racine.append(
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Transparence'), h('h1', { class: 'page-title' }, 'Sources et règles'))),

    h('section', { class: 'card prose' },
      h('h2', { class: 'card-title' }, ic('calendar'), 'Calendrier de l’alternance'),
      h('ul', { class: 'facts' },
        item('Fichier', `${cal.fichier}, ${cal.titre}, ${cal.version}${cal.creeLe ? `, créé le ${formatShort(cal.creeLe, { annee: true })}` : ''}.`),
        item('Méthode', cal.methode),
        item('Légende du PDF', Object.values(cal.legende).join(' · ')))),

    h('section', { class: 'card prose' },
      h('h2', { class: 'card-title' }, ic('school'), 'Emploi du temps'),
      h('ul', { class: 'facts' },
        src && item('Source', src.origine === 'ics' ? `fichier .ics importé le ${formatShort(src.le, { annee: true })}` : `NetYParéo, extrait le ${formatShort(src.le, { annee: true })}`, ` : ${src.n} séances du ${formatShort(src.du)} au ${formatShort(src.au, { annee: true })}.`),
        item('Établissement', '« Supméca » quand NetYParéo l’indique (« A SUPMECA », « ISAE-SUPMECA »). Sinon : ', r.lieuParDefaut, ' par défaut (ta règle du 04/10/2026, modifiable).'),
        item('Salles', 'renseignées par NetYParéo pour une partie des séances seulement (25 sur 152).'),
        item('Type de cours', 'NetYParéo ne le fournit pas. Seuls « EXAMEN », « TP… » et « TD… » écrits dans la séance sont repris ; tu peux compléter les autres.'))),

    h('section', { class: 'card prose' },
      h('h2', { class: 'card-title' }, ic('sliders'), 'Règles ajoutées à ta demande'),
      h('ul', { class: 'facts' },
        item('Jours fériés', 'tous les jours fériés légaux sont affichés, même en période entreprise (ceux absents du PDF sont signalés comme tels).'),
        item('Session 2 du S5', r.passeSession2 ? 'tu passes les épreuves : 30 et 31 mars affichés en école.' : 'tu n’es pas concernée : 30 et 31 mars affichés en entreprise.'),
        item('R.M.A. du 20 novembre', 'affichée sans horaire : le PDF n’en donne pas.'),
        item('Horaires en entreprise', '8h – 17h par défaut, modifiables jour par jour.'),
        (r.fermeturesTravaillees || []).length > 0 && item('Fermetures travaillées', `${r.fermeturesTravaillees.map((d) => formatShort(d, { annee: true })).join(', ')} : en noir dans le PDF (fermeture du CFAI et de Supméca), mais tu travailles ce jour-là. Affiché en entreprise.`))));
}
