// Échéances : contrôles, examens, devoirs, rendus et autres dates importantes.
import { addDays, diffDays, todayISO, toMinutes } from './dates.js';
import { nouvelId, horodatage } from './store.js';
import { sujet } from './subjects.js';

export const TYPES_ECHEANCE = {
  controle: { label: 'Contrôle', icone: 'clipboard' },
  examen: { label: 'Examen', icone: 'alert' },
  devoir: { label: 'Devoir', icone: 'file' },
  rendu: { label: 'Rendu', icone: 'send' },
  oral: { label: 'Oral', icone: 'mic' },
  autre: { label: 'Date importante', icone: 'star' },
};

export const PRIORITES = {
  haute: { label: 'Haute', rang: 0 },
  moyenne: { label: 'Moyenne', rang: 1 },
  basse: { label: 'Basse', rang: 2 },
};

export const RAPPELS = [
  { j: 7, label: '1 semaine avant' },
  { j: 3, label: '3 jours avant' },
  { j: 1, label: 'La veille' },
  { j: 0, label: 'Le jour même' },
];

export function trier(a, b) {
  return (a.date + (a.heure || '99:99')).localeCompare(b.date + (b.heure || '99:99'))
    || PRIORITES[a.priorite].rang - PRIORITES[b.priorite].rang
    || a.titre.localeCompare(b.titre);
}

export const aFaire = (echeances) => echeances.filter((e) => !e.fait).sort(trier);

export function nouvelleEcheance(champs) {
  const maintenant = horodatage();
  return {
    id: nouvelId(),
    titre: '',
    type: 'controle',
    matiere: null,
    date: todayISO(),
    heure: null,
    priorite: 'moyenne',
    rappels: [3, 1],
    notes: '',
    fait: false,
    faitLe: null,
    source: null,
    creeLe: maintenant,
    modifieLe: maintenant,
    ...champs,
  };
}

// Crée une échéance pour chaque séance marquée « EXAMEN » dans NetYParéo (une seule fois :
// si tu la supprimes, elle n'est pas recréée).
export function echeancesExamens(state, cours) {
  const connues = new Set(state.echeances.filter((e) => e.source?.uid).map((e) => e.source.uid));
  const ignorees = new Set(state.examensIgnores);
  return cours
    .filter((c) => c.typeOrigine === 'netypareo' && c.type === 'examen' && !c.annulee && !connues.has(c.uid) && !ignorees.has(c.uid))
    .map((c) => nouvelleEcheance({
      id: `examen-${c.uid}`,
      titre: `Examen — ${c.matiere?.court || c.nom}`,
      type: 'examen',
      matiere: c.code,
      date: c.date,
      heure: c.debut,
      priorite: 'haute',
      rappels: [7, 3, 1],
      notes: `Séance marquée « EXAMEN » dans NetYParéo (${c.debut.replace(':', 'h')}–${c.fin.replace(':', 'h')}).`,
      source: { type: 'netypareo', uid: c.uid },
    }));
}

export function compteARebours(e, aujourdhui = todayISO()) {
  const n = diffDays(aujourdhui, e.date);
  if (n < 0) return { texte: n === -1 ? 'hier' : `${-n} j de retard`, classe: 'late' };
  if (n === 0) return { texte: "aujourd'hui", classe: 'today' };
  if (n === 1) return { texte: 'demain', classe: 'soon' };
  if (n <= 7) return { texte: `J-${n}`, classe: 'soon' };
  return { texte: `J-${n}`, classe: '' };
}

// Rappels prévus un jour donné (hors rappel du jour même, l'échéance étant déjà affichée).
export function rappelsDuJour(iso, echeances) {
  const liste = [];
  for (const e of echeances) {
    if (e.fait) continue;
    for (const j of e.rappels || []) {
      if (j > 0 && addDays(e.date, -j) === iso) liste.push({ echeance: e, j });
    }
  }
  return liste.sort((a, b) => trier(a.echeance, b.echeance));
}

// Moment exact d'un rappel : à l'heure des rappels, ou 1 h avant l'échéance si elle a lieu plus tôt le jour même.
export function momentRappel(e, j, heureRappels) {
  const jour = addDays(e.date, -j);
  let heure = heureRappels;
  if (j === 0 && e.heure && toMinutes(e.heure) - 60 < toMinutes(heureRappels)) {
    const m = Math.max(0, toMinutes(e.heure) - 60);
    heure = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const [y, mo, d] = jour.split('-').map(Number);
  const [hh, mm] = heure.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm);
}

export function libelleSujet(code) {
  const s = sujet(code);
  return s ? s.court : null;
}
