import { h, ic, toast, confirmer, segmente } from '../ui.js';
import { getState, update, exporter, importer, reinitialiser, REGLAGES_PAR_DEFAUT } from '../store.js';
import { infoSource, lireICS, LIEUX } from '../courses.js';
import { formatShort, formatTime, JOURS, JOURS_COURTS, cap } from '../dates.js';
import * as cloud from '../cloud.js';

const PREFIXE_LIEN = 'https://netpareo.mecavenir.com/index.php/planning/ical/';

function carte(titre, icone, ...contenu) {
  return h('section', { class: 'card settings-card' },
    h('h2', { class: 'card-title' }, ic(icone), titre),
    ...contenu);
}

function telecharger(nom, texte, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([texte], { type }));
  const a = h('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function choisirFichier(accept, lire) {
  const input = h('input', { type: 'file', accept, class: 'visually-hidden-input' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.remove();
    if (f) lire(await f.text(), f.name);
  });
  document.body.append(input);
  input.click();
}

// Bouton qui se désactive le temps d'une action asynchrone.
function bouton(classe, contenu, action) {
  const b = h('button', { class: classe, type: 'button' }, contenu);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      toast(e.message || String(e));
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

function interrupteur(titre, aide, coche, onChange, attrs = {}) {
  return h('label', { class: 'switch-row' },
    h('span', {}, h('strong', {}, titre), aide && h('span', { class: 'muted block' }, aide)),
    h('input', { type: 'checkbox', role: 'switch', checked: coche, onchange: (e) => onChange(e.target.checked), ...attrs }));
}

const quand = (iso) => {
  const d = new Date(iso);
  return `${formatShort(iso.slice(0, 10))} à ${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
};

const STATUTS_SYNCHRO = {
  'a-jour': ['ok', 'À jour'],
  synchro: ['busy', 'Synchronisation…'],
  'hors-ligne': ['warn', 'Hors ligne'],
  erreur: ['error', 'Erreur de synchronisation'],
  inactif: ['warn', 'En attente'],
};

function carteCompte() {
  if (cloud.modeLocal()) {
    return carte('Compte', 'user',
      h('p', { class: 'card-text' }, 'Mode local : tes données restent dans ce navigateur, sans synchronisation.'),
      cloud.cloudConfigure && h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => cloud.choisirModeLocal(false) }, ic('user'), 'Se connecter')));
  }
  const e = cloud.etat;
  const [classe, libelle] = STATUTS_SYNCHRO[e.statut] || STATUTS_SYNCHRO.inactif;
  return carte('Compte et synchronisation', 'user',
    h('p', { class: 'card-text' }, 'Connectée en tant que ', h('strong', {}, e.email || '…')),
    h('div', { class: 'sync-line' },
      h('span', { class: `pill pill-${classe}` }, h('i', { class: 'dot' }), libelle),
      e.enAttente > 0 && h('span', { class: 'muted' }, `${e.enAttente} modification${e.enAttente > 1 ? 's' : ''} en attente d’envoi`),
      e.derniereSynchro && e.statut === 'a-jour' && h('span', { class: 'muted' }, `dernière synchronisation ${quand(e.derniereSynchro)}`)),
    e.erreur && h('p', { class: 'field-help warn' }, e.erreur),
    h('div', { class: 'btn-row' },
      bouton('btn btn-soft', [ic('refresh'), 'Synchroniser'], () => cloud.synchroniser()),
      bouton('btn btn-ghost btn-danger-text', 'Se déconnecter', async () => {
        if (!(await confirmer('Se déconnecter ? Les données de cet appareil seront effacées ; elles restent dans ton compte et reviendront à la prochaine connexion.', { libelle: 'Se déconnecter', danger: true }))) return;
        await cloud.deconnexion();
      })));
}

function carteEmploiDuTemps(state) {
  const src = infoSource(state);
  if (cloud.modeLocal()) {
    return carte('Emploi du temps', 'school',
      src && h('p', { class: 'card-text' },
        src.origine === 'ics'
          ? `Fichier « ${src.fichier} » importé le ${formatShort(src.le, { annee: true })} : ${src.n} séances, du ${formatShort(src.du)} au ${formatShort(src.au, { annee: true })}.`
          : `Données NetYParéo extraites le ${formatShort(src.le, { annee: true })} : ${src.n} séances, du ${formatShort(src.du)} au ${formatShort(src.au, { annee: true })}.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-soft', type: 'button', onclick: () => choisirFichier('.ics,text/calendar', (texte, nom) => {
          const seances = lireICS(texte);
          if (!seances.length) { toast('Aucune séance trouvée dans ce fichier.'); return; }
          update((s) => { s.importCours = { fichier: nom, importeLe: new Date().toISOString(), seances }; });
          toast(`${seances.length} séances importées`);
        }) }, ic('upload'), 'Importer un .ics')));
  }

  const e = cloud.etat;
  const s = e.synchroEdt;
  const champ = h('input', {
    type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    placeholder: `${PREFIXE_LIEN}…`, 'aria-label': 'Lien iCalendar NetYParéo',
  });
  return carte('Emploi du temps', 'school',
    h('p', { class: 'card-text' }, 'Mis à jour automatiquement toutes les 3 heures depuis NetYParéo. Tu es prévenue si un cours des 14 prochains jours change.'),
    src && h('p', { class: 'card-text' }, `${src.n} séances en ligne, du ${formatShort(src.du)} au ${formatShort(src.au, { annee: true })}.`),
    s && h('p', { class: `card-text ${s.statut === 'erreur' ? 'warn' : 'muted'}` },
      s.statut === 'erreur'
        ? `Dernière tentative ${quand(s.lancee_le)} : ${s.message}`
        : `Dernière mise à jour ${quand(s.lancee_le)} (${s.declencheur}) : ${s.ajouts} ajout(s), ${s.modifications} modification(s), ${s.annulations} annulation(s).`),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Lien iCalendar NetYParéo'),
      h('p', { class: 'field-help' }, e.lienEdt
        ? `Enregistré le ${quand(e.lienEdt)}. Il ne s’affiche plus : il est personnel. Tu peux le remplacer ci-dessous.`
        : 'Pas encore enregistré. Dans NetYParéo : Planning → menu → « Exporter au format iCalendar » → Copier, puis colle-le ici.'),
      champ),
    h('div', { class: 'btn-row' },
      bouton('btn btn-primary', [ic('check'), 'Enregistrer le lien'], async () => {
        const lien = champ.value.trim();
        if (!lien.startsWith(PREFIXE_LIEN)) throw new Error('Ce n’est pas un lien iCalendar NetYParéo.');
        await cloud.enregistrerLienNetypareo(lien);
        champ.value = '';
        toast('Lien enregistré. Mise à jour de l’emploi du temps…');
        const r = await cloud.mettreAJourEdt();
        if (r?.statut === 'ok') toast(`Emploi du temps à jour : ${r.nb_seances} séances`);
        else if (r?.message) toast(r.message);
      }),
      e.lienEdt && bouton('btn btn-soft', [ic('refresh'), 'Mettre à jour maintenant'], async () => {
        const r = await cloud.mettreAJourEdt();
        if (r?.statut === 'ok') toast(`Emploi du temps à jour : ${r.ajouts} ajout(s), ${r.modifications} modification(s), ${r.annulations} annulation(s)`);
        else if (r?.message) toast(r.message);
      })));
}

