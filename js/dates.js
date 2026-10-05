// Dates manipulées en chaînes locales « AAAA-MM-JJ » pour éviter les surprises de fuseau horaire.

export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Nombre de jours de « from » à « to » (positif si « to » est après).
export function diffDays(from, to) {
  return Math.round((parseISO(to) - parseISO(from)) / 86400000);
}

export const weekday = (iso) => parseISO(iso).getDay(); // 0 = dimanche
export const isWeekend = (iso) => [0, 6].includes(weekday(iso));

export function isoWeek(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // jeudi de la semaine
  const jan4 = new Date(d.getFullYear(), 0, 4);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
  return 1 + Math.round((d - jan4) / (7 * 86400000));
}

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const jourDuMois = (d) => (d.getDate() === 1 ? '1er' : String(d.getDate()));

// « lundi 12 octobre »
export function formatLong(iso, { annee = false } = {}) {
  const d = parseISO(iso);
  return `${JOURS[d.getDay()]} ${jourDuMois(d)} ${MOIS[d.getMonth()]}${annee ? ' ' + d.getFullYear() : ''}`;
}

// « lun. 12 oct. »
export function formatShort(iso, { annee = false } = {}) {
  const d = parseISO(iso);
  return `${JOURS_COURTS[d.getDay()]} ${jourDuMois(d)} ${MOIS_COURTS[d.getMonth()]}${annee ? ' ' + d.getFullYear() : ''}`;
}

// « 08:30 » → « 8h30 », « 17:00 » → « 17h »
export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function relative(n) {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  if (n === 2) return 'après-demain';
  if (n > 0 && n < 14) return `dans ${n} jours`;
  if (n >= 14 && n < 60) return `dans ${Math.round(n / 7)} semaines`;
  if (n >= 60) return `dans ${Math.round(n / 30)} mois`;
  return `il y a ${-n} jours`;
}

export function durationLabel(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}
