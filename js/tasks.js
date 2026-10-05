// Tâches (to-do list) : école, entreprise ou perso, avec date et notification facultatives.
import { nouvelId, horodatage } from './store.js';
import { addDays, weekday } from './dates.js';

export const LISTES = {
  ecole: { label: 'École', couleur: 'var(--st-ecole)', icone: 'school' },
  entreprise: { label: 'Entreprise', couleur: 'var(--st-entreprise)', icone: 'briefcase' },
  perso: { label: 'Perso', couleur: 'var(--accent)', icone: 'user' },
};

const RANG_PRIORITE = { haute: 0, moyenne: 1, basse: 2 };

export function nouvelleTache(champs) {
  const maintenant = horodatage();
  return {
    id: nouvelId(),
    titre: '',
    liste: 'perso',
    date: null,
    matiere: null,
    priorite: null,
    rappel: null, // « AAAA-MM-JJTHH:MM », heure de Paris
    notes: '',
    fait: false,
    faitLe: null,
    creeLe: maintenant,
    modifieLe: maintenant,
    ...champs,
  };
}

export function trierTaches(a, b) {
  return (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99')
    || (RANG_PRIORITE[a.priorite] ?? 3) - (RANG_PRIORITE[b.priorite] ?? 3)
    || (a.creeLe || '').localeCompare(b.creeLe || '');
}

// Liste proposée par défaut selon le jour : école un jour d'école, entreprise un jour en entreprise.
export function listeDuJour(statut) {
  if (statut === 'ecole' || statut === 'session2') return 'ecole';
  if (statut === 'entreprise') return 'entreprise';
  return 'perso';
}

// Tâches à faire un jour donné ; aujourd'hui, on y ajoute celles en retard.
export function tachesDuJour(iso, taches, aujourdhui) {
  return taches
    .filter((t) => !t.fait && t.date && (t.date === iso || (iso === aujourdhui && t.date < aujourdhui)))
    .sort(trierTaches);
}

export function groupesTaches(taches, aujourdhui) {
  const finSemaine = addDays(aujourdhui, (7 - weekday(aujourdhui)) % 7);
  const demain = addDays(aujourdhui, 1);
  const regles = [
    ['En retard', (t) => t.date && t.date < aujourdhui],
    ['Aujourd’hui', (t) => t.date === aujourdhui],
    ['Demain', (t) => t.date === demain],
    ['Cette semaine', (t) => t.date && t.date > demain && t.date <= finSemaine],
    ['Plus tard', (t) => t.date && t.date > finSemaine],
    ['Sans date', (t) => !t.date],
  ];
  const triees = [...taches].sort(trierTaches);
  return regles.map(([titre, test]) => [titre, triees.filter(test)]).filter(([, l]) => l.length);
}