function carteNotifications(r, setReglage) {
  if (cloud.modeLocal()) {
    const permission = 'Notification' in window ? Notification.permission : 'indisponible';
    return carte('Rappels', 'bell',
      h('label', { class: 'field inline' },
        h('span', { class: 'field-label' }, 'Heure des rappels'),
        h('input', { type: 'time', value: r.heureRappels, onchange: (e) => e.target.value && setReglage((rg) => { rg.heureRappels = e.target.value; }) })),
      interrupteur('Notifications sur cet appareil',
        permission === 'denied' ? 'Bloquées par le navigateur : autorise-les dans les réglages du site.' : 'Mode local : elles n’arrivent que si l’app est ouverte.',
        r.notifications && permission === 'granted',
        async (coche) => {
          if (coche && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission();
            if (p !== 'granted') { toast('Notifications refusées.'); setReglage(() => {}); return; }
          }
          setReglage((rg) => { rg.notifications = coche; });
        },
        { disabled: permission === 'indisponible' || permission === 'denied' }));
  }

  const etatAppareil = h('div', { class: 'device-state' }, h('p', { class: 'muted' }, 'Vérification…'));
  const remplir = async () => {
    if (!cloud.pushDisponible()) {
      etatAppareil.replaceChildren(h('p', { class: 'card-text warn' }, cloud.estIOS() && !cloud.estInstallee()
        ? 'Sur iPhone et iPad, installe d’abord l’app sur l’écran d’accueil (voir « Installer l’app »), puis ouvre-la depuis son icône pour activer les notifications.'
        : 'Ce navigateur ne gère pas les notifications push.'));
      return;
    }
    const abo = await cloud.abonnementActuel().catch(() => null);
    const permission = Notification.permission;
    etatAppareil.replaceChildren(
      abo && permission === 'granted'
        ? h('div', { class: 'sync-line' }, h('span', { class: 'pill pill-ok' }, h('i', { class: 'dot' }), 'Activées sur cet appareil'))
        : h('p', { class: 'card-text' }, permission === 'denied'
          ? 'Les notifications sont bloquées pour cette app. Autorise-les dans les réglages de l’appareil, puis réessaie.'
          : 'Pas encore activées sur cet appareil.'),
      h('div', { class: 'btn-row' },
        abo && permission === 'granted'
          ? [
            bouton('btn btn-soft', [ic('bell'), 'Envoyer un test'], async () => {
              const res = await cloud.notificationTest();
              toast(res?.envoyees ? `Notification envoyée à ${res.appareils} appareil${res.appareils > 1 ? 's' : ''}` : 'Aucun appareil n’a reçu la notification.');
            }),
            bouton('btn btn-ghost', 'Désactiver ici', async () => { await cloud.desactiverNotifications(); remplir(); }),
          ]
          : permission !== 'denied' && bouton('btn btn-primary', [ic('bell'), 'Activer sur cet appareil'], async () => {
            await cloud.activerNotifications();
            toast('Notifications activées sur cet appareil');
            remplir();
          })));
    const appareils = await cloud.appareilsAbonnes().catch(() => []);
    if (appareils.length) {
      etatAppareil.append(h('p', { class: 'field-help' }, `Appareils abonnés : ${appareils.map((a) => a.appareil || 'appareil').join(', ')}.`));
    }
  };
  remplir();

  return carte('Notifications', 'bell',
    etatAppareil,
    h('div', { class: 'notif-prefs' },
      interrupteur('Rappels d’échéances', 'Selon les rappels choisis pour chaque échéance.', r.notifRappels !== false,
        (v) => setReglage((rg) => { rg.notifRappels = v; })),
      h('label', { class: 'field inline' },
        h('span', { class: 'field-label' }, 'Heure des rappels'),
        h('input', { type: 'time', value: r.heureRappels, onchange: (e) => e.target.value && setReglage((rg) => { rg.heureRappels = e.target.value; }) })),
      interrupteur('Veille d’un passage école ↔ entreprise', 'Le soir avant, avec ton premier cours ou tes horaires.', r.notifVeille !== false,
        (v) => setReglage((rg) => { rg.notifVeille = v; })),
      h('label', { class: 'field inline' },
        h('span', { class: 'field-label' }, 'Heure de l’alerte de la veille'),
        h('input', { type: 'time', value: r.heureVeille || '19:00', onchange: (e) => e.target.value && setReglage((rg) => { rg.heureVeille = e.target.value; }) })),
      interrupteur('Changements d’emploi du temps', 'Cours déplacé, annulé ou ajouté dans les 14 prochains jours.', r.notifEdt !== false,
        (v) => setReglage((rg) => { rg.notifEdt = v; }))),
    h('p', { class: 'field-help' }, 'Ces préférences valent pour tous tes appareils. Les notifications sont vérifiées toutes les 15 minutes.'));
}

