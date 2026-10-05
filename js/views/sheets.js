// Feuilles de saisie partagées entre les écrans : échéance, détail d'un cours, congé.
import { h, ic, openSheet, toast, confirmer, segmente, champ } from '../ui.js';
import { getState, update, nouvelId, horodatage } from '../store.js';
import { TYPES_ECHEANCE, PRIORITES, RAPPELS, nouvelleEcheance } from '../deadlines.js';
import { listeSujets, sujet } from '../subjects.js';
import { TYPES_COURS, LIEUX } from '../courses.js';
import { TYPES_CONGE, joursOuvres, joursEcoleDans } from '../calendar.js';
import { formatLong, formatShort, formatTime, cap, todayISO } from '../dates.js';

// ---------- Échéance ----------

export function ouvrirEcheance(existante, prerempli = {}) {
  const e = existante ? structuredClone(existante) : nouvelleEcheance(prerempli);
  const estNouvelle = !existante;

  const titre = h('input', { type: 'text', name: 'titre', required: true, maxlength: 120, value: e.titre, placeholder: 'Ex. Contrôle de mécanique', autocomplete: 'off' });
  const matiere = h('select', { name: 'matiere' },
    h('option', { value: '' }, '— Aucune —'),
    listeSujets().map((s) => h('option', { value: s.code, selected: s.code === e.matiere }, s.officiel)));
  const date = h('input', { type: 'date', name: 'date', required: true, value: e.date });
  const heure = h('input', { type: 'time', name: 'heure', value: e.heure || '' });
  const notes = h('textarea', { name: 'notes', rows: 3, placeholder: 'Chapitres à réviser, consignes, lien…' }, e.notes);

  const typeChoix = h('div', { class: 'chips-grid', role: 'radiogroup', 'aria-label': 'Type' },
    Object.entries(TYPES_ECHEANCE).map(([val, t]) =>
      h('label', { class: 'chip-choice' },
        h('input', { type: 'radio', name: 'type', value: val, checked: e.type === val }),
        h('span', {}, ic(t.icone), t.label))));

  const rappels = h('div', { class: 'chips-grid' },
    RAPPELS.map((r) => h('label', { class: 'chip-choice' },
      h('input', { type: 'checkbox', name: 'rappels', value: r.j, checked: e.rappels.includes(r.j) }),
      h('span', {}, r.label))));

  const form = h('form', { class: 'form', id: 'form-echeance', novalidate: true },
    champ('Titre', titre),
    h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Type'), typeChoix),
    champ('Matière', matiere),
    h('div', { class: 'field-row' }, champ('Date', date), champ('Heure (facultatif)', heure)),
    h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Priorité'),
      segmente('priorite', Object.entries(PRIORITES).map(([v, p]) => [v, p.label]), e.priorite)),
    h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, 'Rappels'), rappels,
      h('span', { class: 'field-help' }, `Envoyés à ${formatTime(getState().reglages.heureRappels)} (réglable). Notifications : pendant que l’app est ouverte, en attendant la V2.`)),
    champ('Notes', notes),
    e.source?.type === 'netypareo' && h('p', { class: 'source-note' }, ic('info'), 'Créée automatiquement à partir de NetYParéo.'));

  const enregistrer = (ev) => {
    ev?.preventDefault();
    const t = titre.value.trim();
    if (!t) { titre.focus(); toast('Donne un titre à l’échéance.'); return; }
    if (!date.value) { date.focus(); toast('Choisis une date.'); return; }
    const donnees = new FormData(form);
    const maj = {
      titre: t,
      type: donnees.get('type') || 'autre',
      matiere: matiere.value || null,
      date: date.value,
      heure: heure.value || null,
      priorite: donnees.get('priorite') || 'moyenne',
      rappels: donnees.getAll('rappels').map(Number).sort((a, b) => b - a),
      notes: notes.value.trim(),
      modifieLe: horodatage(),
    };
    update((s) => {
      if (estNouvelle) s.echeances.push({ ...e, ...maj });
      else Object.assign(s.echeances.find((x) => x.id === e.id) || {}, maj);
    });
    sheet.fermer();
    toast(estNouvelle ? 'Échéance ajoutée' : 'Échéance enregistrée');
  };
  form.addEventListener('submit', enregistrer);

  const supprimer = async () => {
    if (!(await confirmer(`Supprimer « ${e.titre} » ?`, { libelle: 'Supprimer', danger: true }))) return;
    update((s) => {
      s.echeances = s.echeances.filter((x) => x.id !== e.id);
      if (e.source?.type === 'netypareo') s.examensIgnores.push(e.source.uid);
    });
    sheet.fermer();
    toast('Échéance supprimée');
  };

  const sheet = openSheet({
    titre: estNouvelle ? 'Nouvelle échéance' : 'Modifier l’échéance',
    corps: form,
    pied: [
      !estNouvelle && h('button', { class: 'btn btn-ghost btn-danger-text', type: 'button', onclick: supprimer }, ic('trash'), 'Supprimer'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'form-echeance' }, ic('check'), 'Enregistrer'),
    ],
  });
  if (estNouvelle && !e.titre) setTimeout(() => titre.focus(), 50);
}

