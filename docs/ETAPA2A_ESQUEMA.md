# Operação Área — esquema final do banco (Etapa 2a)

> Gerado por `node infra/local/dump-schema.mjs` a partir do banco local migrado com `supabase/migrations/*.sql`. **Não editar à mão.**

Percurso registrado em `submissions.kind`: **diagnostico → hipotese → tentativa (0..n, revisões) → saida**.

## Tabelas

### public.hint_events  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `team_id` | uuid | não |  |
| `session_id` | uuid | não |  |
| `level` | smallint | não |  |
| `created_at` | timestamp with time zone | não | `now()` |

Restrições:

- `hint_events_level_valid` (check): `CHECK ((level = ANY (ARRAY[1, 2, 3])))`
- `hint_events_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `hint_events_team_id_fkey` (chave estrangeira): `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `hint_events_pkey` (chave primária): `PRIMARY KEY (id)`
- `hint_events_once` (único): `UNIQUE (team_id, level)`

### public.interventions  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `session_id` | uuid | não |  |
| `team_id` | uuid | sim |  |
| `team_alias` | text | sim |  |
| `difficulty` | text | não | `''::text` |
| `intervention` | text | não | `''::text` |
| `response_after` | text | não | `''::text` |
| `created_by` | uuid | não |  |
| `created_at` | timestamp with time zone | não | `now()` |

Restrições:

- `interventions_len` (check): `CHECK (((char_length(difficulty) <= 500) AND (char_length(intervention) <= 500) AND (char_length(response_after) <= 500)))`
- `interventions_not_empty` (check): `CHECK ((btrim(((difficulty || intervention) || response_after)) <> ''::text))`
- `interventions_created_by_fkey` (chave estrangeira): `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `interventions_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `interventions_team_id_fkey` (chave estrangeira): `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL`
- `interventions_pkey` (chave primária): `PRIMARY KEY (id)`

### public.join_attempts  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | bigint | não |  |
| `user_id` | uuid | não |  |
| `tried_code` | text | não |  |
| `ok` | boolean | não |  |
| `at` | timestamp with time zone | não | `now()` |

Restrições:

- `join_attempts_pkey` (chave primária): `PRIMARY KEY (id)`

Índices:

- `CREATE INDEX join_attempts_user_idx ON public.join_attempts USING btree (user_id, at DESC)`

### public.projection  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `session_id` | uuid | não |  |
| `payload` | jsonb | não | `'{"kind": "none"}'::jsonb` |
| `updated_at` | timestamp with time zone | não | `now()` |

Restrições:

- `projection_size` (check): `CHECK ((pg_column_size(payload) < 20000))`
- `projection_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `projection_pkey` (chave primária): `PRIMARY KEY (session_id)`

### public.sessions  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `teacher_id` | uuid | não |  |
| `code` | text | não |  |
| `mission` | text | não | `'jardim'::text` |
| `created_at` | timestamp with time zone | não | `now()` |
| `expires_at` | timestamp with time zone | não |  |
| `closed_at` | timestamp with time zone | sim |  |
| `retention_until` | timestamp with time zone | não | `(now() + '30 days'::interval)` |

Restrições:

- `sessions_code_format` (check): `CHECK ((code ~ '^[A-HJ-NP-Z2-9]{6}$'::text))`
- `sessions_expiry_after_open` (check): `CHECK ((expires_at > created_at))`
- `sessions_mission_valid` (check): `CHECK ((mission = 'jardim'::text))`
- `sessions_teacher_id_fkey` (chave estrangeira): `FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `sessions_pkey` (chave primária): `PRIMARY KEY (id)`

Índices:

- `CREATE UNIQUE INDEX sessions_open_code_uq ON public.sessions USING btree (code) WHERE (closed_at IS NULL)`
- `CREATE INDEX sessions_retention_idx ON public.sessions USING btree (retention_until)`
- `CREATE INDEX sessions_teacher_idx ON public.sessions USING btree (teacher_id, created_at DESC)`

### public.submissions  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `team_id` | uuid | não |  |
| `session_id` | uuid | não |  |
| `kind` | text | não |  |
| `seq` | integer | não | `1` |
| `major` | numeric | não |  |
| `minor` | numeric | não |  |
| `calculation` | text | não |  |
| `raw_answer` | text | não |  |
| `answer` | numeric | não |  |
| `unit` | text | não |  |
| `justification` | text | não |  |
| `correct` | boolean | não |  |
| `pattern_id` | text | sim |  |
| `hint_level` | smallint | não | `0` |
| `ms_since_phase_start` | integer | sim |  |
| `client_request_id` | uuid | não | `gen_random_uuid()` |
| `created_at` | timestamp with time zone | não | `now()` |

Restrições:

