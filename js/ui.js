import { icon } from './icons.js';

// Petit utilitaire de création de DOM. Les textes passent toujours par des nœuds texte
// (pas d'injection HTML) ; seule l'option « html » accepte du balisage, réservée aux icônes.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val);
        else el.style[p] = val;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function ic(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}

export function toast(message, { action, onAction, duree = 3500 } = {}) {
  const zone = document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, h('span', {}, message));
  if (action) {
    el.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { onAction?.(); el.remove(); } }, action));
  }
  zone.append(el);
  setTimeout(() => el.classList.add('toast-out'), duree);
  setTimeout(() => el.remove(), duree + 300);
}

// Feuille modale : glisse depuis le bas sur téléphone, fenêtre centrée sur ordinateur.
export function openSheet({ titre, sousTitre, corps, pied, onClose }) {
  let dlg;
  const fermer = () => { if (dlg.open) dlg.close(); };
  dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-titre' },
    h('div', { class: 'sheet-inner' },
      h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      h('header', { class: 'sheet-head' },
        h('div', { class: 'sheet-titles' },
          h('h2', { id: 'sheet-titre' }, titre),
          sousTitre && h('p', { class: 'sheet-sub' }, sousTitre)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: fermer }, ic('x'))),
      h('div', { class: 'sheet-body' }, corps),
      pied && h('footer', { class: 'sheet-foot' }, pied)));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) fermer(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  return { fermer, el: dlg };
}

export function confirmer(message, { libelle = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let reponse = false;
    const sheet = openSheet({
      titre: 'Confirmation',
      corps: h('p', { class: 'confirm-text' }, message),
      pied: [
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.fermer() }, 'Annuler'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { reponse = true; sheet.fermer(); } }, libelle),
      ],
      onClose: () => resolve(reponse),
    });
  });
}

export function sectionTitre(texte, extra) {
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, texte), extra || null);
}

export function vide(iconName, titre, texte, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, ic(iconName)),
    h('p', { class: 'empty-title' }, titre),
    texte && h('p', { class: 'empty-text' }, texte),
    action || null);
}

// Groupe de boutons radio présenté comme un sélecteur segmenté.
export function segmente(nom, options, valeur, onChange) {
  return h('div', { class: 'segmented', role: 'radiogroup' },
    options.map(([val, label]) => {
      const id = `${nom}-${val}`;
      return h('label', { class: 'segmented-item', for: id },
        h('input', { type: 'radio', name: nom, id, value: val, checked: val === valeur, onchange: () => onChange?.(val) }),
        h('span', {}, label));
    }));
}

export function champ(label, controle, aide) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    controle,
    aide && h('span', { class: 'field-help' }, aide));
}
