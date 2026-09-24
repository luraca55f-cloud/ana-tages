-- TAGES CONSULTORIA ANNA - schema consolidado e endurecido (v1.2.1)
-- Projeto novo ou primeira execução interrompida: este arquivo pode ser executado novamente.
-- Segurança: RLS por usuário, MFA AAL2 para todo o painel, concessão clínica por TOTP recente,
-- isolamento relacional por owner_id, trilha de auditoria, sem delete físico de prontuários/pacientes,
-- uploads privados e limitados.

create extension if not exists pgcrypto;

-- =========================================================
-- Helpers de segurança
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.require_same_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id não pode ser alterado' using errcode = '42501';
  end if;
  if new.owner_id is distinct from auth.uid() then
    raise exception 'owner_id inválido' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.has_aal2()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.current_session_id()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(auth.jwt() ->> 'session_id', '');
$$;

create or replace function public.latest_totp_timestamp()
returns bigint
language sql
stable
set search_path = pg_catalog
as $$
  select max((entry ->> 'timestamp')::bigint)
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as entry
  where entry ->> 'method' = 'totp';
$$;

-- =========================================================
-- Tabelas principais
-- =========================================================

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  active boolean not null default true,
  billing_model text not null default 'session' check (billing_model in ('session','package')),
  package_amount numeric(12,2) check (package_amount is null or (package_amount > 0 and package_amount <= 1000000)),
  package_timing text check (package_timing in ('current_month','next_month')),
  billing_day smallint check (billing_day between 1 and 28),
  notes_admin text check (notes_admin is null or char_length(notes_admin) <= 4000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_id_owner_unique unique (id, owner_id),
  constraint patients_request_unique unique (owner_id, client_request_id),
  constraint patients_package_fields check (
    billing_model = 'session'
    or (package_amount is not null and package_timing is not null and billing_day is not null)
  )
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  patient_id uuid,
  patient_name text check (patient_name is null or char_length(patient_name) <= 160),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 50 check (duration_minutes between 10 and 240),
  modality text not null default 'presential' check (modality in ('presential','online')),
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  service_kind text not null default 'session' check (service_kind in ('session','psychological_test','neuropsychology','company','other')),
  amount numeric(12,2) not null default 0 check (amount between 0 and 1000000),
  notes_admin text check (notes_admin is null or char_length(notes_admin) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_id_owner_unique unique (id, owner_id),
  constraint appointments_request_unique unique (owner_id, client_request_id),
  constraint appointments_patient_owner_fk foreign key (patient_id, owner_id)
    references public.patients(id, owner_id) on delete restrict
);

-- O conteúdo clínico é cifrado no navegador. Não existe DELETE físico pelo usuário.
create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  patient_id uuid not null,
  appointment_id uuid,
  note_date date not null default current_date,
  title text not null default 'Evolução' check (title = 'Evolução'),
  content_ciphertext text not null check (char_length(content_ciphertext) between 16 and 500000),
  content_iv text not null check (char_length(content_iv) between 8 and 128),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_notes_id_owner_unique unique (id, owner_id),
  constraint clinical_notes_request_unique unique (owner_id, client_request_id),
  constraint clinical_notes_patient_owner_fk foreign key (patient_id, owner_id)
    references public.patients(id, owner_id) on delete restrict,
  constraint clinical_notes_appointment_owner_fk foreign key (appointment_id, owner_id)
    references public.appointments(id, owner_id) on delete restrict
);

