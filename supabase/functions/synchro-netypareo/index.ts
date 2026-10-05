// Mon Alternance — mise à jour de l'emploi du temps depuis le flux iCalendar NetYParéo.
// Appelée toutes les 3 heures par pg_cron (clé publique) ou depuis l'app (« Mettre à jour maintenant »).
// Le lien iCalendar est lu dans la table liens_prives, jamais renvoyé ni journalisé.
// Déploiement : « Enforce JWT verification » désactivé ; l'authentification est vérifiée par withSupabase.
import { withSupabase } from 'npm:@supabase/server@1';

type Seance = {
  uid: string;
  date: string;
  debut: string;
  fin: string;
  intitule: string;
  enseignant: string | null;
  salle: string | null;
  groupes: string | null;
};

type Existante = Seance & { annulee: boolean };

const ECART_MIN_PLANIFIE_MINUTES = 20; // une synchro planifiée au plus toutes les 20 minutes
const FENETRE_ALERTE_JOURS = 14; // changements signalés seulement s'ils concernent les 14 prochains jours
const MAX_ALERTES_DETAILLEES = 5;

// ---------- Dates à l'heure de Paris ----------

function partiesParis(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}

function ajouterJours(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateCourte(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${JOURS[t.getUTCDay()]} ${d === 1 ? '1er' : d} ${MOIS[m - 1]}`;
}
const heureFr = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};

// ---------- Lecture du flux iCalendar (même logique que js/courses.js) ----------

const desechapper = (t: string) => t.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function lireDate(v?: string) {
  if (!v) return null;
  if (v.endsWith('Z')) {
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13)));
    return partiesParis(d);
  }
  return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, heure: v.length > 8 ? `${v.slice(9, 11)}:${v.slice(11, 13)}` : null };
}

function separerResume(resume: string) {
  const morceaux = resume.split(' - ');
  const enseignants: string[] = [];
  while (morceaux.length > 1 && /^(M\.|Mme|Mlle)\s/.test(morceaux[morceaux.length - 1])) {
    enseignants.unshift(morceaux.pop()!);
  }
  return { intitule: morceaux.join(' - '), enseignant: enseignants.join(', ') || null };
}

function lireICS(texte: string): Seance[] {
  const lignes = texte.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const evenements: Record<string, string>[] = [];
  let courant: Record<string, string> | null = null;
  for (const ligne of lignes) {
    if (ligne === 'BEGIN:VEVENT') { courant = {}; continue; }
    if (ligne === 'END:VEVENT') { if (courant) evenements.push(courant); courant = null; continue; }
    if (!courant) continue;
    const i = ligne.indexOf(':');
    if (i < 0) continue;
    courant[ligne.slice(0, i).split(';')[0]] = ligne.slice(i + 1);
  }
  const seances: Seance[] = [];
  for (const e of evenements) {
    const debut = lireDate(e.DTSTART);
    const fin = lireDate(e.DTEND);
    if (!e.UID || !debut?.heure || !fin?.heure) continue;
    const { intitule, enseignant } = separerResume(desechapper(e.SUMMARY || ''));
    const groupes = desechapper(e.DESCRIPTION || '').replace(/\s{2,}/g, ' ').replace(/(\d{2}-\d{2})(?=\S)/g, '$1, ').trim();
    seances.push({
      uid: e.UID, date: debut.date, debut: debut.heure, fin: fin.heure, intitule, enseignant,
      salle: desechapper(e.LOCATION || '') || null, groupes: groupes || null,
    });
  }
  return seances;
}

// « M. COUFFIN F. » (page web) est plus complet que « M. COUFFIN » (iCalendar) : on le garde.
function garderEnseignant(existant: string | null, ical: string | null) {
  if (!existant) return ical;
  if (!ical) return existant;
  const noms = ical.match(/\b[A-ZÀ-Ý][A-ZÀ-Ý' -]{1,}\b/g) || [];
  return noms.every((n) => existant.includes(n.trim())) ? existant : ical;
}

const nomCourt = (intitule: string) => intitule.replace(/^UE\d+(?:\.\d+)?\s+GI-[A-Z0-9]+\s+/, '');

// ---------- Synchronisation d'un compte ----------

async function synchroniser(admin: any, userId: string, lien: string, declencheur: string) {
  const reponse = await fetch(lien, { headers: { 'Cache-Control': 'no-cache' } });
  if (!reponse.ok) throw new Error(`NetYParéo a répondu ${reponse.status}`);
  const texte = await reponse.text();
  if (!texte.includes('BEGIN:VCALENDAR')) throw new Error('La réponse de NetYParéo n’est pas un calendrier');
  const flux = lireICS(texte);
  if (!flux.length) throw new Error('Aucune séance dans le flux NetYParéo');

  const { data: existantes, error } = await admin
    .from('seances').select('uid,date,debut,fin,intitule,enseignant,salle,groupes,annulee').eq('user_id', userId);
  if (error) throw error;
  const parUid = new Map<string, Existante>((existantes ?? []).map((s: Existante) => [s.uid, s]));
  const premiere = parUid.size === 0;

  const dates = flux.map((s) => s.date).sort();
  const du = dates[0];
  const au = dates[dates.length - 1];
  const aujourdhui = partiesParis(new Date()).date;
  const limite = ajouterJours(aujourdhui, FENETRE_ALERTE_JOURS);
  const proche = (iso: string) => iso >= aujourdhui && iso <= limite;
  const maintenant = new Date().toISOString();

  const alertes: { cle: string; titre: string; texte: string; url: string }[] = [];
  let ajouts = 0, modifications = 0, annulations = 0;
  const presents = new Set<string>();

  const lignes = flux.map((s) => {
    presents.add(s.uid);
    const avant = parUid.get(s.uid);
    const enseignant = garderEnseignant(avant?.enseignant ?? null, s.enseignant);
    if (!avant) {
      ajouts++;
      if (!premiere && proche(s.date)) {
        alertes.push({
          cle: `edt:${s.uid}:ajout:${s.date}:${s.debut}`,
          titre: `Nouveau cours : ${nomCourt(s.intitule)}`,
          texte: `${dateCourte(s.date)} de ${heureFr(s.debut)} à ${heureFr(s.fin)}${s.salle ? ` · ${s.salle}` : ''}`,
          url: `#/aujourdhui/${s.date}`,
        });
      }
    } else if (avant.annulee || avant.date !== s.date || avant.debut !== s.debut || avant.fin !== s.fin || (avant.salle || null) !== s.salle) {
      modifications++;
      if (proche(s.date) || proche(avant.date)) {
        const deplace = avant.date !== s.date || avant.debut !== s.debut;
        alertes.push({
          cle: `edt:${s.uid}:modif:${s.date}:${s.debut}:${s.fin}:${s.salle ?? ''}`,
          titre: `${avant.annulee ? 'Cours rétabli' : deplace ? 'Cours déplacé' : 'Cours modifié'} : ${nomCourt(s.intitule)}`,
          texte: deplace
            ? `${dateCourte(avant.date)} ${heureFr(avant.debut)} → ${dateCourte(s.date)} ${heureFr(s.debut)}${s.salle ? ` · ${s.salle}` : ''}`
            : `${dateCourte(s.date)} ${heureFr(s.debut)}–${heureFr(s.fin)}${s.salle ? ` · ${s.salle}` : ''}`,
          url: `#/aujourdhui/${s.date}`,
        });
      }
    }
    return {
      user_id: userId, uid: s.uid, date: s.date, debut: s.debut, fin: s.fin, intitule: s.intitule,
      enseignant, salle: s.salle, groupes: s.groupes, annulee: false, vu_le: maintenant,
    };
  });

  // Séances disparues du flux, dans la période qu'il couvre : marquées annulées (jamais supprimées).
  const disparues = (existantes ?? []).filter((s: Existante) => !s.annulee && !presents.has(s.uid) && s.date >= du && s.date <= au);
  annulations = disparues.length;
  for (const s of disparues) {
    if (proche(s.date)) {
      alertes.push({
        cle: `edt:${s.uid}:annule:${s.date}:${s.debut}`,
        titre: `Cours annulé : ${nomCourt(s.intitule)}`,
        texte: `${dateCourte(s.date)} à ${heureFr(s.debut)} (retiré de NetYParéo)`,
        url: `#/aujourdhui/${s.date}`,
      });
    }
  }

  for (let i = 0; i < lignes.length; i += 500) {
    const { error: e } = await admin.from('seances').upsert(lignes.slice(i, i + 500), { onConflict: 'user_id,uid' });
    if (e) throw e;
  }
  if (disparues.length) {
    const { error: e } = await admin.from('seances').update({ annulee: true })
      .eq('user_id', userId).in('uid', disparues.map((s: Existante) => s.uid));
    if (e) throw e;
  }

  // Notifications de changement (si elles sont activées dans les réglages synchronisés)
  const { data: reglages } = await admin.from('elements').select('donnees')
    .eq('user_id', userId).eq('id', 'reglages').maybeSingle();
  if (alertes.length && reglages?.donnees?.notifEdt !== false) {
    const file = alertes.length <= MAX_ALERTES_DETAILLEES ? alertes : [{
      cle: `edt:resume:${maintenant}`,
      titre: 'Emploi du temps modifié',
      texte: `${alertes.length} changements dans les ${FENETRE_ALERTE_JOURS} prochains jours`,
      url: '#/aujourdhui',
    }];
    await admin.from('notifications').upsert(
      file.map((a) => ({ ...a, cle: `${userId}:${a.cle}`, user_id: userId })),
      { onConflict: 'cle', ignoreDuplicates: true },
    );
  }

  const resume = { statut: 'ok', nb_seances: flux.length, ajouts, modifications, annulations };
  await admin.from('synchros').insert({
    user_id: userId, declencheur, ...resume,
    message: premiere ? 'Premier import' : `${alertes.length} changement(s) dans les ${FENETRE_ALERTE_JOURS} prochains jours`,
  });
  return resume;
}

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (_req: Request, ctx: any) => {
    const admin = ctx.supabaseAdmin;
    const manuelle = ctx.authMode === 'user';
    let requete = admin.from('liens_prives').select('user_id, netypareo_ical');
    if (manuelle) requete = requete.eq('user_id', ctx.userClaims.id);
    const { data: liens, error } = await requete;
    if (error) return Response.json({ ok: false, erreur: 'lecture impossible' }, { status: 500 });
    if (manuelle && !liens?.length) {
      return Response.json({ ok: false, erreur: 'Aucun lien NetYParéo enregistré' }, { status: 400 });
    }

    const resultats = [];
    for (const { user_id, netypareo_ical } of liens ?? []) {
      if (!manuelle) {
        const { data: derniere } = await admin.from('synchros').select('lancee_le')
          .eq('user_id', user_id).order('lancee_le', { ascending: false }).limit(1).maybeSingle();
        if (derniere && Date.now() - Date.parse(derniere.lancee_le) < ECART_MIN_PLANIFIE_MINUTES * 60000) {
          resultats.push({ statut: 'ignorée (trop récente)' });
          continue;
        }
      }
      try {
        resultats.push(await synchroniser(admin, user_id, netypareo_ical, manuelle ? 'manuelle' : 'planifiée'));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await admin.from('synchros').insert({ user_id, declencheur: manuelle ? 'manuelle' : 'planifiée', statut: 'erreur', message });
        resultats.push({ statut: 'erreur', message });
      }
    }
    return Response.json({ ok: true, resultats });
  }),
};
