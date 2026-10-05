-- =============================================================================
-- Mon Alternance — base de données Supabase (V2)
-- À exécuter une fois dans l'éditeur SQL du projet. Le script peut être relancé :
-- il ne supprime rien et ne recrée que ce qui manque.
-- Toutes les tables sont protégées par RLS : chaque compte ne voit que ses données.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Horodatage serveur de la dernière écriture (sert de curseur de synchronisation).
create or replace function public.horodater_synchro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synchro_le := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Éléments personnels synchronisés entre appareils
--    (échéances, congés, réglages, corrections de cours, examens ignorés)
-- -----------------------------------------------------------------------------
create table if not exists public.elements (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  collection text not null,
  donnees jsonb not null default '{}'::jsonb,
  supprime boolean not null default false,
  modifie_le timestamptz not null default now(), -- heure de la modification sur l'appareil
  synchro_le timestamptz not null default now(), -- heure de réception par le serveur
  primary key (user_id, id)
);
create index if not exists elements_par_synchro on public.elements (user_id, synchro_le);
drop trigger if exists elements_synchro on public.elements;
create trigger elements_synchro before insert or update on public.elements
  for each row execute function public.horodater_synchro();

alter table public.elements enable row level security;
drop policy if exists "elements : lecture" on public.elements;
create policy "elements : lecture" on public.elements for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "elements : ajout" on public.elements;
create policy "elements : ajout" on public.elements for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "elements : modification" on public.elements;
create policy "elements : modification" on public.elements for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Envoi groupé : une modification plus ancienne n'écrase jamais une plus récente.
create or replace function public.pousser_elements(lignes jsonb)
returns setof public.elements
language sql
security invoker
set search_path = ''
as $$
  insert into public.elements as e (user_id, id, collection, donnees, supprime, modifie_le)
  select (select auth.uid()), l->>'id', l->>'collection', coalesce(l->'donnees', '{}'::jsonb),
         coalesce((l->>'supprime')::boolean, false), (l->>'modifie_le')::timestamptz
  from jsonb_array_elements(lignes) as l
  on conflict (user_id, id) do update
    set collection = excluded.collection,
        donnees = excluded.donnees,
        supprime = excluded.supprime,
        modifie_le = excluded.modifie_le
    where e.modifie_le <= excluded.modifie_le
  returning e.*;
