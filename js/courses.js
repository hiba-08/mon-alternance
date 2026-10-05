// Séances de l'emploi du temps NetYParéo : données extraites le 04/10/2026 (data/cours-netypareo.json),
// éventuellement remplacées par un fichier .ics importé, puis complétées par tes propres corrections.
import { MATIERES, lireIntitule } from './subjects.js';
import { getRevision } from './store.js';
import { toISO } from './dates.js';

let SOURCE = null; // fichier extrait le 04/10/2026 (mode local et import initial)
let NUAGE = null; // séances de Supabase, tenues à jour par la fonction synchro-netypareo
let revisionNuage = 0;

export const FICHIER_COURS = 'data/cours-netypareo.json';

export async function chargerCours() {
  try {
    const r = await fetch(FICHIER_COURS);
    SOURCE = r.ok ? await r.json() : null;
  } catch {
    SOURCE = null;
  }
  return SOURCE;
}

export function definirSeancesNuage(seances, infos = null) {
  NUAGE = seances ? { seances, infos } : null;
  revisionNuage++;
}

export const coursDisponibles = () => Boolean(NUAGE?.seances?.length || SOURCE?.seances?.length);

export const TYPES_COURS = {
  cours: { label: 'Cours', icone: 'book' },
  td: { label: 'TD', icone: 'pencil' },
  tp: { label: 'TP', icone: 'flask' },
  examen: { label: 'Examen', icone: 'alert' },
  autre: { label: 'Autre', icone: 'star' },
};

export const LIEUX = ['CFAI', 'Supméca'];

// Type déduit uniquement de mentions explicites de NetYParéo (« EXAMEN », « TP … », « TD … »).
export function typeDepuisMentions(mentions = []) {
  if (mentions.some((m) => m.trim().toUpperCase() === 'EXAMEN')) return 'examen';
  if (mentions.some((m) => /^TP\b/i.test(m.trim()))) return 'tp';
  if (mentions.some((m) => /^TD\b/i.test(m.trim()))) return 'td';
  return null;
}

export function infoSource(state) {
  if (NUAGE) {
    const dates = NUAGE.seances.filter((s) => !s.annulee).map((s) => s.date).sort();
    return { origine: 'supabase', n: dates.length, du: dates[0], au: dates[dates.length - 1], ...NUAGE.infos };
  }
  if (state.importCours) {
    const s = state.importCours.seances;
    const dates = s.map((x) => x.date).sort();
    return { origine: 'ics', fichier: state.importCours.fichier, le: state.importCours.importeLe.slice(0, 10), n: s.length, du: dates[0], au: dates[dates.length - 1] };
  }
  if (SOURCE) {
    return { origine: 'netypareo', le: SOURCE.extraitLe, n: SOURCE.seances.length, du: SOURCE.couverture.du, au: SOURCE.couverture.au };
  }
  return null;
}

function effectif(s, state, groupesParDefaut) {
  const modif = state.coursModifies[s.uid] || {};
  const { ue, code, nom } = lireIntitule(s.intitule);
  const matiere = code ? MATIERES[code] || null : null;
  const mentions = s.mentions || [];
  const typeSource = typeDepuisMentions(mentions);
  const lieuSource = s.lieu === 'SUPMECA' ? 'Supméca' : null;
  return {
    uid: s.uid,
    date: s.date,
    debut: s.debut,
    fin: s.fin,
    intitule: s.intitule,
    nom,
    ue,
    code,
    matiere,
    enseignant: s.enseignant || null,
    salle: modif.salle || s.salle || null,
    salleOrigine: modif.salle ? 'toi' : s.salle ? 'netypareo' : null,
    lieu: modif.lieu || lieuSource || state.reglages.lieuParDefaut,
    lieuOrigine: modif.lieu ? 'toi' : lieuSource ? 'netypareo' : 'defaut',
    type: modif.type || typeSource || null,
    typeOrigine: modif.type ? 'toi' : typeSource ? 'netypareo' : null,
    mentions: mentions.filter((m) => m.trim().toUpperCase() !== 'EXAMEN'),
    note: modif.note || '',
    groupes: s.groupes || groupesParDefaut,
    annulee: Boolean(s.annulee),
  };
}

let cache = { cle: null, liste: [] };

