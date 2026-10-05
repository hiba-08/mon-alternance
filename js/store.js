// Données personnelles, enregistrées dans le navigateur (localStorage).
// Chaque élément porte un id et des dates de création/modification pour préparer
// la synchronisation entre appareils (V2).

const CLE = 'mon-alternance:v1';

export const REGLAGES_PAR_DEFAUT = {
  theme: 'auto', // auto | light | dark
  // Horaires en entreprise par jour de semaine (1 = lundi … 5 = vendredi).
  horaires: {
    1: { debut: '08:00', fin: '17:00' },
    2: { debut: '08:00', fin: '17:00' },
    3: { debut: '08:00', fin: '17:00' },
    4: { debut: '08:00', fin: '17:00' },
    5: { debut: '08:00', fin: '17:00' },
  },
  passeSession2: false, // épreuves de session 2 du S5 (30–31 mars 2027)
  // Jours noirs du PDF (fermeture CFAI/Supméca) où tu travailles quand même en entreprise.
  fermeturesTravaillees: ['2027-05-07'], // confirmé le 04/10/2026
  lieuParDefaut: 'CFAI', // quand NetYParéo ne précise pas le lieu
  heureRappels: '08:00',
  heureVeille: '19:00', // alerte la veille d'un passage école ↔ entreprise
  notifRappels: true,
  notifVeille: true,
  notifEdt: true, // cours déplacé, annulé ou ajouté dans les 14 prochains jours
  notifications: false, // propre à cet appareil (non synchronisé)
};

function etatInitial() {
  return {
    version: 1,
    reglages: structuredClone(REGLAGES_PAR_DEFAUT),
    echeances: [],
    taches: [],
    conges: [],
    coursModifies: {}, // uid de séance → { type, lieu, salle, note }
    examensIgnores: [], // uid des examens NetYParéo dont tu as supprimé l'échéance
    rappelsEnvoyes: {},
    importCours: null, // dernier fichier .ics importé
    modifieLe: null,
  };
}

function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return etatInitial();
    const lu = JSON.parse(brut);
    const etat = { ...etatInitial(), ...lu };
    etat.reglages = { ...structuredClone(REGLAGES_PAR_DEFAUT), ...lu.reglages };
    etat.reglages.horaires = { ...structuredClone(REGLAGES_PAR_DEFAUT.horaires), ...lu.reglages?.horaires };
    const vus = new Set();
    etat.echeances = etat.echeances.filter((e) => {
      if (e.source?.type === 'netypareo' && e.source.uid) e.id = `examen-${e.source.uid}`;
      if (vus.has(e.id)) return false;
      vus.add(e.id);
      return true;
    });
    return etat;
  } catch (e) {
    console.error('Lecture des données impossible', e);
    return etatInitial();
  }
}

let etat = charger();
let revision = 0;
const abonnes = new Set();

export const getState = () => etat;
export const getRevision = () => revision;

export function update(modifier, { distant = false } = {}) {
  modifier(etat);
  etat.modifieLe = new Date().toISOString();
  revision++;
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch (e) {
    console.error('Enregistrement impossible', e);
  }
  abonnes.forEach((fn) => fn(etat, { distant }));
}

export function subscribe(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}

export function nouvelId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const horodatage = () => new Date().toISOString();

export function exporter() {
  return JSON.stringify({ application: 'Mon Alternance', exporteLe: horodatage(), donnees: etat }, null, 2);
}

export function importer(texte) {
  const obj = JSON.parse(texte);
  const donnees = obj.donnees || obj;
  if (!donnees || !Array.isArray(donnees.echeances) || !donnees.reglages) {
    throw new Error("Ce fichier n'est pas une sauvegarde de Mon Alternance.");
  }
  update((s) => {
    Object.assign(s, etatInitial(), donnees);
    s.reglages = { ...structuredClone(REGLAGES_PAR_DEFAUT), ...donnees.reglages };
  });
}

export function reinitialiser({ distant = false } = {}) {
  update((s) => Object.assign(s, etatInitial()), { distant });
}