function carteInstallation() {
  if (cloud.estLocalhost()) return null;
  const installee = cloud.estInstallee();
  return carte('Installer l’app', 'download',
    installee
      ? h('div', { class: 'sync-line' }, h('span', { class: 'pill pill-ok' }, h('i', { class: 'dot' }), 'Installée sur cet appareil'))
      : h('ul', { class: 'install-steps' },
        h('li', {}, h('strong', {}, 'iPhone et iPad (Safari) : '), 'bouton Partager ', ic('upload'), ' → « Sur l’écran d’accueil » → Ajouter.'),
        h('li', {}, h('strong', {}, 'Mac (Safari) : '), 'menu Fichier → « Ajouter au Dock ».'),
        h('li', {}, h('strong', {}, 'Mac (Chrome) : '), 'icône d’installation à droite de la barre d’adresse.')),
    h('p', { class: 'field-help' }, 'Une fois installée, l’app s’ouvre en plein écran, fonctionne hors ligne et peut recevoir des notifications.'));
}

export function vueReglages(racine) {
  const state = getState();
  const r = state.reglages;
  const setReglage = (modif) => update((s) => modif(s.reglages));

  const lignesHoraires = [1, 2, 3, 4, 5].map((j) => {
    const plage = r.horaires[j] || { debut: '', fin: '' };
    const maj = (champ) => (e) => setReglage((rg) => { rg.horaires[j] = { ...rg.horaires[j], [champ]: e.target.value }; });
    return h('div', { class: 'hours-row' },
      h('span', { class: 'hours-day', title: cap(JOURS[j]) }, cap(JOURS_COURTS[j])),
      h('input', { type: 'time', value: plage.debut, 'aria-label': `Début le ${JOURS[j]}`, onchange: maj('debut') }),
      h('span', { class: 'muted' }, '→'),
      h('input', { type: 'time', value: plage.fin, 'aria-label': `Fin le ${JOURS[j]}`, onchange: maj('fin') }));
  });

  racine.append(
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Mon Alternance'), h('h1', { class: 'page-title' }, 'Réglages'))),

    carteCompte(),
    carteEmploiDuTemps(state),
    carteNotifications(r, setReglage),
    carteInstallation(),

    carte('Apparence', 'sun',
      segmente('theme', [['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']], r.theme, (v) => setReglage((rg) => { rg.theme = v; }))),

    carte('Horaires en entreprise', 'briefcase',
      h('p', { class: 'card-text' }, 'Affichés les jours en entreprise. Ils serviront aussi à trouver tes créneaux de révision.'),
      h('div', { class: 'hours' }, lignesHoraires),
      h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => setReglage((rg) => { rg.horaires = structuredClone(REGLAGES_PAR_DEFAUT.horaires); }) }, ic('refresh'), `Revenir à ${formatTime('08:00')} – ${formatTime('17:00')}`)),

    carte('Calendrier', 'calendar',
      interrupteur('Je passe les épreuves de session 2 du S5', 'Mardi 30 et mercredi 31 mars 2027. Désactivé : ces jours s’affichent en entreprise.', r.passeSession2,
        (v) => setReglage((rg) => { rg.passeSession2 = v; })),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Lieu d’une séance quand NetYParéo ne le précise pas'),
        segmente('lieu', LIEUX.map((l) => [l, l]), r.lieuParDefaut, (v) => setReglage((rg) => { rg.lieuParDefaut = v; }))),
      h('p', { class: 'card-text muted' }, 'Tous les jours fériés légaux sont affichés, même en période entreprise.')),

    carte('Mes données', 'download',
      h('p', { class: 'card-text' }, cloud.modeLocal()
        ? 'Tes données restent dans ce navigateur. Exporte-les de temps en temps.'
        : 'Tes données sont dans ton compte et sur chacun de tes appareils. L’export sert de sauvegarde ; l’import permet de récupérer des données saisies dans un autre navigateur.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-soft', type: 'button', onclick: () => telecharger(`mon-alternance-${new Date().toISOString().slice(0, 10)}.json`, exporter()) }, ic('download'), 'Exporter'),
        h('button', { class: 'btn btn-soft', type: 'button', onclick: () => choisirFichier('.json,application/json', async (texte) => {
          if (!(await confirmer('Remplacer tes échéances, congés, corrections et réglages par ceux du fichier ?', { libelle: 'Remplacer', danger: true }))) return;
          try { importer(texte); toast('Données importées'); } catch (err) { toast(err.message); }
        }) }, ic('upload'), 'Importer'),
        h('button', { class: 'btn btn-ghost btn-danger-text', type: 'button', onclick: async () => {
          const message = cloud.modeLocal()
            ? 'Effacer toutes tes échéances, congés, corrections et réglages ? Cette action est définitive.'
            : 'Effacer toutes tes échéances, congés, corrections et réglages, sur tous tes appareils ? Cette action est définitive.';
          if (!(await confirmer(message, { libelle: 'Tout effacer', danger: true }))) return;
          reinitialiser();
          toast('Données effacées');
        } }, ic('trash'), 'Tout effacer'))));
}