create table if not exists public.billing_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  patient_id uuid,
  appointment_id uuid,
  source_type text not null check (source_type in ('session','package','company','psychological_test','neuropsychology','other')),
  client_name text not null check (char_length(trim(client_name)) between 1 and 160),
  description text not null check (char_length(trim(description)) between 1 and 500),
  competence_date date not null,
  issued_at date not null default current_date,
  due_date date,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  status text not null default 'pending' check (status in ('pending','partial','paid','cancelled')),
  received_amount numeric(12,2) not null default 0 check (received_amount >= 0),
  received_at date,
  payment_method text check (payment_method is null or char_length(payment_method) <= 80),
  notes text check (notes is null or char_length(notes) <= 4000),
  auto_key text check (auto_key is null or char_length(auto_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_id_owner_unique unique (id, owner_id),
  constraint billing_request_unique unique (owner_id, client_request_id),
  constraint billing_received_not_above_amount check (received_amount <= amount),
  constraint billing_status_consistency check (
    (status = 'pending' and received_amount = 0 and received_at is null)
    or (status = 'partial' and received_amount > 0 and received_amount < amount and received_at is not null)
    or (status = 'paid' and received_amount = amount and received_at is not null)
    or (status = 'cancelled' and received_amount = 0)
  ),
  constraint billing_patient_owner_fk foreign key (patient_id, owner_id)
    references public.patients(id, owner_id) on delete restrict,
  constraint billing_appointment_owner_fk foreign key (appointment_id, owner_id)
    references public.appointments(id, owner_id) on delete restrict,
  unique (owner_id, auto_key)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  category text not null check (category in ('transporte','contador_inss','aluguel','condominio','faxina','internet','outros_fixos','outros')),
  description text not null check (char_length(trim(description)) between 1 and 500),
  competence_date date not null,
  due_date date,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  recurrence text not null default 'variable' check (recurrence in ('fixed','variable')),
  status text not null default 'paid' check (status in ('pending','paid')),
  paid_at date,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_id_owner_unique unique (id, owner_id),
  constraint expenses_request_unique unique (owner_id, client_request_id),
  constraint expenses_paid_consistency check (
    (status = 'paid' and paid_at is not null)
    or (status = 'pending' and paid_at is null)
  )
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  client_request_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 180),
  category text check (category is null or char_length(category) <= 100),
  file_path text,
  file_type text check (file_type is null or file_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint materials_id_owner_unique unique (id, owner_id),
  constraint materials_request_unique unique (owner_id, client_request_id),
  constraint materials_path_owner check (file_path is null or file_path like owner_id::text || '/%')
);

create table if not exists public.app_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete restrict,
  professional_name text not null default 'Anna Karina Dias' check (char_length(professional_name) between 2 and 160),
  crp text check (crp is null or char_length(crp) <= 40),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  vault_salt text check (vault_salt is null or char_length(vault_salt) <= 256),
  vault_verifier_ciphertext text check (vault_verifier_ciphertext is null or char_length(vault_verifier_ciphertext) <= 4096),
  vault_verifier_iv text check (vault_verifier_iv is null or char_length(vault_verifier_iv) <= 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Concessões efêmeras de acesso a um único prontuário após TOTP recente.
create table if not exists public.clinical_access_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  session_id text not null,
  totp_timestamp bigint not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint clinical_grant_patient_owner_fk foreign key (patient_id, owner_id)
    references public.patients(id, owner_id) on delete cascade,
  constraint clinical_grant_one_per_totp unique (owner_id, session_id, totp_timestamp)
);

-- Trilha de auditoria sem armazenar payloads, prontuários ou valores sensíveis.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  occurred_at timestamptz not null default now()
);

-- =========================================================
-- Índices
-- =========================================================

create index if not exists patients_owner_idx on public.patients(owner_id, archived_at);
create index if not exists appointments_owner_date_idx on public.appointments(owner_id, scheduled_at);
create index if not exists appointments_owner_patient_idx on public.appointments(owner_id, patient_id);
create unique index if not exists appointments_open_slot_unique
  on public.appointments(owner_id, scheduled_at)
  where status in ('scheduled','confirmed');

-- Impede duas reservas ativas que se sobreponham, inclusive em requisições simultâneas.
-- Usa advisory lock por proprietário + trigger. Isso evita a limitação do PostgreSQL que
-- exige expressões IMMUTABLE em índices/constraints de exclusão envolvendo timestamptz.
create or replace function public.prevent_appointment_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status not in ('scheduled','confirmed') then
    return new;
  end if;

  -- Serializa alterações da agenda do mesmo proprietário para fechar race conditions.
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 20260923));

  if exists (
    select 1
    from public.appointments a
    where a.owner_id = new.owner_id
      and a.status in ('scheduled','confirmed')
      and (tg_op <> 'UPDATE' or a.id <> new.id)
      and a.scheduled_at < new.scheduled_at + make_interval(mins => new.duration_minutes)
      and new.scheduled_at < a.scheduled_at + make_interval(mins => a.duration_minutes)
  ) then
    raise exception 'Já existe um atendimento ativo sobrepondo este horário'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_prevent_overlap on public.appointments;
