-- Operação Área, Etapa 2a: funções (RPC) e auxiliares.
--
-- Princípio: estudantes NÃO leem nem escrevem tabelas diretamente. Tudo passa por funções que
--   (1) identificam quem chama (auth.uid()), (2) validam sessão/fase/ordem e (3) calculam o acerto no servidor.
-- Erros: mensagem em português + `hint` com um código estável (SESSION_CLOSED, INVALID_STATE, ...).

-- ------------------------------------------------------------------ auxiliares (schema privado)

create function app_private.fail(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = 'P0001', hint = p_code;
end;
$$;

create function app_private.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select true from public.teachers t where t.user_id = auth.uid()), false)
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

create function app_private.is_session_teacher(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_teacher()
     and exists (select 1 from public.sessions s where s.id = p_session and s.teacher_id = auth.uid())
$$;

create function app_private.ms(p_ts timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$ select case when p_ts is null then null else (extract(epoch from p_ts) * 1000)::bigint end $$;

-- Igual a formatNumber() do app (pt-BR, até 2 casas, sem zeros à direita): 12.5 → "12,5"; 1000 → "1.000".
create function app_private.format_number(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    regexp_replace(to_char(round(p_value, 2), 'FM999,999,990.00'), '(\.[0-9]*[1-9])0+$|\.0+$', '\1'),
    ',.', '.,'
  )
$$;

-- Dados pessoais evidentes em texto livre (mesmas regras de src/domain/pii.ts).
create function app_private.contains_personal_data(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text like '%@%'
      or p_text ~* '(https?:|www\.)'
      or p_text ~* '\.(com|net|org|br)\y'
      or p_text ~ '[0-9]{4,}'
$$;

-- Acerto e padrão de erro (hipótese pedagógica). Espelha evaluateAnswer() de src/domain/evaluate.ts.
-- Se mais de um padrão coincide, não rotula nenhum.
create function app_private.evaluate(
  p_major numeric, p_minor numeric, p_answer numeric, p_unit text,
  out correct boolean, out pattern text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_area numeric := (p_major * p_minor) / 2;
  v_matches text[] := '{}';
begin
  correct := false;
  pattern := null;
  if abs(p_answer - v_area) < 0.000001 then
    if p_unit = 'm²' then
      correct := true;
    else
      pattern := 'unidade_incorreta';
    end if;
    return;
  end if;
  if abs(p_answer - p_major * p_minor) < 0.000001 then v_matches := array_append(v_matches, 'produto_sem_metade'::text); end if;
  if abs(p_answer - (p_major + p_minor)) < 0.000001 then v_matches := array_append(v_matches, 'soma_diagonais'::text); end if;
  if abs(p_answer - (p_major + p_minor) / 2) < 0.000001 then v_matches := array_append(v_matches, 'media_diagonais'::text); end if;
  if abs(p_answer - (p_major * p_minor) / 4) < 0.000001 then v_matches := array_append(v_matches, 'quarto_do_produto'::text); end if;
  if array_length(v_matches, 1) = 1 then pattern := v_matches[1]; end if;
end;
$$;

-- Valida os campos preenchidos pela equipe (mesma ordem e mesmas mensagens de validateSubmissionInput).
create function app_private.validate_input(
  p_calculation text, p_raw_answer text, p_unit text, p_justification text,
  out calculation text, out raw_answer text, out answer numeric, out justification text
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  calculation := btrim(coalesce(p_calculation, ''));
  if char_length(calculation) < 3 then
    perform app_private.fail('INVALID_INPUT', 'Registrem o cálculo da equipe (ex.: 3 × 4).');
  elsif char_length(calculation) > 120 then
    perform app_private.fail('INVALID_INPUT', 'O cálculo pode ter até 120 caracteres.');
  elsif app_private.contains_personal_data(calculation) then
    perform app_private.fail('INVALID_INPUT', 'Não escrevam e-mails, endereços da internet, telefones ou números com 4 ou mais algarismos seguidos.');
  end if;

  raw_answer := btrim(coalesce(p_raw_answer, ''));
  if raw_answer = '' then
    perform app_private.fail('INVALID_INPUT', 'Digite um número.');
  elsif left(raw_answer, 1) = '-' then
    perform app_private.fail('INVALID_INPUT', 'Use um valor positivo.');
  elsif raw_answer !~ '^[0-9]+([.,][0-9]+)?$' or char_length(raw_answer) > 20 then
    perform app_private.fail('INVALID_INPUT', 'Use apenas algarismos e, se precisar, uma vírgula (ex.: 12,5).');
  end if;
  answer := replace(raw_answer, ',', '.')::numeric;
  if answer <= 0 then
    perform app_private.fail('INVALID_INPUT', 'A área deve ser maior que zero.');
  elsif answer > 100000 then
    perform app_private.fail('INVALID_INPUT', 'Digite um valor de até 100.000.');
  end if;

  if p_unit is distinct from 'm' and p_unit is distinct from 'm²' then
    perform app_private.fail('INVALID_INPUT', 'Escolham a unidade da resposta.');
  end if;

  justification := btrim(coalesce(p_justification, ''));
  if char_length(justification) < 2 then
    perform app_private.fail('INVALID_INPUT', 'Escrevam como pensaram. Pode ser curto, por exemplo: "metade do retângulo".');
  elsif char_length(justification) > 500 then
    perform app_private.fail('INVALID_INPUT', 'A justificativa pode ter até 500 caracteres.');
  elsif app_private.contains_personal_data(justification) then
    perform app_private.fail('INVALID_INPUT', 'Não escrevam e-mails, endereços da internet, telefones ou números com 4 ou mais algarismos seguidos.');
  end if;
end;
$$;

create function app_private.submission_json(s public.submissions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'n', s.seq,
    'major', s.major,
    'minor', s.minor,
    'calculation', s.calculation,
    'rawAnswer', s.raw_answer,
    'answer', s.answer,
    'unit', s.unit,
    'justification', s.justification,
    'correct', s.correct,
    'patternId', s.pattern_id,
    'submittedAt', app_private.ms(s.created_at),
    'hintLevel', s.hint_level
  )
$$;

create function app_private.session_json(s public.sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'code', s.code,
    'openedAt', app_private.ms(s.created_at),
    'expiresAt', app_private.ms(s.expires_at),
    'closedAt', app_private.ms(s.closed_at),
    'retentionUntil', app_private.ms(s.retention_until)
  )
$$;

-- Formato idêntico a TeamRecord (src/domain/types.ts).
create function app_private.team_json(p_team uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'sessionCode', s.code,
    'alias', t.alias,
    'fictitious', t.fictitious,
    'joinedAt', app_private.ms(t.joined_at),
    'phase', t.phase,
    'diagonals', jsonb_build_object('major', t.major, 'minor', t.minor),
    'exploringSince', app_private.ms(t.exploring_since),
    'diagnostic', (select app_private.submission_json(x) from public.submissions x where x.team_id = t.id and x.kind = 'diagnostico'),
    'hypothesis', (select app_private.submission_json(x) from public.submissions x where x.team_id = t.id and x.kind = 'hipotese'),
    'hints', coalesce((
      select jsonb_agg(jsonb_build_object('level', h.level, 'viewedAt', app_private.ms(h.created_at)) order by h.level)
      from public.hint_events h where h.team_id = t.id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(app_private.submission_json(x) order by x.seq)
      from public.submissions x where x.team_id = t.id and x.kind = 'tentativa'
    ), '[]'::jsonb),
    'exit', (select app_private.submission_json(x) from public.submissions x where x.team_id = t.id and x.kind = 'saida'),
    'sessionClosed', s.closed_at is not null
  )
  from public.teams t
  join public.sessions s on s.id = t.session_id
  where t.id = p_team
$$;

-- Equipe do estudante que chama (trava a linha para serializar envios da mesma equipe).
create function app_private.student_team(p_team uuid)
returns public.teams
language plpgsql
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  if auth.uid() is null then
    perform app_private.fail('NOT_AUTHORIZED', 'Entre novamente com o código da sessão.');
  end if;
  select * into v_team from public.teams t where t.id = p_team and t.user_id = auth.uid() for update;
  if not found then
    perform app_private.fail('TEAM_NOT_FOUND', 'Equipe não encontrada. Entre novamente com o código da sessão.');
  end if;
  return v_team;
end;
$$;

create function app_private.assert_active(p_team public.teams)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.sessions s where s.id = p_team.session_id and s.closed_at is not null) then
    perform app_private.fail('SESSION_CLOSED', 'A sessão foi encerrada pelo professor.');
  end if;
end;
$$;

create function app_private.max_hint(p_team uuid)
returns smallint
language sql
stable
set search_path = ''
as $$ select coalesce(max(level), 0)::smallint from public.hint_events where team_id = p_team $$;

create function app_private.log_event(p_team public.teams, p_type text)
returns void
language sql
set search_path = ''
as $$ insert into public.team_events (team_id, session_id, type) values (p_team.id, p_team.session_id, p_type) $$;

-- ------------------------------------------------------------------ estudante

-- Entrar na sessão. Devolve {ok:true, team} ou {ok:false, code, message}. (Falhas são devolvidas, não lançadas,
-- para que o registro da tentativa — usado no limite contra adivinhação de códigos — não seja desfeito.)
create function public.join_session(p_code text, p_alias text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_alias text := regexp_replace(btrim(coalesce(p_alias, '')), '\s+', ' ', 'g');
  v_session public.sessions;
  v_team public.teams;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED', 'message', 'Entre novamente com o código da sessão.');
  end if;

  if (select count(*) from public.join_attempts a where a.user_id = v_uid and not a.ok and a.at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ATTEMPTS',
      'message', 'Muitas tentativas com código errado. Aguardem alguns minutos e confiram o código com o professor.');
  end if;

  select * into v_session from public.sessions s where s.code = v_code order by s.created_at desc limit 1;
  if not found then
    insert into public.join_attempts (user_id, tried_code, ok) values (v_uid, left(v_code, 12), false);
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND',
      'message', 'Código não encontrado. Confiram o código mostrado pelo professor.');
  end if;
  if v_session.closed_at is not null or now() >= v_session.expires_at then
    insert into public.join_attempts (user_id, tried_code, ok) values (v_uid, left(v_code, 12), false);
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED',
      'message', 'Essa sessão não está aberta. Peçam um novo código ao professor.');
  end if;

  -- Já entrou nesta sessão com este dispositivo (ex.: repetiu a chamada depois de uma queda de rede)?
  select * into v_team from public.teams t where t.session_id = v_session.id and t.user_id = v_uid;
  if found then
    insert into public.join_attempts (user_id, tried_code, ok) values (v_uid, v_code, true);
    return jsonb_build_object('ok', true, 'team', app_private.team_json(v_team.id));
  end if;

  if char_length(v_alias) < 2 or char_length(v_alias) > 24 then
    return jsonb_build_object('ok', false, 'code', 'ALIAS_INVALID', 'message', 'O apelido deve ter de 2 a 24 caracteres.');
  elsif v_alias !~ '^[[:alnum:] _-]+$' then
    return jsonb_build_object('ok', false, 'code', 'ALIAS_INVALID', 'message', 'Use apenas letras, números, espaço, hífen ou sublinhado.');
  elsif v_alias ~ '[0-9]{4,}' then
    return jsonb_build_object('ok', false, 'code', 'ALIAS_INVALID', 'message', 'Não use números longos (como telefone ou matrícula).');
  end if;

  if (select count(*) from public.teams t where t.session_id = v_session.id) >= 60 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE', 'message', 'Esta sessão já tem o número máximo de equipes.');
  end if;

  begin
    insert into public.teams (session_id, user_id, alias, alias_key)
    values (v_session.id, v_uid, v_alias, lower(v_alias))
    returning * into v_team;
  exception when unique_violation then
    -- outra chamada simultânea: mesmo apelido (outra equipe) ou mesmo dispositivo
    select * into v_team from public.teams t where t.session_id = v_session.id and t.user_id = v_uid;
    if found then
      return jsonb_build_object('ok', true, 'team', app_private.team_json(v_team.id));
    end if;
    return jsonb_build_object('ok', false, 'code', 'ALIAS_TAKEN', 'message', 'Já existe uma equipe com esse apelido. Escolham outro.');
  end;

  perform app_private.log_event(v_team, 'entrou');
  insert into public.join_attempts (user_id, tried_code, ok) values (v_uid, v_code, true);
  return jsonb_build_object('ok', true, 'team', app_private.team_json(v_team.id));
end;
$$;

-- Estado da equipe (estudante dono da equipe, ou o professor da sessão). Devolve null se não existir/não for dele.
create function public.get_team(p_team uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams t where t.id = p_team;
  if not found then
    return null;
  end if;
  if v_team.user_id is distinct from auth.uid() and not app_private.is_session_teacher(v_team.session_id) then
    return null;
  end if;
  return app_private.team_json(v_team.id);
end;
$$;

create function public.save_progress(
  p_team uuid,
  p_phase text default null,
  p_major numeric default null,
  p_minor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams := app_private.student_team(p_team);
  v_has_hypothesis boolean;
  v_changed boolean;
begin
  perform app_private.assert_active(v_team);
  if exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'saida') then
    perform app_private.fail('INVALID_STATE', 'A missão já foi concluída.');
  end if;

  if p_major is not null or p_minor is not null then
    if p_major is null or p_minor is null then
      perform app_private.fail('INVALID_INPUT', 'Informe as duas diagonais.');
    end if;
    if v_team.phase <> 'exploracao' then
      perform app_private.fail('INVALID_STATE', 'As medidas só podem mudar na exploração.');
    end if;
    if p_major < 2 or p_major > 20 or p_minor < 2 or p_minor > 20 then
      perform app_private.fail('INVALID_INPUT', 'As diagonais devem ficar entre 2 m e 20 m.');
    end if;
    if p_minor > p_major then
      perform app_private.fail('INVALID_INPUT', 'A diagonal menor não pode ser maior que a diagonal maior.');
    end if;
    v_changed := p_major <> v_team.major or p_minor <> v_team.minor;
    update public.teams set major = p_major, minor = p_minor where id = v_team.id;
    v_team.major := p_major;
    v_team.minor := p_minor;
    if v_changed and v_team.exploring_since is null then
      update public.teams set exploring_since = now() where id = v_team.id;
      v_team.exploring_since := now();
      perform app_private.log_event(v_team, 'iniciou_exploracao');
    end if;
  end if;

  if p_phase is not null then
    if p_phase not in ('exploracao', 'hipotese', 'saida') then
      perform app_private.fail('INVALID_INPUT', 'Etapa inexistente.');
    end if;
    v_has_hypothesis := exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'hipotese');
    if p_phase = v_team.phase then
      return app_private.team_json(v_team.id);  -- repetição do mesmo pedido (ex.: após queda de rede): sem efeito
    end if;
    if not (
      (v_team.phase = 'exploracao' and p_phase = 'hipotese') or
      (v_team.phase = 'hipotese' and p_phase = 'exploracao') or
      (v_team.phase = 'feedback' and p_phase = 'exploracao') or
      (v_team.phase = 'feedback' and p_phase = 'saida' and v_has_hypothesis)
    ) then
      perform app_private.fail('INVALID_STATE', format('Não é possível ir de "%s" para "%s".', v_team.phase, p_phase));
    end if;
    update public.teams set phase = p_phase, phase_started_at = now() where id = v_team.id;
    if v_team.exploring_since is null and p_phase <> 'saida' then
      update public.teams set exploring_since = now() where id = v_team.id;
      perform app_private.log_event(v_team, 'iniciou_exploracao');
    end if;
    if p_phase = 'saida' then
      perform app_private.log_event(v_team, 'foi_para_saida');
    end if;
  end if;

  return app_private.team_json(v_team.id);
end;
$$;

create function public.record_hint(p_team uuid, p_level integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams := app_private.student_team(p_team);
  v_current smallint;
begin
  perform app_private.assert_active(v_team);
  -- Dicas ficam bloqueadas até o envio da hipótese inicial (a hipótese é sempre feita sem dicas).
  if not exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'hipotese') then
    perform app_private.fail('INVALID_STATE', 'As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial.');
  end if;
  if v_team.phase in ('saida', 'concluido') then
    perform app_private.fail('INVALID_STATE', 'O problema final é resolvido sem dicas.');
  end if;
  if p_level is null or p_level not in (1, 2, 3) then
    perform app_private.fail('INVALID_INPUT', 'Dica inexistente.');
  end if;
  v_current := app_private.max_hint(v_team.id);
  if p_level <= v_current then
    return app_private.team_json(v_team.id);  -- já vista: não duplica o registro
  end if;
  if p_level <> v_current + 1 then
    perform app_private.fail('INVALID_STATE', 'As dicas são liberadas em ordem.');
  end if;
  insert into public.hint_events (team_id, session_id, level) values (v_team.id, v_team.session_id, p_level);
  perform app_private.log_event(v_team, 'abriu_dica');
  return app_private.team_json(v_team.id);
end;
$$;

-- Registro de diagnóstico, hipótese inicial, tentativa ou saída (único caminho de escrita das respostas).
create function app_private.insert_submission(
  p_team uuid, p_kind text, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams := app_private.student_team(p_team);
  v_existing public.submissions;
  v_input record;
  v_eval record;
  v_major numeric;
  v_minor numeric;
  v_seq integer := 1;
  v_hint smallint := 0;
  v_row public.submissions;
  v_next_phase text;
  v_event text;
begin
  -- Idempotência: o mesmo envio repetido devolve o registro já gravado.
  if p_request is not null then
    select * into v_existing from public.submissions s where s.team_id = v_team.id and s.client_request_id = p_request;
    if found then
      return app_private.submission_json(v_existing);
    end if;
  end if;

  perform app_private.assert_active(v_team);

  if p_kind = 'diagnostico' then
    if v_team.phase <> 'diagnostico' or exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'diagnostico') then
      perform app_private.fail('INVALID_STATE', 'O diagnóstico já foi enviado.');
    end if;
    v_next_phase := 'exploracao'; v_event := 'enviou_diagnostico';
  elsif p_kind = 'hipotese' then
    if exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'hipotese') then
      perform app_private.fail('INVALID_STATE', 'A hipótese inicial já foi registrada. Usem uma nova tentativa.');
    end if;
    if v_team.phase <> 'hipotese' or not exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'diagnostico') then
      perform app_private.fail('INVALID_STATE', 'Registrem a hipótese depois de explorar o jardim.');
    end if;
    v_next_phase := 'feedback'; v_event := 'enviou_hipotese';
  elsif p_kind = 'tentativa' then
    if not exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'hipotese') then
      perform app_private.fail('INVALID_STATE', 'Registrem primeiro a hipótese inicial.');
    end if;
    if v_team.phase <> 'hipotese' then
      perform app_private.fail('INVALID_STATE', 'Explorem o jardim antes de registrar uma nova tentativa.');
    end if;
    v_next_phase := 'feedback'; v_event := 'enviou_tentativa';
  elsif p_kind = 'saida' then
    if v_team.phase <> 'saida' or exists (select 1 from public.submissions s where s.team_id = v_team.id and s.kind = 'saida') then
      perform app_private.fail('INVALID_STATE', 'O problema final não está disponível.');
    end if;
    v_next_phase := 'concluido'; v_event := 'enviou_saida';
  else
    perform app_private.fail('INVALID_INPUT', 'Tipo de registro inexistente.');
  end if;

  select * into v_input from app_private.validate_input(p_calculation, p_raw_answer, p_unit, p_justification);

  if p_kind in ('diagnostico', 'saida') then
    select pm.major, pm.minor into v_major, v_minor from app_private.problem_measures(p_kind) pm;
  else
    v_major := v_team.major;
    v_minor := v_team.minor;
    v_hint := app_private.max_hint(v_team.id);
  end if;
  if p_kind = 'tentativa' then
    select coalesce(max(s.seq), 0) + 1 into v_seq from public.submissions s where s.team_id = v_team.id and s.kind = 'tentativa';
  end if;

  select * into v_eval from app_private.evaluate(v_major, v_minor, v_input.answer, p_unit);

  insert into public.submissions (
    team_id, session_id, kind, seq, major, minor, calculation, raw_answer, answer, unit, justification,
    correct, pattern_id, hint_level, ms_since_phase_start, client_request_id
  ) values (
    v_team.id, v_team.session_id, p_kind, v_seq, v_major, v_minor, v_input.calculation, v_input.raw_answer,
    v_input.answer, p_unit, v_input.justification, v_eval.correct, v_eval.pattern, v_hint,
    least(2147483647, greatest(0, (extract(epoch from (now() - v_team.phase_started_at)) * 1000)::bigint))::integer,
    coalesce(p_request, gen_random_uuid())
  ) returning * into v_row;

  update public.teams set phase = v_next_phase, phase_started_at = now() where id = v_team.id;
  perform app_private.log_event(v_team, v_event);
  return app_private.submission_json(v_row);
