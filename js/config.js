// Connexion au projet Supabase. Ces deux valeurs sont publiques par conception :
// la sécurité repose sur la connexion et les règles RLS de la base, pas sur leur secret.
// Laisser vides pour utiliser l'app en mode local (V1, sans synchronisation).
export const SUPABASE_URL = 'https://unhkfqywlxwslwogctft.supabase.co';
export const SUPABASE_CLE_PUBLIQUE = 'sb_publishable_ixqYnJADW4gvKlTY1DHoHw_Zur8Yctc';

// Bibliothèque Supabase, version figée.
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