create trigger appointments_prevent_overlap
before insert or update of owner_id, scheduled_at, duration_minutes, status
on public.appointments
for each row execute function public.prevent_appointment_overlap();
create index if not exists clinical_notes_owner_patient_idx on public.clinical_notes(owner_id, patient_id, archived_at, note_date desc);
create index if not exists billing_owner_competence_idx on public.billing_entries(owner_id, competence_date);
create index if not exists billing_owner_received_idx on public.billing_entries(owner_id, received_at);
create index if not exists billing_owner_status_idx on public.billing_entries(owner_id, status);
create index if not exists expenses_owner_competence_idx on public.expenses(owner_id, competence_date);
create index if not exists materials_owner_created_idx on public.materials(owner_id, created_at desc);
create index if not exists clinical_grants_lookup_idx on public.clinical_access_grants(owner_id, patient_id, session_id, expires_at);
create index if not exists audit_owner_date_idx on public.audit_log(owner_id, occurred_at desc);

-- =========================================================
-- Triggers de integridade e auditoria
-- =========================================================

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_record uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_id;
    v_record := old.id;
  else
    v_owner := new.owner_id;
    v_record := new.id;
  end if;

  insert into public.audit_log(owner_id, actor_id, table_name, record_id, action)
  values (v_owner, auth.uid(), tg_table_name, v_record, tg_op);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Billing automático por atendimento é mantido no banco, não no navegador.
create or replace function public.sync_appointment_billing()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auto_key text := 'session:' || new.id::text;
  v_patient_billing text;
  v_competence date := (new.scheduled_at at time zone 'America/Sao_Paulo')::date;
begin
  if new.patient_id is not null and new.service_kind = 'session' then
    select billing_model into v_patient_billing
    from public.patients
    where id = new.patient_id and owner_id = new.owner_id;
  end if;

  if new.status <> 'completed' or new.amount <= 0 or v_patient_billing = 'package' then
    update public.billing_entries
      set status = 'cancelled', updated_at = now()
      where owner_id = new.owner_id and auto_key = v_auto_key and status <> 'paid';
    return new;
  end if;

  insert into public.billing_entries(
    owner_id, patient_id, appointment_id, source_type, client_name, description,
    competence_date, issued_at, due_date, amount, status, received_amount, auto_key
  ) values (
    new.owner_id, new.patient_id, new.id,
    case when new.service_kind = 'session' then 'session' else new.service_kind end,
    coalesce(nullif(trim(new.patient_name), ''), 'Atendimento'),
    case when new.service_kind = 'session' then 'Sessão realizada' else 'Serviço realizado' end,
    v_competence, v_competence, v_competence, new.amount, 'pending', 0, v_auto_key
  )
  on conflict (owner_id, auto_key) do update set
    patient_id = case when public.billing_entries.status = 'paid' then public.billing_entries.patient_id else excluded.patient_id end,
    appointment_id = case when public.billing_entries.status = 'paid' then public.billing_entries.appointment_id else excluded.appointment_id end,
    source_type = case when public.billing_entries.status = 'paid' then public.billing_entries.source_type else excluded.source_type end,
    client_name = case when public.billing_entries.status = 'paid' then public.billing_entries.client_name else excluded.client_name end,
    description = case when public.billing_entries.status = 'paid' then public.billing_entries.description else excluded.description end,
    competence_date = case when public.billing_entries.status = 'paid' then public.billing_entries.competence_date else excluded.competence_date end,
    issued_at = case when public.billing_entries.status = 'paid' then public.billing_entries.issued_at else excluded.issued_at end,
    due_date = case when public.billing_entries.status = 'paid' then public.billing_entries.due_date else excluded.due_date end,
    amount = case when public.billing_entries.status = 'paid' then public.billing_entries.amount else excluded.amount end,
    status = case when public.billing_entries.status = 'paid' then 'paid' else 'pending' end,
    updated_at = now();

  return new;