- `submissions_answer_valid` (check): `CHECK (((answer > (0)::numeric) AND (answer <= (100000)::numeric)))`
- `submissions_calc_len` (check): `CHECK (((char_length(calculation) >= 3) AND (char_length(calculation) <= 120)))`
- `submissions_hint_valid` (check): `CHECK (((hint_level >= 0) AND (hint_level <= 3)))`
- `submissions_just_len` (check): `CHECK (((char_length(justification) >= 2) AND (char_length(justification) <= 500)))`
- `submissions_kind_valid` (check): `CHECK ((kind = ANY (ARRAY['diagnostico'::text, 'hipotese'::text, 'tentativa'::text, 'saida'::text])))`
- `submissions_ms_valid` (check): `CHECK (((ms_since_phase_start IS NULL) OR (ms_since_phase_start >= 0)))`
- `submissions_pattern_valid` (check): `CHECK (((pattern_id IS NULL) OR (pattern_id = ANY (ARRAY['produto_sem_metade'::text, 'soma_diagonais'::text, 'media_diagonais'::text, 'quarto_do_produto'::text, 'unidade_incorreta'::text]))))`
- `submissions_raw_len` (check): `CHECK (((char_length(raw_answer) >= 1) AND (char_length(raw_answer) <= 20)))`
- `submissions_seq_valid` (check): `CHECK (((seq >= 1) AND ((kind = 'tentativa'::text) OR (seq = 1))))`
- `submissions_unit_valid` (check): `CHECK ((unit = ANY (ARRAY['m'::text, 'm²'::text])))`
- `submissions_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `submissions_team_id_fkey` (chave estrangeira): `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `submissions_pkey` (chave primária): `PRIMARY KEY (id)`
- `submissions_idempotency` (único): `UNIQUE (team_id, client_request_id)`
- `submissions_one_per_kind_seq` (único): `UNIQUE (team_id, kind, seq)`

Índices:

- `CREATE INDEX submissions_session_kind_idx ON public.submissions USING btree (session_id, kind)`

### public.teachers  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `user_id` | uuid | não |  |
| `created_at` | timestamp with time zone | não | `now()` |

Restrições:

- `teachers_user_id_fkey` (chave estrangeira): `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `teachers_pkey` (chave primária): `PRIMARY KEY (user_id)`

### public.team_events  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `team_id` | uuid | não |  |
| `session_id` | uuid | não |  |
| `type` | text | não |  |
| `created_at` | timestamp with time zone | não | `now()` |

Restrições:

- `team_events_type_valid` (check): `CHECK ((type = ANY (ARRAY['entrou'::text, 'enviou_diagnostico'::text, 'iniciou_exploracao'::text, 'abriu_dica'::text, 'enviou_hipotese'::text, 'enviou_tentativa'::text, 'foi_para_saida'::text, 'enviou_saida'::text])))`
- `team_events_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `team_events_team_id_fkey` (chave estrangeira): `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_events_pkey` (chave primária): `PRIMARY KEY (id)`

Índices:

- `CREATE INDEX team_events_team_idx ON public.team_events USING btree (team_id, created_at)`

### public.teams  (RLS ligada)

