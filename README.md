# Mon Alternance

Application web installable (PWA) pour organiser une alternance : où je dois être chaque jour
(école, entreprise, congé, férié), mes cours, mon agenda de la semaine et du mois, mes échéances,
mes tâches et mes congés, synchronisés entre iPhone, iPad et Mac.

## Fonctionnement

- **Interface** : HTML, CSS et JavaScript sans étape de construction (modules ES), en français.
- **Données** : Supabase (Postgres + authentification + temps réel). Chaque table est protégée par RLS :
  un compte ne voit que ses propres données. Aucune donnée personnelle n'est stockée dans ce dépôt.
- **Synchronisation** : l'app travaille sur une copie locale (affichage immédiat, hors ligne possible).
  Les modifications sont envoyées dès que possible ; en cas de conflit, la plus récente l'emporte.
- **Emploi du temps** : la fonction `supabase/functions/synchro-netypareo` relit un flux iCalendar
  toutes les 3 heures et signale les cours ajoutés, déplacés ou annulés.
- **Notifications** : la fonction `supabase/functions/rappels` envoie, via Web Push, les rappels
  d'échéances, les notifications programmées sur les tâches et l'alerte de la veille d'un passage
  école ↔ entreprise.

## Structure

```
index.html, css/, sw.js, manifest.webmanifest   interface, installation, hors ligne, notifications
js/main.js        démarrage, navigation, accès (connexion)
js/cloud.js       Supabase : compte, synchronisation, emploi du temps, notifications push
js/calendar.js    statut de chaque jour (calendrier + jours fériés + congés + réglages)
js/courses.js     séances, corrections, lecture iCalendar
js/deadlines.js   échéances et rappels
js/tasks.js       tâches (listes École, Entreprise, Perso)
js/store.js       état local (localStorage)
js/views/         écrans (Aujourd'hui, Agenda, Échéances, Tâches…) et formulaires
supabase/         schéma SQL, tâches planifiées, fonctions Edge
tools/            extraction du calendrier PDF, génération des icônes
```

## Mise en place

1. Exécuter `supabase/schema.sql` dans l'éditeur SQL du projet Supabase.
2. Déployer les fonctions `synchro-netypareo` et `rappels` (vérification JWT désactivée : l'authentification
   est contrôlée dans le code avec `@supabase/server`).
3. Exécuter `supabase/planification.sql`.
4. Renseigner `js/config.js` (adresse du projet et clé publique, faites pour être visibles).
