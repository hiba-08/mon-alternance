// Où dois-tu être chaque jour ? Combine le calendrier PDF de l'école, les jours fériés
// légaux, tes congés et tes réglages. Chaque information garde la trace de sa source.
import { addDays, isWeekend, weekday } from './dates.js';

let CAL = null;

export const FICHIER_CALENDRIER = 'data/calendrier-gi3b-2026-2027.json';

// Fichier local (mode local et import initial depuis le Mac). Absent de la version en ligne.
export async function chargerCalendrierLocal() {
  try {
    const r = await fetch(FICHIER_CALENDRIER);
    if (r.ok) CAL = await r.json();
  } catch {
    // fichier absent : le calendrier viendra de Supabase
  }
  return CAL;
}

export function definirCalendrier(donnees) {
  if (donnees?.jours) CAL = donnees;
}

export const calendrierPret = () => Boolean(CAL);

export const sourceCalendrier = () => CAL.source;
export const jourPdf = (iso) => CAL?.jours[iso] || null;

// ---- Jours fériés légaux (France métropolitaine) ----

function paques(annee) {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7;
  const m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const mois = Math.floor((hh + l - 7 * m + 114) / 31);
  const jour = ((hh + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

const cacheFeries = new Map();
function feriesAnnee(annee) {
  if (!cacheFeries.has(annee)) {
    const p = paques(annee);
    cacheFeries.set(annee, new Map([
      [`${annee}-01-01`, 'Jour de l’an'],
      [addDays(p, 1), 'Lundi de Pâques'],
      [`${annee}-05-01`, 'Fête du Travail'],
      [`${annee}-05-08`, 'Victoire 1945'],
      [addDays(p, 39), 'Ascension'],
      [addDays(p, 50), 'Lundi de Pentecôte'],
      [`${annee}-07-14`, 'Fête nationale'],
      [`${annee}-08-15`, 'Assomption'],
      [`${annee}-11-01`, 'Toussaint'],
      [`${annee}-11-11`, 'Armistice 1918'],
      [`${annee}-12-25`, 'Noël'],
    ]));
  }
  return cacheFeries.get(annee);
}

export const ferie = (iso) => feriesAnnee(Number(iso.slice(0, 4))).get(iso) || null;

// ---- Statut d'un jour ----

export const STATUTS = {
  ecole: { label: 'École', icone: 'school', couleur: 'var(--st-ecole)' },
  entreprise: { label: 'Entreprise', icone: 'briefcase', couleur: 'var(--st-entreprise)' },
  conge: { label: 'Congé', icone: 'umbrella', couleur: 'var(--st-conge)' },
  ferie: { label: 'Jour férié', icone: 'flag', couleur: 'var(--st-ferie)' },
  fermeture: { label: 'Fermeture CFAI et Supméca', icone: 'lock', couleur: 'var(--st-fermeture)' },
  weekend: { label: 'Week-end', icone: 'coffee', couleur: 'var(--st-weekend)' },
  session2: { label: 'Épreuves de session 2', icone: 'school', couleur: 'var(--st-session2)' },
  hors: { label: 'Hors calendrier', icone: 'calendar', couleur: 'var(--st-hors)' },
};

export const TYPES_CONGE = {
  cp: 'Congés payés',
  rtt: 'RTT',
  recup: 'Récupération',
  autre: 'Autre absence',
};

export const congeDuJour = (iso, conges) => conges.find((c) => c.du <= iso && iso <= c.au) || null;

// École ou entreprise d'après le PDF seul (null pour les week-ends et fermetures).
function categoriePdf(iso, reglages) {
  const j = jourPdf(iso);
  if (!j) return null;
  if (['ecole', 'rentree-admin', 'rentree-peda'].includes(j.statut)) return 'ecole';
  if (j.statut === 'entreprise') return 'entreprise';
  if (j.statut === 'session2') return reglages.passeSession2 ? 'ecole' : 'entreprise';
  if (j.statut === 'fermeture' && fermetureTravaillee(iso, reglages)) return 'entreprise';
  return null;
}

const fermetureTravaillee = (iso, reglages) => (reglages.fermeturesTravaillees || []).includes(iso);

// Période dans laquelle tombe le jour, en regardant les jours voisins si besoin.
export function periodeAutour(iso, reglages) {
  const c = categoriePdf(iso, reglages);
  if (c) return c;
  let avant = null, apres = null;
  for (let i = 1; i <= 7 && !avant; i++) avant = categoriePdf(addDays(iso, -i), reglages);
  for (let i = 1; i <= 7 && !apres; i++) apres = categoriePdf(addDays(iso, i), reglages);
  return avant && avant === apres ? avant : null;
}

export function infoJour(iso, { reglages, conges }) {
  const j = jourPdf(iso);
  const nomFerie = ferie(iso);
  const conge = congeDuJour(iso, conges);
  const periode = periodeAutour(iso, reglages);
  const travaillee = j?.statut === 'fermeture' && fermetureTravaillee(iso, reglages);
  const notes = [];
  const evenements = [];

  let statut;
  if (!j) statut = isWeekend(iso) ? 'weekend' : 'hors';
  else if (isWeekend(iso)) statut = 'weekend';
  else if (nomFerie) statut = 'ferie';
  else if (j.statut === 'fermeture' && !travaillee) statut = 'fermeture';
  else if (conge) statut = 'conge';
  else if (j.statut === 'session2') statut = reglages.passeSession2 ? 'session2' : 'entreprise';
  else if (j.statut === 'entreprise' || travaillee) statut = 'entreprise';
  else statut = 'ecole';

  if (nomFerie) {
    notes.push(j?.statut === 'fermeture'
      ? { texte: `${nomFerie} : jour férié, marqué en noir dans le PDF (fermeture du CFAI et de Supméca).`, source: 'pdf' }
      : { texte: `${nomFerie} : jour férié légal, absent du PDF.`, source: 'ajout' });
  }
  if (travaillee && !nomFerie) {
    notes.push({
      texte: `Jour noir dans le PDF (« ${CAL.source.legende.fermeture} ») : le CFAI et Supméca sont fermés. Tu as confirmé que tu travailles ce jour-là en entreprise.`,
      source: 'reglage',
    });
  } else if (j?.statut === 'fermeture' && !nomFerie) {
    notes.push({
      texte: `Jour noir dans le PDF (« ${CAL.source.legende.fermeture} »). Ce n’est pas un jour férié légal${periode === 'entreprise' ? ', et il tombe en période entreprise : le PDF ne dit pas si tu travailles ce jour-là' : ''}.`,
      source: 'pdf',
    });
  }
  if (j?.statut === 'session2') {
    notes.push(reglages.passeSession2
      ? { texte: 'Épreuves de session 2 du S5 (rattrapages), d’après le PDF.', source: 'pdf' }
      : { texte: 'Le PDF prévoit les épreuves de session 2 du S5. Tu as indiqué ne pas être concernée : jour affiché en entreprise (modifiable dans les réglages).', source: 'reglage' });
  }
  if (conge && statut === 'conge' && categoriePdf(iso, reglages) === 'ecole') {
    notes.push({ texte: 'Attention : ce jour est un jour d’école dans le calendrier PDF.', source: 'pdf' });
  }
  if (j?.statut === 'rentree-admin') evenements.push({ titre: 'Rentrée administrative', heure: '08:30', source: 'pdf' });
  if (j?.statut === 'rentree-peda') evenements.push({ titre: 'Rentrée pédagogique', heure: '08:30', source: 'pdf' });
  if (j?.texte === 'R.M.A') {
    evenements.push({ titre: 'Réunion Maître d’Apprentissage (R.M.A.)', heure: null, note: 'Horaire non communiqué', source: 'pdf' });
  }

  return {
    iso,
    statut,
    periode,
    semestre: j?.semestre ?? null,
    nomFerie,
    conge,
    notes,
    evenements,
    horaires: statut === 'entreprise' ? reglages.horaires[weekday(iso)] || null : null,
  };
}

// École / entreprise pour un jour travaillé, null sinon (week-end, férié, fermeture, congé).
function categorieTravaillee(iso, ctx) {
  const { statut } = infoJour(iso, ctx);
  if (statut === 'ecole' || statut === 'session2') return 'ecole';
  if (statut === 'entreprise') return 'entreprise';
  return null;
}

export function prochainJourTravaille(iso, ctx, max = 30) {
  for (let i = 1; i <= max; i++) {
    const d = addDays(iso, i);
    if (!jourPdf(d)) return null;
    const c = categorieTravaillee(d, ctx);
    if (c) return { date: d, categorie: c };
  }
  return null;
}

// Prochain passage école ↔ entreprise après le jour donné.
export function prochaineBascule(iso, ctx) {
  let ref = categorieTravaillee(iso, ctx) || periodeAutour(iso, ctx.reglages);
  for (let i = 1; i <= 14 && !ref; i++) ref = categorieTravaillee(addDays(iso, -i), ctx);
  for (let i = 1; i <= 150; i++) {
    const d = addDays(iso, i);
    if (!jourPdf(d)) return null;
    const c = categorieTravaillee(d, ctx);
    if (!c) continue;
    if (!ref) ref = c;
    else if (c !== ref) return { date: d, vers: c, dans: i };
  }
  return null;
}

// Jours ouvrés d'un congé : du lundi au vendredi, hors jours fériés légaux.
export function joursOuvres(du, au) {
  let n = 0;
  for (let d = du; d <= au; d = addDays(d, 1)) {
    if (!isWeekend(d) && !ferie(d)) n++;
  }
  return n;
}

// Jours d'école (d'après le PDF) compris dans une période.
export function joursEcoleDans(du, au, reglages) {
  const liste = [];
  for (let d = du; d <= au; d = addDays(d, 1)) {
    if (!isWeekend(d) && !ferie(d) && categoriePdf(d, reglages) === 'ecole') liste.push(d);
  }
  return liste;
}
