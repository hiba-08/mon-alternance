-- =============================================================================
-- Mon Alternance — tâches planifiées (à exécuter après le déploiement des fonctions)
-- La clé utilisée est la clé publique (« publishable ») : elle est faite pour être visible.
-- Le script peut être relancé : il remplace les tâches existantes du même nom.
-- =============================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('https://unhkfqywlxwslwogctft.supabase.co', 'project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'publishable_key') then
    perform vault.create_secret('sb_publishable_ixqYnJADW4gvKlTY1DHoHw_Zur8Yctc', 'publishable_key');
  end if;
end;
$$;

-- Emploi du temps : toutes les 3 heures (à la 7e minute)
select cron.schedule(
  'mon-alternance-synchro',
  '7 */3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/synchro-netypareo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Notifications : toutes les 15 minutes
select cron.schedule(
  'mon-alternance-notifications',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/rappels',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
