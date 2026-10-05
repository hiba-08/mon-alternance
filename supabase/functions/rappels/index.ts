// Mon Alternance — notifications push.
// Toutes les 15 minutes (pg_cron, clé publique) : prépare les rappels d'échéances et l'alerte de la veille
// d'un passage école ↔ entreprise, puis envoie la file d'attente (table notifications) à chaque appareil abonné.
// Depuis l'app (jeton de l'utilisatrice) : { action: 'cle' } renvoie la clé publique VAPID,
// { action: 'test' } envoie une notification de test.
// Déploiement : « Enforce JWT verification » désactivé ; l'authentification est vérifiée par withSupabase.
import { withSupabase } from 'npm:@supabase/server@1';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

// Contact transmis aux services de notification (Apple, Google, Mozilla) : l'adresse de l'app.
const CONTACT = Deno.env.get('CONTACT_PUSH') ?? 'https://github.com/';

const REGLAGES_PAR_DEFAUT = {
  heureRappels: '08:00',
  heureVeille: '19:00',
  notifRappels: true,
  notifVeille: true,
  passeSession2: false,
  fermeturesTravaillees: [] as string[],
  lieuParDefaut: 'CFAI',
  horaires: {} as Record<string, { debut: string; fin: string }>,
};

const TYPES: Record<string, string> = {
  controle: 'Contrôle', examen: 'Examen', devoir: 'Devoir', rendu: 'Rendu', oral: 'Oral', autre: 'Date importante',
};
const MATIERES: Record<string, string> = {
  'GI-MATH1': 'Analyse 1', 'GI-MATH2': 'Calcul matriciel', 'GI-PROG': 'Programmation', 'GI-MECA1': 'Mécanique',
  'GI-SDM1': 'Métallurgie', 'GI-ELEC1': 'Électronique', 'GI-AMEC': 'Analyse de mécanismes',
  'GI-EESY': 'Empreinte environnementale', 'GI-OGI': 'Organisation industrielle', 'GI-ANGL1': 'Anglais',
  'GI-COMM': 'Communication pro', 'GI-CAPT': 'Capteurs', entreprise: 'Entreprise',
};

// ---------- Dates à l'heure de Paris ----------