end;
$$;

create function public.submit_diagnostic(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app_private.insert_submission(p_team, 'diagnostico', p_calculation, p_raw_answer, p_unit, p_justification, p_request_id) $$;

create function public.submit_hypothesis(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app_private.insert_submission(p_team, 'hipotese', p_calculation, p_raw_answer, p_unit, p_justification, p_request_id) $$;

create function public.submit_attempt(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app_private.insert_submission(p_team, 'tentativa', p_calculation, p_raw_answer, p_unit, p_justification, p_request_id) $$;

create function public.submit_exit(p_team uuid, p_calculation text, p_raw_answer text, p_unit text, p_justification text, p_request_id uuid default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app_private.insert_submission(p_team, 'saida', p_calculation, p_raw_answer, p_unit, p_justification, p_request_id) $$;

-- ------------------------------------------------------------------ professor

create function app_private.require_teacher()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app_private.is_teacher() then
    perform app_private.fail('NOT_AUTHORIZED', 'Acesso restrito ao professor.');
  end if;
end;
$$;

-- Sessão mais recente do professor com este código.
create function app_private.teacher_session(p_code text)
returns public.sessions
language plpgsql
stable
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  perform app_private.require_teacher();
  select * into v_session from public.sessions s
   where s.teacher_id = auth.uid() and s.code = upper(btrim(coalesce(p_code, '')))
   order by s.created_at desc limit 1;
  return v_session;  -- pode ser "vazio" (id nulo) se não existir
end;
$$;

create function public.create_session(p_minutes integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 símbolos, sem I/O/0/1
  v_code text;
  v_bytes bytea;
  v_row public.sessions;
  v_minutes integer := least(240, greatest(10, coalesce(p_minutes, 90)));
begin
  perform app_private.require_teacher();
  -- Abrir uma nova sessão encerra as anteriores ainda abertas deste professor.
  update public.sessions set closed_at = now() where teacher_id = auth.uid() and closed_at is null;
  for i in 1..30 loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for j in 0..5 loop
      v_code := v_code || substr(c_alphabet, 1 + (get_byte(v_bytes, j) % 32), 1);
    end loop;
    begin
      insert into public.sessions (teacher_id, code, expires_at)
      values (auth.uid(), v_code, now() + make_interval(mins => v_minutes))
      returning * into v_row;
      insert into public.projection (session_id) values (v_row.id);
      return app_private.session_json(v_row);
    exception when unique_violation then
      null;  -- código repetido entre sessões abertas: sorteia outro
    end;
  end loop;
  perform app_private.fail('INVALID_STATE', 'Não foi possível gerar um código. Tente de novo.');
  return null;
end;
$$;

create function public.close_session(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_teacher();
  update public.sessions set closed_at = now()
   where teacher_id = auth.uid() and code = upper(btrim(coalesce(p_code, ''))) and closed_at is null;
end;
$$;

-- Apaga a sessão e, em cascata, equipes, respostas, dicas, eventos, notas e projeção.
create function public.delete_session(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := app_private.teacher_session(p_code);
begin
  if v_session.id is not null then
    -- Ordem de travas igual à dos envios (equipe → sessão): primeiro as equipes, depois a sessão. Sem isto, apagar a
    -- sessão enquanto equipes enviam respostas poderia causar deadlock.
    perform 1 from public.teams t where t.session_id = v_session.id order by t.id for update;
    delete from public.sessions where id = v_session.id;
  end if;
end;
$$;

create function public.get_current_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  perform app_private.require_teacher();
  select * into v_session from public.sessions s where s.teacher_id = auth.uid() order by s.created_at desc limit 1;
  if not found then
    return null;
  end if;
  return app_private.session_json(v_session);
end;
$$;

create function public.list_teams(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := app_private.teacher_session(p_code);
begin
  if v_session.id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(app_private.team_json(t.id) order by t.joined_at, t.id)
    from public.teams t where t.session_id = v_session.id
  ), '[]'::jsonb);
end;
$$;

create function public.add_note(p_code text, p_team_alias text, p_difficulty text, p_intervention text, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := app_private.teacher_session(p_code);
  v_team public.teams;
  v_row public.interventions;
begin
  if v_session.id is null then
    perform app_private.fail('SESSION_NOT_FOUND', 'Sessão não encontrada.');
  end if;
  if btrim(coalesce(p_difficulty, '') || coalesce(p_intervention, '') || coalesce(p_response, '')) = '' then
    perform app_private.fail('INVALID_INPUT', 'Preencha ao menos um dos campos da nota.');
  end if;
  if char_length(coalesce(p_difficulty, '')) > 500 or char_length(coalesce(p_intervention, '')) > 500 or char_length(coalesce(p_response, '')) > 500 then
    perform app_private.fail('INVALID_INPUT', 'Cada campo da nota pode ter até 500 caracteres.');
  end if;
  if p_team_alias is not null and btrim(p_team_alias) <> '' then
    select * into v_team from public.teams t where t.session_id = v_session.id and t.alias_key = lower(btrim(p_team_alias));
  end if;
  insert into public.interventions (session_id, team_id, team_alias, difficulty, intervention, response_after, created_by)
  values (v_session.id, v_team.id, nullif(btrim(coalesce(p_team_alias, '')), ''), coalesce(p_difficulty, ''), coalesce(p_intervention, ''), coalesce(p_response, ''), auth.uid())
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id, 'sessionCode', v_session.code, 'team', v_row.team_alias,
    'difficulty', v_row.difficulty, 'intervention', v_row.intervention, 'response', v_row.response_after,
    'createdAt', app_private.ms(v_row.created_at)
  );
end;
$$;

create function public.list_notes(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := app_private.teacher_session(p_code);
begin
  if v_session.id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'sessionCode', v_session.code, 'team', i.team_alias, 'difficulty', i.difficulty,
      'intervention', i.intervention, 'response', i.response_after, 'createdAt', app_private.ms(i.created_at)
    ) order by i.created_at, i.id)
    from public.interventions i where i.session_id = v_session.id
  ), '[]'::jsonb);
end;
$$;

-- Escolha de projeção do professor (sessão mais recente dele). O conteúdo é validado: só categorias conhecidas,
-- textos curtos e sem dado pessoal evidente.
create function public.set_projection(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_kind text := p_payload ->> 'kind';
  v_example jsonb := p_payload -> 'example';
  v_clean jsonb;
begin
  perform app_private.require_teacher();
  select * into v_session from public.sessions s where s.teacher_id = auth.uid() order by s.created_at desc limit 1;
  if not found then
    perform app_private.fail('SESSION_NOT_FOUND', 'Abra uma sessão antes de projetar.');
  end if;

  if v_kind = 'none' then
    v_clean := '{"kind":"none"}'::jsonb;
  elsif v_kind = 'distribution' then
    if coalesce(p_payload ->> 'stage', '') not in ('diagnostico', 'hipotese', 'tentativa', 'saida')
       or jsonb_typeof(p_payload -> 'showCorrect') is distinct from 'boolean' then
      perform app_private.fail('INVALID_INPUT', 'Projeção inválida.');
    end if;
    v_clean := jsonb_build_object('kind', 'distribution', 'stage', p_payload ->> 'stage', 'showCorrect', (p_payload ->> 'showCorrect')::boolean);
  elsif v_kind = 'example' then
    if jsonb_typeof(v_example) is distinct from 'object'
       or coalesce(v_example ->> 'stage', '') not in ('diagnostico', 'hipotese', 'tentativa', 'saida')
       or jsonb_typeof(v_example -> 'major') is distinct from 'number' or jsonb_typeof(v_example -> 'minor') is distinct from 'number'
       or jsonb_typeof(v_example -> 'correct') is distinct from 'boolean' or jsonb_typeof(p_payload -> 'showCorrect') is distinct from 'boolean'
       or char_length(coalesce(v_example ->> 'calculation', '')) > 120
       or char_length(coalesce(v_example ->> 'answerText', '')) > 40
       or char_length(coalesce(v_example ->> 'justification', '')) > 500 then
      perform app_private.fail('INVALID_INPUT', 'Exemplo de projeção inválido.');
    end if;
    if app_private.contains_personal_data(coalesce(v_example ->> 'calculation', '') || ' ' || coalesce(v_example ->> 'justification', '')) then
      perform app_private.fail('INVALID_INPUT', 'O exemplo ainda contém dado pessoal. Oculte-o antes de projetar.');
    end if;
    v_clean := jsonb_build_object(
      'kind', 'example',
      'showCorrect', (p_payload ->> 'showCorrect')::boolean,
      'example', jsonb_build_object(
        'stage', v_example ->> 'stage', 'major', v_example -> 'major', 'minor', v_example -> 'minor',
        'calculation', coalesce(v_example ->> 'calculation', ''), 'answerText', coalesce(v_example ->> 'answerText', ''),
        'justification', coalesce(v_example ->> 'justification', ''), 'correct', (v_example ->> 'correct')::boolean
      )
    );
  else
    perform app_private.fail('INVALID_INPUT', 'Projeção inválida.');
  end if;

  insert into public.projection (session_id, payload, updated_at) values (v_session.id, v_clean, now())
  on conflict (session_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
end;
$$;

-- Escolha atual (sem os dados agregados), para a tela do professor.
create function public.get_projection_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_payload jsonb;
begin
  perform app_private.require_teacher();
  select * into v_session from public.sessions s where s.teacher_id = auth.uid() order by s.created_at desc limit 1;
  if not found then
    return '{"kind":"none"}'::jsonb;
  end if;
  select p.payload into v_payload from public.projection p where p.session_id = v_session.id;
  return coalesce(v_payload, '{"kind":"none"}'::jsonb);
end;
$$;

-- Visão para a TV: pode ser lida SEM login, só com o código. Devolve apenas conteúdo agregado ou o exemplo
-- já revisado; nunca apelidos nem identificadores. Distribuição só com 3+ respostas; respostas únicas viram "outras".
create function public.get_projection(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_payload jsonb;
  v_stage text;
  v_kind text;
  v_total integer;
  v_entries jsonb;
  v_others integer;
begin
  select * into v_session from public.sessions s
   where s.code = upper(btrim(coalesce(p_code, ''))) and s.retention_until > now()
   order by s.created_at desc limit 1;
  if not found then
    return '{"kind":"none"}'::jsonb;
  end if;
  select p.payload into v_payload from public.projection p where p.session_id = v_session.id;
  if v_payload is null or v_payload ->> 'kind' <> 'distribution' then
    return coalesce(v_payload, '{"kind":"none"}'::jsonb);
  end if;

  v_stage := v_payload ->> 'stage';
  v_kind := v_stage;  -- 'diagnostico' | 'hipotese' | 'tentativa' (1ª revisão) | 'saida'

  select count(*)::integer into v_total from public.submissions s
   where s.session_id = v_session.id and s.kind = v_kind and s.seq = 1;

  if v_total < 3 then
    return v_payload || jsonb_build_object('distribution', jsonb_build_object(
      'stage', v_stage, 'total', v_total, 'suppressed', true, 'entries', '[]'::jsonb, 'others', 0));
  end if;

  with groups as (
    select app_private.format_number(s.answer) || ' ' || s.unit as label, count(*)::integer as n, bool_and(s.correct) as ok
      from public.submissions s
     where s.session_id = v_session.id and s.kind = v_kind and s.seq = 1
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n, 'correct', ok) order by n desc, label collate "C") filter (where n >= 2), '[]'::jsonb),
         coalesce(sum(n) filter (where n < 2), 0)::integer
    into v_entries, v_others
    from groups;

  return v_payload || jsonb_build_object('distribution', jsonb_build_object(
    'stage', v_stage, 'total', v_total, 'suppressed', false, 'entries', v_entries, 'others', v_others));
end;
$$;

-- Exportação pedagógica ANÔNIMA: sem apelidos, sem textos livres, sem horários, sem identificadores.
-- Mesmo formato de buildExportRows()/buildExportSummary() (src/domain/aggregate.ts).
create function app_private.export_team(p_session uuid)
returns table (
  rn bigint, id uuid, fictitious boolean,
  has_d boolean, d_ok boolean, d_pat text,
  has_h boolean, h_ok boolean, h_pat text, h_hint smallint,
  has_x boolean, x_ok boolean, x_pat text,
  revs integer, revs_hint integer, rev_ok boolean, max_hint integer
)
language sql
stable
set search_path = ''
as $$
  select
    row_number() over (order by t.id), t.id, t.fictitious,
    (d.id is not null), coalesce(d.correct, false), d.pattern_id,
    (h.id is not null), coalesce(h.correct, false), h.pattern_id, h.hint_level,
    (x.id is not null), coalesce(x.correct, false), x.pattern_id,
    (select count(*) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa')::integer,
    (select count(*) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa' and a.hint_level > 0)::integer,
    coalesce((select bool_or(a.correct) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa'), false),
    app_private.max_hint(t.id)::integer
  from public.teams t
  left join public.submissions d on d.team_id = t.id and d.kind = 'diagnostico'
  left join public.submissions h on h.team_id = t.id and h.kind = 'hipotese'
  left join public.submissions x on x.team_id = t.id and x.kind = 'saida'
  where t.session_id = p_session
$$;

create function public.export_anonymous(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := app_private.teacher_session(p_code);
  v_rows jsonb;
  v_summary jsonb;
begin
  if v_session.id is null then
    return jsonb_build_object('linhas', '[]'::jsonb, 'resumo', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'equipe_anonima', 'E' || lpad(e.rn::text, 2, '0'),
    'ficticia', case when e.fictitious then 'sim' else 'nao' end,
    'diagnostico_correto', case when not e.has_d then '' when e.d_ok then 'sim' else 'nao' end,
    'diagnostico_padrao', coalesce(e.d_pat, ''),
    'hipotese_correta', case when not e.has_h then '' when e.h_ok then 'sim' else 'nao' end,
    'hipotese_padrao', coalesce(e.h_pat, ''),
    'hipotese_dica_nivel', coalesce(e.h_hint, 0),
    'revisoes', e.revs,
    'revisoes_com_dicas', e.revs_hint,
    'dica_maxima', e.max_hint,
    'acertou_apos_revisao', case when e.rev_ok then 'sim' else 'nao' end,
    'saida_correta', case when not e.has_x then '' when e.x_ok then 'sim' else 'nao' end,
    'saida_padrao', coalesce(e.x_pat, '')
  ) order by e.rn), '[]'::jsonb) into v_rows
  from app_private.export_team(v_session.id) e;

  select jsonb_build_object(
    'equipes', count(*),
    'diagnostico', jsonb_build_object('respondidas', count(*) filter (where has_d), 'corretas', count(*) filter (where has_d and d_ok)),
    'hipoteseInicial', jsonb_build_object('respondidas', count(*) filter (where has_h), 'corretas', count(*) filter (where has_h and h_ok)),
    'tentativas', jsonb_build_object(
      'total', coalesce(sum(revs), 0),
      'equipesComDicas', count(*) filter (where max_hint > 0),
      'dicasPorNivel', jsonb_build_object(
        '1', count(*) filter (where max_hint >= 1), '2', count(*) filter (where max_hint >= 2), '3', count(*) filter (where max_hint >= 3))
    ),
    'saida', jsonb_build_object('respondidas', count(*) filter (where has_x), 'corretas', count(*) filter (where has_x and x_ok)),
    'diagnosticoParaSaida', jsonb_build_object(
      'ambasCorretas', count(*) filter (where has_d and has_x and d_ok and x_ok),
      'diagnosticoErradoSaidaCerta', count(*) filter (where has_d and has_x and not d_ok and x_ok),
      'diagnosticoCertoSaidaErrada', count(*) filter (where has_d and has_x and d_ok and not x_ok),
      'ambasErradas', count(*) filter (where has_d and has_x and not d_ok and not x_ok))
  ) into v_summary
  from app_private.export_team(v_session.id);

  v_summary := v_summary || jsonb_build_object('trajetorias', coalesce((
    select jsonb_object_agg(k, n) from (
      select 'diag=' || case when not has_d then '-' when d_ok then 'certo' else 'errado' end
          || ';hip=' || case when not has_h then '-' when h_ok then 'certo' else 'errado' end
          || ';rev=' || revs
          || ';saida=' || case when not has_x then '-' when x_ok then 'certo' else 'errado' end as k,
             count(*)::integer as n
        from app_private.export_team(v_session.id) group by 1
    ) z
  ), '{}'::jsonb));

  return jsonb_build_object('linhas', v_rows, 'resumo', v_summary);
end;
$$;

-- ------------------------------------------------------------------ retenção (30 dias)

-- Exclui sessões vencidas (retention_until) e, em cascata, todos os dados brutos delas; apaga também tentativas
-- antigas de entrada e logins anônimos antigos. Executar por rotina agendada ou manualmente (service_role/postgres).
create function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions integer;
  v_attempts integer;
  v_anon integer := 0;
begin
  perform 1 from public.teams t join public.sessions s on s.id = t.session_id where s.retention_until < now() order by t.id for update of t;  -- mesma ordem de travas dos envios
  delete from public.sessions where retention_until < now();
  get diagnostics v_sessions = row_count;
  delete from public.join_attempts where at < now() - interval '1 day';
  get diagnostics v_attempts = row_count;
  begin
    delete from auth.users u where u.is_anonymous and u.created_at < now() - interval '30 days';
    get diagnostics v_anon = row_count;
  exception when insufficient_privilege then
    v_anon := -1;  -- sem permissão no schema auth neste ambiente
  end;
  return jsonb_build_object('sessoes_apagadas', v_sessions, 'tentativas_de_entrada_apagadas', v_attempts, 'logins_anonimos_apagados', v_anon);
end;
$$;