export function basculerFait(id) {
  let fait = false;
  update((s) => {
    const e = s.echeances.find((x) => x.id === id);
    if (!e) return;
    e.fait = !e.fait;
    e.faitLe = e.fait ? horodatage() : null;
    e.modifieLe = horodatage();
    fait = e.fait;
  });
  if (fait) toast('Bravo, c’est fait !', { action: 'Annuler', onAction: () => basculerFait(id) });
}

// ---------- Détail d'un cours ----------

const ORIGINE = { netypareo: 'd’après NetYParéo', toi: 'corrigé par toi', defaut: 'par défaut : NetYParéo ne précise pas le lieu' };

export function ouvrirCours(bloc) {
  const c = bloc.seances[0];
  const couleur = c.matiere?.couleur || '#94a3b8';
  const plusieurs = bloc.seances.length > 1;

  const ligne = (icone, label, valeur, note) => h('div', { class: 'detail-row' },
    h('span', { class: 'detail-icon' }, ic(icone)),
    h('div', {}, h('div', { class: 'detail-label' }, label), h('div', { class: 'detail-value' }, valeur || '—'), note && h('div', { class: 'detail-note' }, note)));

  const type = h('select', { name: 'type' },
    h('option', { value: '' }, 'Non précisé'),
    Object.entries(TYPES_COURS).map(([v, t]) => h('option', { value: v, selected: c.type === v }, t.label)));
  const lieu = h('select', { name: 'lieu' }, LIEUX.map((l) => h('option', { value: l, selected: c.lieu === l }, l)));
  const salle = h('input', { type: 'text', name: 'salle', value: c.salle || '', placeholder: 'Ex. Salle 10', maxlength: 40 });
  const note = h('textarea', { name: 'note', rows: 2, placeholder: 'Matériel à apporter, remarque…' }, c.note);

  const corps = h('div', { class: 'course-detail', style: { '--c': couleur } },
    h('div', { class: 'detail-list' },
      ligne('clock', 'Horaire', `${cap(formatLong(c.date))}, ${formatTime(bloc.debut)} – ${formatTime(bloc.fin)}`, plusieurs ? `${bloc.seances.length} séances consécutives` : null),
      ligne('book', 'Intitulé NetYParéo', c.intitule),
      ligne('user', 'Enseignant', c.enseignant || 'Non indiqué'),
      ligne('building', 'Établissement', c.lieu, ORIGINE[c.lieuOrigine]),
      ligne('door', 'Salle', c.salle || 'Non indiquée', c.salle ? (c.salleOrigine === 'toi' ? 'corrigée par toi' : 'd’après NetYParéo') : null),
      ligne('users', 'Groupes', c.groupes),
      c.mentions.length > 0 && ligne('info', 'Mentions NetYParéo', c.mentions.join(' · '))),
    h('h3', { class: 'detail-subtitle' }, 'Compléter ou corriger'),
    h('form', { class: 'form', id: 'form-cours', novalidate: true },
      h('div', { class: 'field-row' }, champ('Type', type), champ('Établissement', lieu)),
      champ('Salle', salle),
      champ('Note personnelle', note),
      plusieurs && h('p', { class: 'field-help' }, `Tes modifications s’appliquent aux ${bloc.seances.length} séances de ce bloc.`)));

  const enregistrer = (ev) => {
    ev?.preventDefault();
    update((s) => {
      for (const seance of bloc.seances) {
        const m = {};
        if (type.value && type.value !== (seance.typeOrigine === 'netypareo' ? seance.type : null)) m.type = type.value;
        if (lieu.value !== (seance.lieuOrigine === 'netypareo' ? 'Supméca' : s.reglages.lieuParDefaut)) m.lieu = lieu.value;
        if (salle.value.trim() && salle.value.trim() !== (seance.salleOrigine === 'netypareo' ? seance.salle : '')) m.salle = salle.value.trim();
        if (note.value.trim()) m.note = note.value.trim();
        if (Object.keys(m).length) s.coursModifies[seance.uid] = m;
        else delete s.coursModifies[seance.uid];
      }
    });
    sheet.fermer();
    toast('Cours mis à jour');
  };
  corps.querySelector('form').addEventListener('submit', enregistrer);

  const sheet = openSheet({
    titre: c.matiere?.officiel || c.nom,
    sousTitre: c.ue ? `${c.ue} · ${c.code}` : 'Événement',
    corps,
    pied: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { sheet.fermer(); ouvrirEcheance(null, { matiere: c.code || null, date: c.date }); } }, ic('plus'), 'Échéance'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'form-cours' }, ic('check'), 'Enregistrer'),
    ],
  });
}