end;
$$;

-- Gera pacotes de forma idempotente no banco.
create or replace function public.generate_package_billings(p_month date)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  p record;
  v_billing_month date;
  v_due date;
  v_key text;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  p_month := date_trunc('month', p_month)::date;

  for p in
    select id, full_name, package_amount, package_timing, billing_day, created_at
    from public.patients
    where owner_id = v_uid
      and archived_at is null
      and active = true
      and billing_model = 'package'
      and package_amount is not null
      and date_trunc('month', created_at)::date <= p_month
  loop
    v_key := 'package:' || p.id::text || ':' || to_char(p_month, 'YYYY-MM');
    v_billing_month := case when p.package_timing = 'next_month' then (p_month + interval '1 month')::date else p_month end;
    v_due := make_date(extract(year from v_billing_month)::int, extract(month from v_billing_month)::int, greatest(1, least(28, coalesce(p.billing_day, 5))));

    insert into public.billing_entries(
      owner_id, patient_id, source_type, client_name, description, competence_date,
      issued_at, due_date, amount, status, received_amount, auto_key
    ) values (
      v_uid, p.id, 'package', p.full_name,
      'Pacote de sessões — ' || to_char(p_month, 'YYYY-MM'),
      p_month, v_due, v_due, p.package_amount, 'pending', 0, v_key
    ) on conflict (owner_id, auto_key) do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