function maintenantParis() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function ajouterJours(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const jourSemaine = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Repère absolu en minutes, à l'heure de Paris, pour comparer des moments.
const repere = (iso: string, min: number) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 60000 + min;

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateCourte(iso: string) {
  const d = Number(iso.slice(8, 10));
  return `${JOURS[jourSemaine(iso)]} ${d === 1 ? '1er' : d} ${MOIS[Number(iso.slice(5, 7)) - 1]}`;
}
const heureFr = (hhmm: string) => `${Number(hhmm.slice(0, 2))}h${hhmm.slice(3, 5) === '00' ? '' : hhmm.slice(3, 5)}`;
function relatif(j: number) {
  if (j === 0) return 'aujourd’hui';
  if (j === 1) return 'demain';
  if (j === 7) return 'dans une semaine';
  return `dans ${j} jours`;
}

// ---------- Jours fériés et statut d'un jour (même règles que js/calendar.js) ----------

function paques(annee: number) {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}
function estFerie(iso: string) {
  const y = Number(iso.slice(0, 4));
  const p = paques(y);
  return [`${y}-01-01`, ajouterJours(p, 1), `${y}-05-01`, `${y}-05-08`, ajouterJours(p, 39), ajouterJours(p, 50),
    `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`].includes(iso);
}

type Contexte = { jours: Record<string, { statut: string }>; reglages: typeof REGLAGES_PAR_DEFAUT; conges: { du: string; au: string }[] };

// École ou entreprise pour un jour travaillé, null sinon.
function categorie(iso: string, ctx: Contexte): 'ecole' | 'entreprise' | null {
  const j = ctx.jours[iso];
  if (!j) return null;
  const js = jourSemaine(iso);
  if (js === 0 || js === 6 || estFerie(iso)) return null;
  const travaillee = j.statut === 'fermeture' && ctx.reglages.fermeturesTravaillees.includes(iso);
  if (j.statut === 'fermeture' && !travaillee) return null;
  if (ctx.conges.some((c) => c.du <= iso && iso <= c.au)) return null;
  if (j.statut === 'session2') return ctx.reglages.passeSession2 ? 'ecole' : 'entreprise';
  if (j.statut === 'entreprise' || travaillee) return 'entreprise';
  return 'ecole';
}

// ---------- File de notifications ----------

async function mettreEnFile(admin: any, userId: string, n: { cle: string; titre: string; texte: string; url?: string }) {
  await admin.from('notifications').upsert(
    { user_id: userId, cle: `${userId}:${n.cle}`, titre: n.titre, texte: n.texte, url: n.url ?? '#/aujourdhui' },
    { onConflict: 'cle', ignoreDuplicates: true },
  );
}

async function preparer(admin: any, userId: string) {
  const { data: elements } = await admin.from('elements').select('id,collection,donnees')
    .eq('user_id', userId).eq('supprime', false).in('collection', ['reglages', 'echeances', 'conges']);
  const reglages = { ...REGLAGES_PAR_DEFAUT, ...(elements ?? []).find((e: any) => e.id === 'reglages')?.donnees };
  const echeances = (elements ?? []).filter((e: any) => e.collection === 'echeances').map((e: any) => e.donnees);
  const conges = (elements ?? []).filter((e: any) => e.collection === 'conges').map((e: any) => e.donnees);
  const ici = maintenantParis();
  const maintenant = repere(ici.date, ici.minutes);

  // Rappels d'échéances
  if (reglages.notifRappels) {
    for (const e of echeances) {
      if (e.fait) continue;
      for (const j of e.rappels ?? []) {
        let min = minutes(reglages.heureRappels);
        if (j === 0 && e.heure) min = Math.min(min, Math.max(0, minutes(e.heure) - 60));
        const jour = ajouterJours(e.date, -j);
        const moment = repere(jour, min);
        if (moment > maintenant || maintenant - moment > 12 * 60) continue;
        const sujet = MATIERES[e.matiere] ? ` · ${MATIERES[e.matiere]}` : '';
        await mettreEnFile(admin, userId, {
          cle: `rappel:${e.id}:${j}:${e.date}`,
          titre: j === 0 ? `Aujourd’hui : ${e.titre}` : `Rappel : ${e.titre}`,
          texte: `${TYPES[e.type] ?? 'Échéance'}${sujet} — ${relatif(j)} (${dateCourte(e.date)}${e.heure ? ` à ${heureFr(e.heure)}` : ''})`,
          url: '#/echeances',
        });
      }
    }
  }

  // Veille d'un passage école ↔ entreprise
  const veille = minutes(reglages.heureVeille);
  if (reglages.notifVeille && ici.minutes >= veille && ici.minutes - veille <= 180) {
    const { data: doc } = await admin.from('documents').select('donnees').eq('user_id', userId).eq('cle', 'calendrier').maybeSingle();
    if (doc?.donnees?.jours) {
      const ctx: Contexte = { jours: doc.donnees.jours, reglages, conges };
      const demain = ajouterJours(ici.date, 1);
      const cat = categorie(demain, ctx);
      let precedente: string | null = null;
      for (let i = 0; i < 30 && !precedente; i++) precedente = categorie(ajouterJours(ici.date, -i), ctx);
      if (cat && precedente && cat !== precedente) {
        let texte = '';
        if (cat === 'ecole') {
          const { data: premier } = await admin.from('seances').select('intitule,debut,lieu')
            .eq('user_id', userId).eq('date', demain).eq('annulee', false).order('debut').limit(1).maybeSingle();
          texte = premier
            ? `Premier cours : ${premier.intitule.replace(/^UE\d+(?:\.\d+)?\s+GI-[A-Z0-9]+\s+/, '')} à ${heureFr(premier.debut)} · ${premier.lieu === 'SUPMECA' ? 'Supméca' : reglages.lieuParDefaut}`
            : 'Emploi du temps pas encore publié pour demain';
        } else {
          const h = reglages.horaires?.[String(jourSemaine(demain))];
          texte = h ? `Horaires : ${heureFr(h.debut)} – ${heureFr(h.fin)}` : 'Bonne reprise !';
        }
        await mettreEnFile(admin, userId, {
          cle: `veille:${demain}`,
          titre: cat === 'ecole' ? 'Demain : retour à l’école' : 'Demain : retour en entreprise',
          texte,
          url: `#/aujourdhui/${demain}`,
        });
      }
    }
  }
}

// ---------- Clés VAPID (créées au premier appel, gardées dans cles_serveur) ----------

async function clesVapid(admin: any) {
  const lire = async () => (await admin.from('cles_serveur').select('valeur').eq('nom', 'vapid').maybeSingle()).data;
  let ligne = await lire();
  if (!ligne) {
    const paire = await webpush.generateVapidKeys({ extractable: true });
    const valeur = { jwk: await webpush.exportVapidKeys(paire), publique: await webpush.exportApplicationServerKey(paire) };
    await admin.from('cles_serveur').upsert({ nom: 'vapid', valeur }, { onConflict: 'nom', ignoreDuplicates: true });
    ligne = await lire();
  }
  return {
    cles: await webpush.importVapidKeys(ligne.valeur.jwk, { extractable: false }),
    publique: ligne.valeur.publique as string,
  };
}

async function envoyerFile(admin: any, userId?: string) {
  let requete = admin.from('notifications').select('*').is('envoyee_le', null).lt('essais', 5)
    .gte('cree_le', new Date(Date.now() - 2 * 86400000).toISOString()).order('cree_le').limit(50);
  if (userId) requete = requete.eq('user_id', userId);
  const { data: file } = await requete;
  if (!file?.length) return { envoyees: 0, appareils: 0 };

  const { cles } = await clesVapid(admin);
  const serveur = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys: cles });
  const utilisateurs = [...new Set(file.map((n: any) => n.user_id))];
  const { data: abonnements } = await admin.from('abonnements_push').select('*').in('user_id', utilisateurs);

  let envoyees = 0;
  const appareils = new Set<string>();
  for (const n of file) {
    const cibles = (abonnements ?? []).filter((a: any) => a.user_id === n.user_id);
    if (!cibles.length) continue; // reste en attente jusqu'à ce qu'un appareil s'abonne (2 jours max)
    let reussi = false;
    for (const a of cibles) {
      try {
        await serveur.subscribe({ endpoint: a.endpoint, keys: a.cles }).pushTextMessage(
          JSON.stringify({ titre: n.titre, texte: n.texte, url: n.url, tag: n.cle }),
          { ttl: 86400, urgency: webpush.Urgency.High },
        );
        reussi = true;
        appareils.add(a.endpoint);
        await admin.from('abonnements_push').update({ dernier_envoi: new Date().toISOString() }).eq('endpoint', a.endpoint);
      } catch (e) {
        const statut = e instanceof webpush.PushMessageError ? e.response.status : 0;
        if (statut === 404 || statut === 410) {
          await admin.from('abonnements_push').delete().eq('endpoint', a.endpoint);
        } else {
          console.error('Envoi impossible', statut, e instanceof Error ? e.message : e);
        }
      }
    }
    await admin.from('notifications').update(reussi ? { envoyee_le: new Date().toISOString() } : { essais: n.essais + 1 }).eq('id', n.id);
    if (reussi) envoyees++;
  }
  return { envoyees, appareils: appareils.size };
}

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req: Request, ctx: any) => {
    const admin = ctx.supabaseAdmin;
    if (ctx.authMode === 'user') {
      const userId = ctx.userClaims.id;
      const corps = await req.json().catch(() => ({}));
      if (corps.action === 'cle') return Response.json({ cle: (await clesVapid(admin)).publique });
      if (corps.action === 'test') {
        await mettreEnFile(admin, userId, {
          cle: `test:${Date.now()}`,
          titre: 'Mon Alternance',
          texte: 'Les notifications fonctionnent sur tes appareils.',
          url: '#/reglages',
        });
        return Response.json(await envoyerFile(admin, userId));
      }
      return Response.json({ erreur: 'Action inconnue' }, { status: 400 });
    }

    // Appel planifié : tous les comptes qui ont au moins un appareil abonné
    const { data: abonnes } = await admin.from('abonnements_push').select('user_id');
    for (const id of new Set<string>((abonnes ?? []).map((a: any) => a.user_id))) {
      try {
        await preparer(admin, id);
      } catch (e) {
        console.error('Préparation impossible', e instanceof Error ? e.message : e);
      }
    }
    return Response.json(await envoyerFile(admin));
  }),
};
