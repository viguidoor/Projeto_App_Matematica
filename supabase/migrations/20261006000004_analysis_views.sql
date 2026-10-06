-- Operação Área, Etapa 2a: visões de análise para o professor (diagnóstico → hipótese inicial → revisões → saída).
-- security_invoker: valem as políticas de RLS de quem consulta, então só o professor da sessão enxerga as linhas.
-- Estas visões mostram apelidos (uso do professor). A exportação ANÔNIMA é public.export_anonymous().

create view public.v_trajetoria with (security_invoker = true) as
select
  t.session_id,
  t.id as team_id,
  t.alias,
  d.correct as diagnostico_correto, d.pattern_id as diagnostico_padrao, d.ms_since_phase_start as diagnostico_ms,
  h.correct as hipotese_correta,    h.pattern_id as hipotese_padrao,    h.hint_level as hipotese_dica,   h.ms_since_phase_start as hipotese_ms,
  (select count(*) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa') as revisoes,
  (select count(*) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa' and a.hint_level > 0) as revisoes_com_dicas,
  (select bool_or(a.correct) from public.submissions a where a.team_id = t.id and a.kind = 'tentativa') as acertou_em_revisao,
  coalesce((select max(e.level) from public.hint_events e where e.team_id = t.id), 0) as dica_maxima,
  x.correct as saida_correta,       x.pattern_id as saida_padrao,       x.ms_since_phase_start as saida_ms,
  (select min(ev.created_at) from public.team_events ev where ev.team_id = t.id) as primeiro_evento,
  (select max(ev.created_at) from public.team_events ev where ev.team_id = t.id) as ultimo_evento,
  -- tempo APROXIMADO entre o primeiro e o último evento (não mede atenção; sem cronômetro para o estudante)
  extract(epoch from (
    (select max(ev.created_at) from public.team_events ev where ev.team_id = t.id) -
    (select min(ev.created_at) from public.team_events ev where ev.team_id = t.id)
  ))::integer as tempo_aproximado_s
from public.teams t
left join public.submissions d on d.team_id = t.id and d.kind = 'diagnostico'
left join public.submissions h on h.team_id = t.id and h.kind = 'hipotese'
left join public.submissions x on x.team_id = t.id and x.kind = 'saida';

-- "Nova evidência" depois de cada intervenção: o primeiro registro da equipe feito DEPOIS dela.
create view public.v_apos_intervencao with (security_invoker = true) as
select
  i.id as intervencao_id,
  i.session_id,
  i.team_id,
  i.team_alias,
  i.difficulty as dificuldade_observada,
  i.intervention as pergunta_intervencao,
  i.response_after as resposta_apos_mediacao,
  i.created_at as intervencao_em,
  n.kind as registro_seguinte,
  n.seq as registro_seguinte_n,
  n.correct as registro_seguinte_correto,
  n.pattern_id as registro_seguinte_padrao,
  extract(epoch from (n.created_at - i.created_at))::integer as segundos_ate_o_registro
from public.interventions i
left join lateral (
  select s.* from public.submissions s
   where s.team_id = i.team_id and s.created_at > i.created_at
   order by s.created_at limit 1
) n on true;

grant select on public.v_trajetoria, public.v_apos_intervencao to authenticated;

-- Retenção planejada de 30 dias: agendar public.purge_expired_data() (ex.: pg_cron, se disponível no plano) ou
-- executá-la manualmente com a chave de serviço. Exemplo (NÃO executado aqui; depende da Etapa 2b):
--   select cron.schedule('operacao-area-retencao', '15 3 * * *', $$select public.purge_expired_data()$$);