$$;
revoke execute on function public.pousser_elements(jsonb) from public, anon;
grant execute on function public.pousser_elements(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Séances de l'emploi du temps (mises à jour par la fonction synchro-netypareo)
-- -----------------------------------------------------------------------------
create table if not exists public.seances (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  uid text not null,
  date date not null,
  debut text not null, -- « HH:MM », heure de Paris
  fin text not null,
  intitule text not null,
  enseignant text,
  salle text,
  groupes text,
  lieu text, -- « SUPMECA » quand la page web de NetYParéo l'indique
  mentions text[] not null default '{}',
  annulee boolean not null default false, -- disparue du flux iCalendar
  source text not null default 'ical',
  vu_le timestamptz not null default now(),
  synchro_le timestamptz not null default now(),
  primary key (user_id, uid)
);
drop trigger if exists seances_synchro on public.seances;
create trigger seances_synchro before insert or update on public.seances
  for each row execute function public.horodater_synchro();

alter table public.seances enable row level security;
drop policy if exists "seances : lecture" on public.seances;
create policy "seances : lecture" on public.seances for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "seances : ajout" on public.seances;
create policy "seances : ajout" on public.seances for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "seances : modification" on public.seances;
create policy "seances : modification" on public.seances for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 3. Documents de référence (calendrier de l'alternance extrait du PDF)
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cle text not null,
  donnees jsonb not null,
  modifie_le timestamptz not null default now(),
  primary key (user_id, cle)
);
alter table public.documents enable row level security;
drop policy if exists "documents : lecture" on public.documents;
create policy "documents : lecture" on public.documents for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "documents : ajout" on public.documents;
create policy "documents : ajout" on public.documents for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "documents : modification" on public.documents;
create policy "documents : modification" on public.documents for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 4. Lien iCalendar NetYParéo : l'app peut l'enregistrer mais jamais le relire.
--    Seul le serveur (fonction synchro-netypareo) y a accès.
-- -----------------------------------------------------------------------------
create table if not exists public.liens_prives (
  user_id uuid primary key references auth.users (id) on delete cascade,
  netypareo_ical text not null,
  modifie_le timestamptz not null default now()
);
alter table public.liens_prives enable row level security; -- aucune politique : invisible depuis l'app

create or replace function public.enregistrer_lien_netypareo(lien text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise';
  end if;
  if lien is null or lien !~ '^https://netpareo\.mecavenir\.com/index\.php/planning/ical/[A-Za-z0-9_-]+/?$' then
    raise exception 'Ce n''est pas un lien iCalendar NetYParéo';
  end if;
  insert into public.liens_prives (user_id, netypareo_ical, modifie_le)
  values ((select auth.uid()), lien, now())
  on conflict (user_id) do update set netypareo_ical = excluded.netypareo_ical, modifie_le = now();
  return true;
end;
$$;

create or replace function public.lien_netypareo_configure()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select modifie_le from public.liens_prives where user_id = (select auth.uid());
$$;

revoke execute on function public.enregistrer_lien_netypareo(text) from public, anon;
revoke execute on function public.lien_netypareo_configure() from public, anon;
grant execute on function public.enregistrer_lien_netypareo(text) to authenticated;
grant execute on function public.lien_netypareo_configure() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Journal des mises à jour de l'emploi du temps
-- -----------------------------------------------------------------------------
create table if not exists public.synchros (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  lancee_le timestamptz not null default now(),
  declencheur text not null, -- « planifiée » ou « manuelle »
  statut text not null, -- « ok » ou « erreur »
  nb_seances integer,
  ajouts integer,
  modifications integer,
  annulations integer,
  message text
);
create index if not exists synchros_par_date on public.synchros (user_id, lancee_le desc);
alter table public.synchros enable row level security;
drop policy if exists "synchros : lecture" on public.synchros;
create policy "synchros : lecture" on public.synchros for select to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 6. Notifications push : abonnements des appareils, file d'envoi, clés du serveur
-- -----------------------------------------------------------------------------
create table if not exists public.abonnements_push (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cles jsonb not null, -- { p256dh, auth }
  appareil text,
  cree_le timestamptz not null default now(),
  dernier_envoi timestamptz
);
alter table public.abonnements_push enable row level security;
drop policy if exists "push : lecture" on public.abonnements_push;
create policy "push : lecture" on public.abonnements_push for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "push : ajout" on public.abonnements_push;
create policy "push : ajout" on public.abonnements_push for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "push : modification" on public.abonnements_push;
create policy "push : modification" on public.abonnements_push for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "push : suppression" on public.abonnements_push;
create policy "push : suppression" on public.abonnements_push for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  cle text not null unique, -- évite d'envoyer deux fois la même notification
  titre text not null,
  texte text not null,
  url text,
  cree_le timestamptz not null default now(),
  envoyee_le timestamptz,
  essais integer not null default 0
);
create index if not exists notifications_en_attente on public.notifications (envoyee_le) where envoyee_le is null;
alter table public.notifications enable row level security;
drop policy if exists "notifications : lecture" on public.notifications;
create policy "notifications : lecture" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.cles_serveur (
  nom text primary key,
  valeur jsonb not null,
  cree_le timestamptz not null default now()
);
alter table public.cles_serveur enable row level security; -- aucune politique : serveur uniquement

-- -----------------------------------------------------------------------------
-- 7. Temps réel : les autres appareils sont prévenus immédiatement des changements
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'elements') then
    alter publication supabase_realtime add table public.elements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'seances') then
    alter publication supabase_realtime add table public.seances;
  end if;
end;
$$;