create or replace function public.create_manual_revenue(
  p_source_type text,
  p_client_name text,
  p_description text,
  p_competence_date date,
  p_issued_at date,
  p_due_date date,
  p_amount numeric,
  p_paid boolean,
  p_client_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'Identificador idempotente obrigatório' using errcode = '22023';
  end if;
  if p_source_type not in ('session','package','company','psychological_test','neuropsychology','other') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_client_name, ''))) not between 1 and 160
     or char_length(trim(coalesce(p_description, ''))) not between 1 and 500 then
    raise exception 'Dados inválidos' using errcode = '22023';
  end if;

  insert into public.billing_entries(
    owner_id, client_request_id, source_type, client_name, description, competence_date, issued_at,
    due_date, amount, status, received_amount, received_at, auto_key
  ) values (
    v_uid, p_client_request_id, p_source_type, trim(p_client_name), trim(p_description), p_competence_date,
    p_issued_at, p_due_date, round(p_amount, 2),
    case when p_paid then 'paid' else 'pending' end,
    case when p_paid then round(p_amount, 2) else 0 end,
    case when p_paid then p_issued_at else null end,
    null
  )
  on conflict (owner_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_expense(
  p_category text,
  p_description text,
  p_competence_date date,
  p_due_date date,
  p_amount numeric,
  p_recurrence text,
  p_paid boolean,
  p_client_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'Identificador idempotente obrigatório' using errcode = '22023';
  end if;
  if p_category not in ('transporte','contador_inss','aluguel','condominio','faxina','internet','outros_fixos','outros') then
    raise exception 'Categoria inválida' using errcode = '22023';
  end if;
  if p_recurrence not in ('fixed','variable') then
    raise exception 'Recorrência inválida' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 1 and 500 then
    raise exception 'Descrição inválida' using errcode = '22023';
  end if;

  insert into public.expenses(
    owner_id, client_request_id, category, description, competence_date, due_date,
    amount, recurrence, status, paid_at
  ) values (
    v_uid, p_client_request_id, p_category, trim(p_description), p_competence_date, p_due_date,
    round(p_amount, 2), p_recurrence,
    case when p_paid then 'paid' else 'pending' end,
    case when p_paid then (now() at time zone 'America/Sao_Paulo')::date else null end
  )
  on conflict (owner_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_expense_paid(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  update public.expenses
  set status = 'paid', paid_at = (now() at time zone 'America/Sao_Paulo')::date, updated_at = now()
  where id = p_id and owner_id = v_uid and status = 'pending';
  if not found then raise exception 'Despesa não encontrada ou já finalizada'; end if;
end;
$$;

create or replace function public.mark_billing_paid(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  update public.billing_entries
  set status = 'paid', received_amount = amount, received_at = (now() at time zone 'America/Sao_Paulo')::date, updated_at = now()
  where id = p_id and owner_id = v_uid and status in ('pending','partial');
  if not found then raise exception 'Lançamento não encontrado ou já finalizado'; end if;
end;
$$;

create or replace function public.archive_patient(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  update public.patients
  set active = false, archived_at = now(), updated_at = now()
  where id = p_id and owner_id = v_uid and archived_at is null;
  if not found then raise exception 'Paciente não encontrado'; end if;
end;
$$;

create or replace function public.archive_clinical_note(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_patient uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  select patient_id into v_patient from public.clinical_notes where id = p_id and owner_id = v_uid;
  if v_patient is null or not public.has_clinical_access(v_patient) then
    raise exception 'Acesso clínico expirado ou inválido' using errcode = '42501';
  end if;
  update public.clinical_notes
  set archived_at = now(), updated_at = now()
  where id = p_id and owner_id = v_uid and archived_at is null;
end;
$$;

-- =========================================================
-- Step-up clínico: um TOTP recente concede acesso temporário a UM paciente
-- =========================================================

create or replace function public.has_clinical_access(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.clinical_access_grants g
    where g.owner_id = auth.uid()
      and g.patient_id = p_patient_id
      and g.session_id = public.current_session_id()
      and g.revoked_at is null
      and g.expires_at > now()
  );
$$;

create or replace function public.grant_clinical_access(p_patient_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := public.current_session_id();
  v_totp bigint := public.latest_totp_timestamp();
  v_exp timestamptz := now() + interval '30 minutes';
begin
  if v_uid is null or v_session is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if v_totp is null or v_totp < extract(epoch from now() - interval '90 seconds')::bigint then
    raise exception 'Confirme um novo código TOTP antes de abrir o prontuário' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.patients
    where id = p_patient_id and owner_id = v_uid and archived_at is null
  ) then
    raise exception 'Paciente inválido' using errcode = '42501';
  end if;

  -- Ao abrir um prontuário, qualquer concessão anterior da sessão é revogada, mas
  -- o registro é preservado para impedir reutilização do mesmo evento TOTP.
  update public.clinical_access_grants
  set revoked_at = now()
  where owner_id = v_uid and session_id = v_session and revoked_at is null;

  insert into public.clinical_access_grants(owner_id, patient_id, session_id, totp_timestamp, expires_at, revoked_at)
  values (v_uid, p_patient_id, v_session, v_totp, v_exp, null);

  return v_exp;
exception
  when unique_violation then
    raise exception 'Este desafio TOTP já foi usado para abrir um prontuário. Aguarde um novo código.' using errcode = '42501';
end;
$$;

create or replace function public.revoke_clinical_access(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.clinical_access_grants
  set revoked_at = now()
  where owner_id = auth.uid()
    and patient_id = p_patient_id
    and session_id = public.current_session_id()
    and revoked_at is null;
end;
$$;

create or replace function public.require_clinical_appointment_patient()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = new.appointment_id
      and a.owner_id = new.owner_id
      and a.patient_id = new.patient_id
  ) then
    raise exception 'Atendimento não corresponde ao paciente do prontuário' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- =========================================================
-- Triggers
-- =========================================================

do $$
declare
  t text;
begin
  foreach t in array array['patients','appointments','clinical_notes','billing_entries','expenses','materials','app_settings']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_owner_guard on public.%I', t, t);
    execute format('create trigger %I_owner_guard before insert or update on public.%I for each row execute function public.require_same_owner()', t, t);
  end loop;
end $$;

drop trigger if exists clinical_notes_appointment_patient_guard on public.clinical_notes;
create trigger clinical_notes_appointment_patient_guard
before insert or update of appointment_id, patient_id, owner_id on public.clinical_notes
for each row execute function public.require_clinical_appointment_patient();

-- app_settings não possui coluna id; guard próprio.
drop trigger if exists app_settings_owner_guard on public.app_settings;
create trigger app_settings_owner_guard
before insert or update on public.app_settings
for each row execute function public.require_same_owner();

-- Auditoria nas tabelas mutáveis (sem payload).
do $$
declare
  t text;
begin
  foreach t in array array['patients','appointments','clinical_notes','billing_entries','expenses','materials']
  loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

-- app_settings não possui id; usa trigger separado sem record_id.
create or replace function public.audit_settings_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if tg_op = 'DELETE' then
    v_owner := old.owner_id;
  else
    v_owner := new.owner_id;
  end if;

  insert into public.audit_log(owner_id, actor_id, table_name, record_id, action)
  values (v_owner, auth.uid(), 'app_settings', null, tg_op);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists app_settings_audit on public.app_settings;
create trigger app_settings_audit after insert or update or delete on public.app_settings
for each row execute function public.audit_settings_change();

-- Trigger automático para faturamento de atendimentos.
drop trigger if exists appointments_sync_billing on public.appointments;
create trigger appointments_sync_billing
after insert or update of patient_id, patient_name, scheduled_at, status, service_kind, amount on public.appointments
for each row execute function public.sync_appointment_billing();

-- =========================================================
-- RLS e privilégios
-- =========================================================

alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.billing_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.materials enable row level security;
alter table public.app_settings enable row level security;
alter table public.clinical_access_grants enable row level security;
alter table public.audit_log enable row level security;

-- Endurece SECURITY DEFINER: papéis não confiáveis não podem criar objetos no schema public.
revoke create on schema public from public;

-- Consultas do frontend usam paginação/limites. Não altera parâmetros globais do papel
-- `authenticated`, evitando incompatibilidade de permissão em ambiente gerenciado.

-- Remove privilégios padrão do schema público e reabre somente o mínimo necessário.
revoke all on public.patients, public.appointments, public.clinical_notes, public.billing_entries,
  public.expenses, public.materials, public.app_settings, public.clinical_access_grants, public.audit_log
  from public, anon, authenticated;

-- Autenticado + MFA é pré-requisito; RLS ainda isola o dono.
grant select on public.patients to authenticated;
grant insert (client_request_id, full_name, phone, email, active, billing_model, package_amount, package_timing, billing_day, notes_admin) on public.patients to authenticated;
grant update (full_name, phone, email, active, billing_model, package_amount, package_timing, billing_day, notes_admin) on public.patients to authenticated;

grant select on public.appointments to authenticated;
grant insert (client_request_id, patient_id, patient_name, scheduled_at, duration_minutes, modality, status, service_kind, amount, notes_admin) on public.appointments to authenticated;
grant update (patient_id, patient_name, scheduled_at, duration_minutes, modality, status, service_kind, amount, notes_admin) on public.appointments to authenticated;

-- Prontuário é append-only para o cliente: inserção + leitura; arquivamento somente por RPC.
grant select on public.clinical_notes to authenticated;
grant insert (client_request_id, patient_id, appointment_id, note_date, title, content_ciphertext, content_iv) on public.clinical_notes to authenticated;

grant select on public.billing_entries to authenticated;
grant select on public.expenses to authenticated;

grant select, delete on public.materials to authenticated;
grant insert (client_request_id, title, category, file_path, file_type, notes) on public.materials to authenticated;
grant update (title, category, notes) on public.materials to authenticated;

grant select on public.app_settings to authenticated;
grant insert (owner_id, professional_name, crp, phone, email, vault_salt, vault_verifier_ciphertext, vault_verifier_iv) on public.app_settings to authenticated;
grant update (professional_name, crp, phone, email, vault_salt, vault_verifier_ciphertext, vault_verifier_iv) on public.app_settings to authenticated;
grant select on public.audit_log to authenticated;
revoke all on public.clinical_access_grants from authenticated;


-- Barreiras restritivas: continuam valendo mesmo se uma policy permissiva for adicionada no futuro.
do $$
declare
  t text;
begin
  foreach t in array array['patients','appointments','clinical_notes','billing_entries','expenses','materials','app_settings','audit_log']
  loop
    execute format('drop policy if exists %I_mfa_boundary on public.%I', t, t);
    execute format(
      'create policy %I_mfa_boundary on public.%I as restrictive for all to authenticated using (public.has_aal2()) with check (public.has_aal2())',
      t, t
    );
    execute format('drop policy if exists %I_owner_boundary on public.%I', t, t);
    execute format(
      'create policy %I_owner_boundary on public.%I as restrictive for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t, t
    );
  end loop;
end $$;

-- Step-up clínico também é uma barreira restritiva; uma policy futura não consegue contorná-la.
drop policy if exists clinical_notes_step_up_boundary on public.clinical_notes;
create policy clinical_notes_step_up_boundary on public.clinical_notes
as restrictive for all to authenticated
using (public.has_clinical_access(patient_id))
with check (public.has_clinical_access(patient_id));

-- Políticas por operação. Não existe policy DELETE para pacientes, prontuários, billing, despesas ou settings.
do $$
declare
  t text;
begin
  foreach t in array array['patients','appointments','billing_entries','expenses','materials','app_settings']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('drop policy if exists owner_all on public.%I', t);
  end loop;
end $$;

create policy patients_select on public.patients for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
create policy patients_insert on public.patients for insert to authenticated
  with check (owner_id = auth.uid() and public.has_aal2());
create policy patients_update on public.patients for update to authenticated
  using (owner_id = auth.uid() and public.has_aal2())
  with check (owner_id = auth.uid() and public.has_aal2());

create policy appointments_select on public.appointments for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
create policy appointments_insert on public.appointments for insert to authenticated
  with check (owner_id = auth.uid() and public.has_aal2());
create policy appointments_update on public.appointments for update to authenticated
  using (owner_id = auth.uid() and public.has_aal2())
  with check (owner_id = auth.uid() and public.has_aal2());

-- Prontuário: além de AAL2, requer concessão clínica específica do paciente.
drop policy if exists clinical_notes_select on public.clinical_notes;
drop policy if exists clinical_notes_insert on public.clinical_notes;
drop policy if exists clinical_notes_update on public.clinical_notes;
drop policy if exists owner_all on public.clinical_notes;
create policy clinical_notes_select on public.clinical_notes for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2() and public.has_clinical_access(patient_id));
create policy clinical_notes_insert on public.clinical_notes for insert to authenticated
  with check (owner_id = auth.uid() and public.has_aal2() and public.has_clinical_access(patient_id));

create policy billing_select on public.billing_entries for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
-- INSERT/UPDATE diretos não são concedidos; lançamentos e baixas passam por RPC/trigger.

create policy expenses_select on public.expenses for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
-- INSERT/UPDATE diretos de despesas não são concedidos; criação/baixa passam por RPC.

create policy materials_select on public.materials for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
create policy materials_insert on public.materials for insert to authenticated
  with check (owner_id = auth.uid() and public.has_aal2());
create policy materials_update on public.materials for update to authenticated
  using (owner_id = auth.uid() and public.has_aal2())
  with check (owner_id = auth.uid() and public.has_aal2());
create policy materials_delete on public.materials for delete to authenticated
  using (owner_id = auth.uid() and public.has_aal2());

create policy settings_select on public.app_settings for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());
create policy settings_insert on public.app_settings for insert to authenticated
  with check (owner_id = auth.uid() and public.has_aal2());
create policy settings_update on public.app_settings for update to authenticated
  using (owner_id = auth.uid() and public.has_aal2())
  with check (owner_id = auth.uid() and public.has_aal2());

create policy audit_select on public.audit_log for select to authenticated
  using (owner_id = auth.uid() and public.has_aal2());

-- Funções não ficam executáveis por PUBLIC/anon. Somente o que a aplicação precisa é exposto.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.require_same_owner() from public, anon, authenticated;
revoke all on function public.current_session_id() from public, anon, authenticated;
revoke all on function public.latest_totp_timestamp() from public, anon, authenticated;
revoke all on function public.audit_row_change() from public, anon, authenticated;
revoke all on function public.audit_settings_change() from public, anon, authenticated;
revoke all on function public.sync_appointment_billing() from public, anon, authenticated;
revoke all on function public.require_clinical_appointment_patient() from public, anon, authenticated;
revoke all on function public.prevent_appointment_overlap() from public, anon, authenticated;
revoke all on function public.has_aal2() from public, anon;
revoke all on function public.has_clinical_access(uuid) from public, anon;
grant execute on function public.has_aal2() to authenticated;
grant execute on function public.has_clinical_access(uuid) to authenticated;

revoke all on function public.create_manual_revenue(text,text,text,date,date,date,numeric,boolean,uuid) from public, anon;
revoke all on function public.create_expense(text,text,date,date,numeric,text,boolean,uuid) from public, anon;
revoke all on function public.mark_expense_paid(uuid) from public, anon;
revoke all on function public.generate_package_billings(date) from public, anon;
revoke all on function public.mark_billing_paid(uuid) from public, anon;
revoke all on function public.archive_patient(uuid) from public, anon;
revoke all on function public.archive_clinical_note(uuid) from public, anon;
revoke all on function public.grant_clinical_access(uuid) from public, anon;
revoke all on function public.revoke_clinical_access(uuid) from public, anon;
grant execute on function public.create_manual_revenue(text,text,text,date,date,date,numeric,boolean,uuid) to authenticated;
grant execute on function public.create_expense(text,text,date,date,numeric,text,boolean,uuid) to authenticated;
grant execute on function public.mark_expense_paid(uuid) to authenticated;
grant execute on function public.generate_package_billings(date) to authenticated;
grant execute on function public.mark_billing_paid(uuid) to authenticated;
grant execute on function public.archive_patient(uuid) to authenticated;
grant execute on function public.archive_clinical_note(uuid) to authenticated;
grant execute on function public.grant_clinical_access(uuid) to authenticated;
grant execute on function public.revoke_clinical_access(uuid) to authenticated;

-- =========================================================
-- Storage privado
-- =========================================================

-- Limite adicional de quantidade para reduzir abuso de armazenamento em caso de sessão comprometida.
create or replace function public.material_storage_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage
as $$
  select count(*) < 250
  from storage.objects
  where bucket_id = 'materials-private'
    and (storage.foldername(name))[1] = auth.uid()::text;
$$;

revoke all on function public.material_storage_quota_ok() from public, anon;
grant execute on function public.material_storage_quota_ok() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials-private',
  'materials-private',
  false,
  10485760,
  array['application/pdf','image/png','image/jpeg','image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Somente a pasta do próprio uid e somente em AAL2.
-- Barreira restritiva do bucket: policies permissivas futuras não podem abrir este bucket por engano.
drop policy if exists materials_storage_hard_boundary on storage.objects;
create policy materials_storage_hard_boundary on storage.objects
as restrictive for all to public
using (
  bucket_id <> 'materials-private'
  or (
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
)
with check (
  bucket_id <> 'materials-private'
  or (
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists materials_storage_owner_select on storage.objects;
create policy materials_storage_owner_select on storage.objects
for select to authenticated
using (
  bucket_id = 'materials-private'
  and public.has_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists materials_storage_owner_insert on storage.objects;
create policy materials_storage_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'materials-private'
  and public.has_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(pdf|png|jpe?g|webp)$'
  and public.material_storage_quota_ok()
);

drop policy if exists materials_storage_owner_update on storage.objects;
create policy materials_storage_owner_update on storage.objects
for update to authenticated
using (
  bucket_id = 'materials-private'
  and public.has_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'materials-private'
  and public.has_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(name) ~ '\.(pdf|png|jpe?g|webp)$'
);

drop policy if exists materials_storage_owner_delete on storage.objects;
create policy materials_storage_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'materials-private'
  and public.has_aal2()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- =========================================================
-- Limpeza automática das concessões expiradas durante novas concessões
-- =========================================================

create or replace function public.cleanup_expired_clinical_grants()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.clinical_access_grants where created_at < now() - interval '24 hours';
  return null;
end;
$$;

drop trigger if exists clinical_grants_cleanup on public.clinical_access_grants;
create trigger clinical_grants_cleanup
before insert on public.clinical_access_grants
for each statement execute function public.cleanup_expired_clinical_grants();

-- O trigger de limpeza é interno e não é chamável pela API.
revoke all on function public.cleanup_expired_clinical_grants() from public, anon, authenticated;
