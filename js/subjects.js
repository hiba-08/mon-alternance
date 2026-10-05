// Matières de l'emploi du temps NetYParéo (S1 2026-2027).
// « officiel » reprend l'intitulé exact de NetYParéo ; « court » sert dans les espaces réduits.
export const MATIERES = {
  'GI-MATH1': { ue: 'UE5.1', officiel: 'Mathématiques 1 : Analyse 1', court: 'Analyse 1', couleur: '#6366f1', icone: 'sigma' },
  'GI-MATH2': { ue: 'UE5.1', officiel: 'Mathématiques 2 - Calcul matriciel', court: 'Calcul matriciel', couleur: '#a855f7', icone: 'matrix' },
  'GI-PROG': { ue: 'UE5.1', officiel: 'Programmation', court: 'Programmation', couleur: '#3b82f6', icone: 'code' },
  'GI-MECA1': { ue: 'UE5.2', officiel: 'Mécanique du solide rigide, cinématique', court: 'Mécanique', couleur: '#f97316', icone: 'cog' },
  'GI-SDM1': { ue: 'UE5.2', officiel: 'Science des Matériaux : Métallurgie', court: 'Métallurgie', couleur: '#8b7765', icone: 'hexagon' },
  'GI-ELEC1': { ue: 'UE5.2', officiel: 'Electronique', court: 'Électronique', couleur: '#eab308', icone: 'zap' },
  'GI-AMEC': { ue: 'UE5.3', officiel: 'Analyse de Mecanismes', court: 'Analyse de mécanismes', couleur: '#ef4444', icone: 'wrench' },
  'GI-EESY': { ue: 'UE5.3', officiel: 'Empreinte environnementale des systèmes', court: 'Empreinte environnementale', couleur: '#22c55e', icone: 'leaf' },
  'GI-OGI': { ue: 'UE5.4', officiel: 'Organisation industrielle', court: 'Organisation industrielle', couleur: '#14b8a6', icone: 'factory' },
  'GI-ANGL1': { ue: 'UE5.5', officiel: 'Anglais', court: 'Anglais', couleur: '#0ea5e9', icone: 'globe' },
  'GI-COMM': { ue: 'UE5.5', officiel: 'Communication Professionnelle EACP', court: 'Communication pro', couleur: '#ec4899', icone: 'message' },
  'GI-CAPT': { ue: 'UE6.3', officiel: 'Capteurs', court: 'Capteurs', couleur: '#84cc16', icone: 'activity' },
};

// Choix possibles pour une échéance qui ne concerne pas une matière.
export const AUTRES_SUJETS = {
  entreprise: { court: 'Entreprise', officiel: 'Entreprise', couleur: '#2563eb', icone: 'briefcase' },
  autre: { court: 'Autre', officiel: 'Autre', couleur: '#64748b', icone: 'star' },
};

export const EVENEMENT = { court: 'Événement', couleur: '#94a3b8', icone: 'star' };

// « UE5.2 GI-MECA1 Mécanique du solide rigide, cinématique » → { ue, code, nom }
export function lireIntitule(intitule) {
  const m = intitule.match(/^(UE\d+(?:\.\d+)?)\s+(GI-[A-Z0-9]+)\s+(.+)$/);
  if (m) return { ue: m[1], code: m[2], nom: m[3] };
  return { ue: null, code: null, nom: intitule };
}

export function sujet(code) {
  return MATIERES[code] || AUTRES_SUJETS[code] || null;
}

export function listeSujets() {
  return [
    ...Object.entries(MATIERES).map(([code, m]) => ({ code, ...m })),
    ...Object.entries(AUTRES_SUJETS).map(([code, m]) => ({ code, ...m })),
  ];
}
