import { h, ic, segmente } from '../ui.js';
import * as cloud from '../cloud.js';

const etatVue = { onglet: 'connexion', message: null, erreur: null, occupe: false };

function zoneMessage() {
  if (etatVue.erreur) return h('p', { class: 'auth-msg is-error', role: 'alert' }, ic('alert'), etatVue.erreur);
  if (etatVue.message) return h('p', { class: 'auth-msg', role: 'status' }, ic('check'), etatVue.message);
  return null;
}

export function vueConnexion(racine) {
  const rerender = () => { racine.replaceChildren(); vueConnexion(racine); };
  const inscription = etatVue.onglet === 'inscription';

  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false' });
  const motDePasse = h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: inscription ? 'new-password' : 'current-password' });

  const agir = async (action) => {
    etatVue.erreur = null;
    etatVue.message = null;
    etatVue.occupe = true;
    rerender();
    try {
      await action();
    } catch (e) {
      etatVue.erreur = e.message;
    } finally {
      etatVue.occupe = false;
      rerender();
    }
  };

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Adresse e-mail'), email),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Mot de passe'), motDePasse,
      inscription && h('span', { class: 'field-help' }, 'Au moins 8 caractères. Ton trousseau iCloud peut en proposer un et le retenir.')),
    zoneMessage(),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: etatVue.occupe },
      etatVue.occupe ? 'Patiente…' : inscription ? 'Créer mon compte' : 'Se connecter'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const adresse = email.value.trim();
    const mdp = motDePasse.value;
    if (!adresse || !mdp) {
      etatVue.erreur = 'Renseigne ton adresse e-mail et ton mot de passe.';
      rerender();
      return;
    }
    if (inscription) {
      if (mdp.length < 8) {
        etatVue.erreur = 'Choisis un mot de passe d’au moins 8 caractères.';
        rerender();
        return;
      }
      agir(async () => {
        const { confirmationRequise } = await cloud.inscription(adresse, mdp);
        if (confirmationRequise) {
          etatVue.onglet = 'connexion';
          etatVue.message = 'Compte créé. Ouvre le lien reçu par e-mail pour confirmer ton adresse, puis connecte-toi.';
        }
      });
    } else {
      agir(() => cloud.connexion(adresse, mdp));
    }
  });

  const oublie = () => {
    const adresse = email.value.trim();
    if (!adresse) {
      etatVue.erreur = 'Saisis d’abord ton adresse e-mail, puis clique à nouveau sur « Mot de passe oublié ».';
      rerender();
      return;
    }
    agir(async () => {
      await cloud.motDePasseOublie(adresse);
      etatVue.message = 'Si un compte existe pour cette adresse, un e-mail vient d’être envoyé pour choisir un nouveau mot de passe.';
    });
  };

  racine.append(h('div', { class: 'auth' },
    h('div', { class: 'auth-card card' },
      h('img', { class: 'auth-logo', src: 'icons/icon.svg', alt: '', width: 64, height: 64 }),
      h('h1', { class: 'auth-title' }, 'Mon Alternance'),
      h('p', { class: 'auth-text' }, 'Tes cours, tes périodes école et entreprise, tes échéances et tes congés, synchronisés sur tous tes appareils.'),
      segmente('auth-onglet', [['connexion', 'Se connecter'], ['inscription', 'Créer mon compte']], etatVue.onglet, (v) => {
        etatVue.onglet = v;
        etatVue.erreur = null;
        etatVue.message = null;
        rerender();
      }),
      form,
      !inscription && h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: oublie }, 'Mot de passe oublié ?'),
      !navigator.onLine && h('p', { class: 'field-help' }, 'Tu es hors ligne : la connexion nécessite internet.'),
      cloud.estLocalhost() && h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => cloud.choisirModeLocal(true) }, 'Continuer sans compte (test local)'))));
}

export function vueNouveauMotDePasse(racine) {
  const rerender = () => { racine.replaceChildren(); vueNouveauMotDePasse(racine); };
  const mdp = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const confirmation = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nouveau mot de passe'), mdp),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Confirmation'), confirmation),
    zoneMessage(),
    h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: etatVue.occupe }, etatVue.occupe ? 'Patiente…' : 'Enregistrer'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    etatVue.erreur = null;
    if (mdp.value.length < 8) etatVue.erreur = 'Au moins 8 caractères.';
    else if (mdp.value !== confirmation.value) etatVue.erreur = 'Les deux mots de passe sont différents.';
    if (etatVue.erreur) { rerender(); return; }
    etatVue.occupe = true;
    rerender();
    try {
      await cloud.nouveauMotDePasse(mdp.value);
      etatVue.occupe = false;
      location.hash = '#/aujourdhui'; // l'app reprend la main une fois le mot de passe changé
    } catch (err) {
      etatVue.erreur = err.message;
      etatVue.occupe = false;
      rerender();
    }
  });
  racine.append(h('div', { class: 'auth' },
    h('div', { class: 'auth-card card' },
      h('img', { class: 'auth-logo', src: 'icons/icon.svg', alt: '', width: 64, height: 64 }),
      h('h1', { class: 'auth-title' }, 'Nouveau mot de passe'),
      form)));
}

