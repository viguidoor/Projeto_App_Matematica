-- Operação Área, Etapa 2a: esquema do banco.
-- Percurso registrado: diagnóstico → hipótese inicial → tentativas/revisões → saída final.
-- Nenhum nome de estudante é armazenado: só UUID anônimo (Auth) + apelido de equipe.
--
-- Estas migrações são as MESMAS para o Supabase local (Docker) e para o projeto hospedado (Etapa 2b).

create schema if not exists app_private;

-- Professores autorizados. Só quem estiver aqui (inserido pelo dono do projeto, via SQL) é professor.
create table public.teachers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null references auth.users (id) on delete cascade,
  code            text not null,
  mission         text not null default 'jardim',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  closed_at       timestamptz,
  -- Retenção planejada dos dados brutos: 30 dias (exclusão por public.purge_expired_data()).
  retention_until timestamptz not null default (now() + interval '30 days'),
  constraint sessions_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint sessions_mission_valid check (mission in ('jardim')),
  constraint sessions_expiry_after_open check (expires_at > created_at)
);
-- O código é único entre as sessões abertas (um código antigo e encerrado pode ser reaproveitado).
create unique index sessions_open_code_uq on public.sessions (code) where closed_at is null;
create index sessions_teacher_idx on public.sessions (teacher_id, created_at desc);
create index sessions_retention_idx on public.sessions (retention_until);

create table public.teams (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  alias            text not null,
  alias_key        text not null,
  phase            text not null default 'diagnostico',
  major            numeric not null default 10,
  minor            numeric not null default 6,
  exploring_since  timestamptz,
  phase_started_at timestamptz not null default now(),
  joined_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  fictitious       boolean not null default false,
  constraint teams_alias_len check (char_length(alias) between 2 and 24),
  constraint teams_phase_valid check (phase in ('diagnostico', 'exploracao', 'hipotese', 'feedback', 'saida', 'concluido')),
  constraint teams_diagonals_valid check (major between 2 and 20 and minor between 2 and 20 and minor <= major),
  constraint teams_one_per_user unique (session_id, user_id),
  constraint teams_alias_unique unique (session_id, alias_key)
);
create index teams_session_idx on public.teams (session_id, joined_at);

-- Uma linha por registro da equipe. `kind` separa as quatro etapas de dados:
--   diagnostico (1) → hipotese (1) → tentativa (0..n, as revisões) → saida (1)
create table public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams (id) on delete cascade,
  session_id         uuid not null references public.sessions (id) on delete cascade,
  kind               text not null,
  seq                integer not null default 1,
  major              numeric not null,
  minor              numeric not null,
  calculation        text not null,
  raw_answer         text not null,
  answer             numeric not null,
  unit               text not null,
  justification      text not null,
  correct            boolean not null,         -- calculado NO SERVIDOR
  pattern_id         text,                     -- hipótese pedagógica (nunca diagnóstico), calculada no servidor
  hint_level         smallint not null default 0,
  ms_since_phase_start integer,                -- tempo aproximado desde o início da fase
  client_request_id  uuid not null default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  constraint submissions_kind_valid check (kind in ('diagnostico', 'hipotese', 'tentativa', 'saida')),
  constraint submissions_seq_valid check (seq >= 1 and (kind = 'tentativa' or seq = 1)),
  constraint submissions_unit_valid check (unit in ('m', 'm²')),
  constraint submissions_answer_valid check (answer > 0 and answer <= 100000),
  constraint submissions_calc_len check (char_length(calculation) between 3 and 120),
  constraint submissions_raw_len check (char_length(raw_answer) between 1 and 20),
  constraint submissions_just_len check (char_length(justification) between 2 and 500),
  constraint submissions_hint_valid check (hint_level between 0 and 3),
  constraint submissions_ms_valid check (ms_since_phase_start is null or ms_since_phase_start >= 0),
  constraint submissions_pattern_valid check (
    pattern_id is null or pattern_id in
      ('produto_sem_metade', 'soma_diagonais', 'media_diagonais', 'quarto_do_produto', 'unidade_incorreta')
  ),
  -- diagnóstico, hipótese inicial e saída: uma única vez por equipe; tentativas: numeradas
  constraint submissions_one_per_kind_seq unique (team_id, kind, seq),
  -- idempotência: repetir o mesmo envio não duplica
  constraint submissions_idempotency unique (team_id, client_request_id)
);
create index submissions_session_kind_idx on public.submissions (session_id, kind);

create table public.hint_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  level      smallint not null,
  created_at timestamptz not null default now(),
  constraint hint_events_level_valid check (level in (1, 2, 3)),
  constraint hint_events_once unique (team_id, level)
);

-- Linha do tempo (tempo aproximado, estado). Só eventos pedagógicos; sem rastreamento de cliques.
create table public.team_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  type       text not null,
  created_at timestamptz not null default now(),
  constraint team_events_type_valid check (type in (
    'entrou', 'enviou_diagnostico', 'iniciou_exploracao', 'abriu_dica',
    'enviou_hipotese', 'enviou_tentativa', 'foi_para_saida', 'enviou_saida'
  ))
);
create index team_events_team_idx on public.team_events (team_id, created_at);

-- Intervenções do professor: dificuldade observada → pergunta/intervenção → resposta após a mediação.
create table public.interventions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  team_id     uuid references public.teams (id) on delete set null,   -- null = turma toda
  team_alias  text,
  difficulty  text not null default '',
  intervention text not null default '',
  response_after text not null default '',
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint interventions_len check (
    char_length(difficulty) <= 500 and char_length(intervention) <= 500 and char_length(response_after) <= 500
  ),
  constraint interventions_not_empty check (btrim(difficulty || intervention || response_after) <> '')
);

-- O que o professor escolheu projetar. A TV lê só a visão derivada (public.get_projection).
create table public.projection (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  payload    jsonb not null default '{"kind":"none"}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint projection_size check (pg_column_size(payload) < 20000)
);

-- Tentativas de entrar com código (limite contra adivinhação de códigos).
create table public.join_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  tried_code text not null,
  ok         boolean not null,
  at         timestamptz not null default now()
);
create index join_attempts_user_idx on public.join_attempts (user_id, at desc);

-- Problemas fixos da missão (fonte única no banco; espelham src/domain/mission.ts).
create function app_private.problem_measures(p_kind text, out major numeric, out minor numeric)
language sql immutable
as $$
  select
    case p_kind when 'diagnostico' then 8::numeric when 'saida' then 12::numeric end,
    case p_kind when 'diagnostico' then 5::numeric when 'saida' then 4::numeric end
$$;