export function tousLesCours(state) {
  const cle = `${getRevision()}|${SOURCE ? 1 : 0}|${revisionNuage}`;
  if (cache.cle === cle) return cache.liste;
  const extraits = SOURCE?.seances || [];
  const parUid = new Map(extraits.map((s) => [s.uid, s]));
  let base = extraits;
  if (NUAGE) {
    base = NUAGE.seances;
  } else if (state.importCours?.seances?.length) {
    // Le fichier .ics fait foi pour la liste des séances ; les détails extraits de la page web
    // (lieu « SUPMECA », mentions, initiale de l'enseignant) sont conservés quand la séance est connue.
    base = state.importCours.seances.map((e) => {
      const connu = parUid.get(e.uid);
      if (!connu) return e;
      return { ...e, enseignant: connu.enseignant || e.enseignant, lieu: connu.lieu || e.lieu, mentions: connu.mentions || e.mentions, salle: e.salle || connu.salle };
    });
  }
  const groupesParDefaut = SOURCE?.groupesParDefaut || null;
  const liste = base.map((s) => effectif(s, state, groupesParDefaut))
    .sort((a, b) => (a.date + a.debut).localeCompare(b.date + b.debut));
  cache = { cle, liste };
  return liste;
}

export const coursDuJour = (iso, state) => tousLesCours(state).filter((c) => c.date === iso);

// Regroupe les séances consécutives identiques (ex. Programmation 8h30–10h30 puis 10h30–12h30).
export function regrouper(cours) {
  const blocs = [];
  const signature = (c) => [c.intitule, c.enseignant, c.lieu, c.salle, c.type, c.mentions.join('¦'), c.note, c.annulee].join('|');
  for (const c of cours) {
    const dernier = blocs[blocs.length - 1];
    if (dernier && dernier.fin === c.debut && signature(dernier.seances[0]) === signature(c)) {
      dernier.fin = c.fin;
      dernier.seances.push(c);
    } else {
      blocs.push({ ...c, seances: [c] });
    }
  }
  return blocs;
}

// ---- Import d'un fichier iCalendar (.ics) exporté depuis NetYParéo ----

const desechapper = (t) => t.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function lireDate(v) {
  if (!v) return null;
  if (v.endsWith('Z')) {
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13)));
    return { date: toISO(d), heure: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
  }
  return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, heure: v.length > 8 ? `${v.slice(9, 11)}:${v.slice(11, 13)}` : null };
}

// « UE5.1 GI-MATH2 Mathématiques 2 - Calcul matriciel - Mme BELLONCLE » → intitulé + enseignant(s)
function separerResume(resume) {
  const morceaux = resume.split(' - ');
  const enseignants = [];
  while (morceaux.length > 1 && /^(M\.|Mme|Mlle)\s/.test(morceaux[morceaux.length - 1])) {
    enseignants.unshift(morceaux.pop());
  }
  return { intitule: morceaux.join(' - '), enseignant: enseignants.join(', ') || null };
}

export function lireICS(texte) {
  const lignes = texte.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const evenements = [];
  let courant = null;
  for (const ligne of lignes) {
    if (ligne === 'BEGIN:VEVENT') { courant = {}; continue; }
    if (ligne === 'END:VEVENT') { if (courant) evenements.push(courant); courant = null; continue; }
    if (!courant) continue;
    const i = ligne.indexOf(':');
    if (i < 0) continue;
    courant[ligne.slice(0, i).split(';')[0]] = ligne.slice(i + 1);
  }
  return evenements
    .map((e) => {
      const debut = lireDate(e.DTSTART);
      const fin = lireDate(e.DTEND);
      if (!e.UID || !debut?.heure || !fin?.heure) return null;
      const { intitule, enseignant } = separerResume(desechapper(e.SUMMARY || ''));
      const groupes = desechapper(e.DESCRIPTION || '').replace(/\s{2,}/g, ' ').replace(/(\d{2}-\d{2})(?=\S)/g, '$1, ').trim();
      const salle = desechapper(e.LOCATION || '');
      return { uid: e.UID, date: debut.date, debut: debut.heure, fin: fin.heure, intitule, enseignant, salle: salle || undefined, groupes: groupes || undefined };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date + a.debut).localeCompare(b.date + b.debut));
}