// ---------- Congé ----------

export function ouvrirConge(existant) {
  const c = existant ? { ...existant } : { id: nouvelId(), du: todayISO(), au: todayISO(), type: 'cp', note: '' };
  const estNouveau = !existant;
  const du = h('input', { type: 'date', name: 'du', required: true, value: c.du });
  const au = h('input', { type: 'date', name: 'au', required: true, value: c.au });
  const type = h('select', { name: 'type' }, Object.entries(TYPES_CONGE).map(([v, l]) => h('option', { value: v, selected: c.type === v }, l)));
  const note = h('input', { type: 'text', name: 'note', value: c.note, placeholder: 'Facultatif', maxlength: 120 });
  const resume = h('p', { class: 'field-help', 'aria-live': 'polite' });

  const majResume = () => {
    resume.replaceChildren();
    if (!du.value || !au.value) return;
    if (au.value < du.value) { resume.append('La date de fin est avant la date de début.'); resume.className = 'field-help warn'; return; }
    const n = joursOuvres(du.value, au.value);
    const ecole = joursEcoleDans(du.value, au.value, getState().reglages);
    resume.className = ecole.length ? 'field-help warn' : 'field-help';
    resume.append(`${n} jour${n > 1 ? 's' : ''} ouvré${n > 1 ? 's' : ''} (lundi–vendredi, hors fériés).`);
    if (ecole.length) resume.append(` Attention : ${ecole.length} jour${ecole.length > 1 ? 's' : ''} d’école dans le calendrier PDF (${ecole.slice(0, 3).map((d) => formatShort(d)).join(', ')}${ecole.length > 3 ? '…' : ''}).`);
  };
  du.addEventListener('change', () => { if (au.value < du.value) au.value = du.value; majResume(); });
  au.addEventListener('change', majResume);
  majResume();

  const form = h('form', { class: 'form', id: 'form-conge', novalidate: true },
    h('div', { class: 'field-row' }, champ('Du', du), champ('Au (inclus)', au)),
    resume,
    champ('Type', type),
    champ('Note', note));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!du.value || !au.value || au.value < du.value) { toast('Vérifie les dates du congé.'); return; }
    const maj = { du: du.value, au: au.value, type: type.value, note: note.value.trim(), modifieLe: horodatage() };
    update((s) => {
      if (estNouveau) s.conges.push({ ...c, ...maj, creeLe: horodatage() });
      else Object.assign(s.conges.find((x) => x.id === c.id) || {}, maj);
    });
    sheet.fermer();
    toast(estNouveau ? 'Congé ajouté' : 'Congé enregistré');
  });

  const supprimer = async () => {
    if (!(await confirmer('Supprimer ce congé ?', { libelle: 'Supprimer', danger: true }))) return;
    update((s) => { s.conges = s.conges.filter((x) => x.id !== c.id); });
    sheet.fermer();
    toast('Congé supprimé');
  };

  const sheet = openSheet({
    titre: estNouveau ? 'Poser un congé' : 'Modifier le congé',
    corps: form,
    pied: [
      !estNouveau && h('button', { class: 'btn btn-ghost btn-danger-text', type: 'button', onclick: supprimer }, ic('trash'), 'Supprimer'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'form-conge' }, ic('check'), 'Enregistrer'),
    ],
  });
}

export const nomSujet = (code) => sujet(code)?.court || null;