| Coluna | Tipo | Nulo? | Padrão |
|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` |
| `session_id` | uuid | não |  |
| `user_id` | uuid | não |  |
| `alias` | text | não |  |
| `alias_key` | text | não |  |
| `phase` | text | não | `'diagnostico'::text` |
| `major` | numeric | não | `10` |
| `minor` | numeric | não | `6` |
| `exploring_since` | timestamp with time zone | sim |  |
| `phase_started_at` | timestamp with time zone | não | `now()` |
| `joined_at` | timestamp with time zone | não | `now()` |
| `last_seen_at` | timestamp with time zone | não | `now()` |
| `fictitious` | boolean | não | `false` |

Restrições:

- `teams_alias_len` (check): `CHECK (((char_length(alias) >= 2) AND (char_length(alias) <= 24)))`
- `teams_diagonals_valid` (check): `CHECK ((((major >= (2)::numeric) AND (major <= (20)::numeric)) AND ((minor >= (2)::numeric) AND (minor <= (20)::numeric)) AND (minor <= major)))`
- `teams_phase_valid` (check): `CHECK ((phase = ANY (ARRAY['diagnostico'::text, 'exploracao'::text, 'hipotese'::text, 'feedback'::text, 'saida'::text, 'concluido'::text])))`
- `teams_session_id_fkey` (chave estrangeira): `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `teams_user_id_fkey` (chave estrangeira): `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `teams_pkey` (chave primária): `PRIMARY KEY (id)`
- `teams_alias_unique` (único): `UNIQUE (session_id, alias_key)`
- `teams_one_per_user` (único): `UNIQUE (session_id, user_id)`

Índices:

- `CREATE INDEX teams_session_idx ON public.teams USING btree (session_id, joined_at)`

## Visões de análise (security_invoker: valem as regras de quem consulta)

- `public.v_apos_intervencao`
- `public.v_trajetoria`

## Políticas de acesso (RLS)

| Tabela | Política | Operação | Papéis | Condição |
|---|---|---|---|---|
| hint_events | hint_events_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |
| interventions | interventions_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |
| projection | projection_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |
| sessions | sessions_teacher_read | SELECT | {authenticated} | `((teacher_id = auth.uid()) AND app_private.is_teacher())` |
| submissions | submissions_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |
| teachers | teachers_read_own | SELECT | {authenticated} | `(user_id = auth.uid())` |
| team_events | team_events_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |
| teams | teams_teacher_read | SELECT | {authenticated} | `app_private.is_session_teacher(session_id)` |

Tabelas com RLS e **sem** política (acesso negado a todos os papéis de API): `join_attempts`.

## Funções e quem pode executá-las

`DEFINER` = roda com os privilégios do dono e valida quem chamou por dentro (`auth.uid()`, `is_teacher()`).

| Função | Schema | Definer | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `assert_active(p_team teams)` | app_private | não | — | — | — |
| `contains_personal_data(p_text text)` | app_private | não | — | — | — |
| `evaluate(p_major numeric, p_minor numeric, p_answer numeric, p_unit text, OUT correct boolean, OUT pattern text)` | app_private | não | — | — | — |
| `export_team(p_session uuid)` | app_private | não | — | — | — |
| `fail(p_code text, p_message text)` | app_private | não | — | — | — |
| `format_number(p_value numeric)` | app_private | não | — | — | — |
| `insert_submission(p_team uuid, p_kind text, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request uuid)` | app_private | sim | — | — | — |
| `is_session_teacher(p_session uuid)` | app_private | sim | — | ✔ | — |
| `is_teacher()` | app_private | sim | — | ✔ | — |
| `log_event(p_team teams, p_type text)` | app_private | não | — | — | — |
| `max_hint(p_team uuid)` | app_private | não | — | — | — |
| `ms(p_ts timestamp with time zone)` | app_private | não | — | — | — |
| `problem_measures(p_kind text, OUT major numeric, OUT minor numeric)` | app_private | não | — | — | — |
| `require_teacher()` | app_private | não | — | — | — |
| `session_json(s sessions)` | app_private | não | — | — | — |
| `student_team(p_team uuid)` | app_private | não | — | — | — |
| `submission_json(s submissions)` | app_private | não | — | — | — |
| `teacher_session(p_code text)` | app_private | não | — | — | — |
| `team_json(p_team uuid)` | app_private | não | — | — | — |
| `validate_input(p_calculation text, p_raw_answer text, p_unit text, p_justification text, OUT calculation text, OUT raw_answer text, OUT answer numeric, OUT justification text)` | app_private | não | — | — | — |
| `add_note(p_code text, p_team_alias text, p_difficulty text, p_intervention text, p_response text)` | public | sim | — | ✔ | ✔ |
| `close_session(p_code text)` | public | sim | — | ✔ | ✔ |
| `create_session(p_minutes integer)` | public | sim | — | ✔ | ✔ |
| `delete_session(p_code text)` | public | sim | — | ✔ | ✔ |
| `export_anonymous(p_code text)` | public | sim | — | ✔ | ✔ |
| `get_current_session()` | public | sim | — | ✔ | ✔ |
| `get_projection(p_code text)` | public | sim | ✔ | ✔ | ✔ |
| `get_projection_config()` | public | sim | — | ✔ | ✔ |
| `get_team(p_team uuid)` | public | sim | — | ✔ | ✔ |
| `join_session(p_code text, p_alias text)` | public | sim | — | ✔ | ✔ |
| `list_notes(p_code text)` | public | sim | — | ✔ | ✔ |
| `list_teams(p_code text)` | public | sim | — | ✔ | ✔ |
| `purge_expired_data()` | public | sim | — | — | ✔ |
| `record_hint(p_team uuid, p_level integer)` | public | sim | — | ✔ | ✔ |
| `save_progress(p_team uuid, p_phase text, p_major numeric, p_minor numeric)` | public | sim | — | ✔ | ✔ |
| `set_projection(p_payload jsonb)` | public | sim | — | ✔ | ✔ |
| `submit_attempt(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid)` | public | sim | — | ✔ | ✔ |
| `submit_diagnostic(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid)` | public | sim | — | ✔ | ✔ |
| `submit_exit(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid)` | public | sim | — | ✔ | ✔ |
| `submit_hypothesis(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid)` | public | sim | — | ✔ | ✔ |

## Tempo real

Tabelas na publicação `supabase_realtime` (o Realtime aplica a RLS de cada assinante): `hint_events`, `interventions`, `projection`, `sessions`, `submissions`, `teams`.
