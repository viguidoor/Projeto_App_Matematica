-- Operação Área, Etapa 2a: RLS, permissões e Realtime.
--
-- Modelo de acesso:
--   * ANON (chave pública, sem login): só pode ler a projeção por código (public.get_projection).
--   * Estudante = usuário ANÔNIMO do Auth (papel `authenticated`, claim is_anonymous = true): só executa as funções
--     de estudante. Não tem leitura útil de nenhuma tabela (RLS devolve 0 linhas) e nenhuma escrita direta.
--   * Professor = usuário com e-mail/senha E presente em public.teachers: lê as tabelas da própria sessão (RLS)
--     e usa as funções docentes. Ninguém escreve em tabelas diretamente: toda escrita passa por funções.

alter table public.teachers      enable row level security;
alter table public.sessions      enable row level security;
alter table public.teams         enable row level security;
alter table public.submissions   enable row level security;
alter table public.hint_events   enable row level security;
alter table public.team_events   enable row level security;
alter table public.interventions enable row level security;
alter table public.projection    enable row level security;
alter table public.join_attempts enable row level security;   -- sem política: ninguém lê pela API

-- Leitura (SELECT) apenas para o professor da sessão. Usado também pelo Realtime (que respeita RLS).
create policy teachers_read_own on public.teachers
  for select to authenticated using (user_id = auth.uid());

create policy sessions_teacher_read on public.sessions
  for select to authenticated using (teacher_id = auth.uid() and app_private.is_teacher());

create policy teams_teacher_read on public.teams
  for select to authenticated using (app_private.is_session_teacher(session_id));

create policy submissions_teacher_read on public.submissions
  for select to authenticated using (app_private.is_session_teacher(session_id));

create policy hint_events_teacher_read on public.hint_events
  for select to authenticated using (app_private.is_session_teacher(session_id));

create policy team_events_teacher_read on public.team_events
  for select to authenticated using (app_private.is_session_teacher(session_id));

create policy interventions_teacher_read on public.interventions
  for select to authenticated using (app_private.is_session_teacher(session_id));

create policy projection_teacher_read on public.projection
  for select to authenticated using (app_private.is_session_teacher(session_id));

-- Privilégios: começa de zero (o Supabase concede tudo por padrão às tabelas novas) e libera só o necessário.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on schema app_private from public, anon, authenticated;

-- Objetos criados no futuro por este papel também não nascem expostos.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

grant select on public.teachers, public.sessions, public.teams, public.submissions,
                public.hint_events, public.team_events, public.interventions, public.projection
  to authenticated;

-- As políticas acima chamam estas funções (executadas com o papel de quem consulta).
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_teacher() to authenticated;
grant execute on function app_private.is_session_teacher(uuid) to authenticated;

-- Funções de estudante (qualquer usuário autenticado/anônimo; cada uma checa o dono da equipe).
grant execute on function public.join_session(text, text) to authenticated;
grant execute on function public.get_team(uuid) to authenticated;
grant execute on function public.save_progress(uuid, text, numeric, numeric) to authenticated;
grant execute on function public.record_hint(uuid, integer) to authenticated;
grant execute on function public.submit_diagnostic(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.submit_hypothesis(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.submit_attempt(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.submit_exit(uuid, text, text, text, text, uuid) to authenticated;

-- Funções docentes (checam is_teacher() dentro; a concessão não basta).
grant execute on function public.create_session(integer) to authenticated;
grant execute on function public.close_session(text) to authenticated;
grant execute on function public.delete_session(text) to authenticated;
grant execute on function public.get_current_session() to authenticated;
grant execute on function public.list_teams(text) to authenticated;
grant execute on function public.add_note(text, text, text, text, text) to authenticated;
grant execute on function public.list_notes(text) to authenticated;
grant execute on function public.set_projection(jsonb) to authenticated;
grant execute on function public.get_projection_config() to authenticated;
grant execute on function public.export_anonymous(text) to authenticated;

-- TV/projetor: sem login, só com o código; devolve apenas conteúdo agregado ou exemplo já revisado.
grant execute on function public.get_projection(text) to anon, authenticated;

-- Retenção: só administração (service_role) ou o dono do projeto.
grant execute on function public.purge_expired_data() to service_role;

-- Tempo real para o painel do professor (o Realtime aplica as políticas acima a cada assinante).
alter publication supabase_realtime add table
  public.sessions, public.teams, public.submissions, public.hint_events, public.interventions, public.projection;
