import { expect, test, type Page } from '@playwright/test';
import { ENV, TEACHERS, closeActors, expectNoUnexpectedErrors, newActor, openSession, resetData, studentApi, studentJoin, submitDiagnostic, teacherLogin, teamRow } from './helpers';

/** Chamada ao servidor SEM login nenhum (só a chave pública), a partir de uma página do aplicativo. */
async function anonApi(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ({ url, key, path, init }) => {
      const res = await fetch(`${url}${path}`, {
        method: init.method ?? 'GET',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* vazio */
      }
      return { status: res.status, json };
    },
    { url: ENV.url, key: ENV.anonKey, path, init },
  );
}

test('estudante tentando acessar rota e painel do professor, e projeção sem autenticação', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  const tv = await newActor(browser, 'projeção sem login');
  const outro = await newActor(browser, 'professor B');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');
  await submitDiagnostic(a.page, { calc: '8 x 5', answer: '40', why: 'Multipliquei as diagonais.' });
  await expect(teamRow(prof.page, 'Equipe A')).toContainText('40 m² ✎');
  await prof.page.getByLabel('Equipe', { exact: true }).selectOption({ label: 'Equipe A' });
  await prof.page.getByRole('textbox', { name: 'Dificuldade observada' }).fill('NOTA PRIVADA DO PROFESSOR');
  await prof.page.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(prof.page.getByText('NOTA PRIVADA DO PROFESSOR')).toBeVisible();

  await test.step('o estudante abre a rota do professor: só vê o login; nada do painel, das equipes ou das notas', async () => {
    await a.page.goto('/#/professor');
    await expect(a.page.getByRole('form', { name: 'Login do professor' })).toBeVisible();
    await expect(a.page.getByText('Entre com a conta docente')).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Abrir sessão|Encerrar sessão|Apagar esta sessão/ })).toHaveCount(0);
    await expect(a.page.getByRole('table')).toHaveCount(0);
    await expect(a.page.locator('body')).not.toContainText(/NOTA PRIVADA|Equipe A|Estados das equipes|Baixar JSON/);
    await expect(a.page.locator('.session-code')).toHaveCount(0);
  });

  await test.step('conta de e-mail que NÃO está na lista de professores também não entra', async () => {
    await a.page.getByLabel('E-mail da conta docente').fill(TEACHERS.outsider.email);
    await a.page.getByLabel('Senha').fill(TEACHERS.outsider.password);
    await a.page.getByRole('button', { name: 'Entrar como professor' }).click();
    await expect(a.page.getByText('Esta conta não tem permissão de professor.')).toBeVisible();
    await a.page.getByLabel('Senha').fill('senha-errada');
    await a.page.getByLabel('E-mail da conta docente').fill(TEACHERS.a.email);
    await a.page.getByRole('button', { name: 'Entrar como professor' }).click();
    await expect(a.page.getByText('E-mail ou senha incorretos.')).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole('form', { name: 'Login do professor' })).toBeVisible(); // continua sem acesso
  });

  await test.step('chamando o servidor diretamente com o login do estudante: tudo do professor é recusado e nenhuma tabela mostra dados', async () => {
    await a.page.goto('/#/');
    await expect(a.page.getByText('Equipe: Equipe A')).toBeVisible(); // a equipe continua de pé
    for (const [fn, body] of [
      ['list_teams', { p_code: code }],
      ['create_session', {}],
      ['close_session', { p_code: code }],
      ['delete_session', { p_code: code }],
      ['list_notes', { p_code: code }],
      ['export_anonymous', { p_code: code }],
      ['set_projection', { p_payload: { kind: 'distribution', stage: 'saida', showCorrect: true } }],
    ] as const) {
      const r = await studentApi(a.page, `/rest/v1/rpc/${fn}`, { method: 'POST', body });
      expect(r.status, fn).toBe(400);
      expect(r.json, fn).toMatchObject({ hint: 'NOT_AUTHORIZED' });
    }
    for (const t of ['teams', 'submissions', 'sessions', 'interventions', 'hint_events', 'team_events', 'projection', 'teachers', 'v_trajetoria']) {
      const r = await studentApi(a.page, `/rest/v1/${t}?select=*`);
      expect(r.status, t).toBe(200);
      expect(r.json, t).toEqual([]); // a RLS devolve zero linhas
    }
    const promote = await studentApi(a.page, '/rest/v1/teachers', { method: 'POST', body: { user_id: '00000000-0000-4000-8000-000000000001' } });
    expect([401, 403]).toContain(promote.status);
    expect(promote.json).toMatchObject({ code: '42501' });
    expect((await studentApi(a.page, '/rest/v1/rpc/purge_expired_data', { method: 'POST', body: {} })).status).toBeGreaterThanOrEqual(401);
    // e o professor continua com tudo no lugar
    await expect(prof.page.getByText('NOTA PRIVADA DO PROFESSOR')).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toBeVisible();
  });

  await test.step('um segundo professor (outra conta) entra e NÃO vê nada da sessão do primeiro', async () => {
    await teacherLogin(outro.page, 'b');
    await expect(outro.page.getByText('Nenhuma sessão aberta')).toBeVisible();
    await expect(outro.page.getByRole('table')).toHaveCount(0);
    await expect(outro.page.locator('body')).not.toContainText(/NOTA PRIVADA|Equipe A/);
  });

  await test.step('projeção SEM login: abre só com o código, não oferece controles e nada além do que o professor aprovar', async () => {
    await tv.page.goto(`/#/projecao?codigo=${code}`);
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible();
    await expect(tv.page.getByRole('button')).toHaveCount(0);
    await expect(tv.page.locator('body')).not.toContainText(/Equipe A|NOTA PRIVADA|Painel do professor/);
    await tv.page.goto('/#/projecao'); // sem código: nada
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible();
    await tv.page.goto('/#/projecao?codigo=ZZZZZZ'); // código inexistente: nada, sem revelar nada
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible();
    // e, sem login, o servidor só entrega a projeção
    await tv.page.goto(`/#/projecao?codigo=${code}`);
    expect((await anonApi(tv.page, '/rest/v1/rpc/get_projection', { method: 'POST', body: { p_code: code } })).json).toEqual({ kind: 'none' });
    for (const t of ['teams', 'submissions', 'interventions', 'teachers']) {
      const r = await anonApi(tv.page, `/rest/v1/${t}?select=*`);
      expect([401, 403]).toContain(r.status);
      expect(r.json).toMatchObject({ code: '42501' });
    }
    const noTeam = '00000000-0000-4000-8000-000000000001';
    for (const [fn, body] of [
      ['list_teams', { p_code: code }],
      ['join_session', { p_code: code, p_alias: 'Equipe Intrusa' }],
      ['get_team', { p_team: noTeam }],
      ['export_anonymous', { p_code: code }],
      ['create_session', {}],
      ['submit_diagnostic', { p_team: noTeam, p_calculation: 'abc', p_raw_answer: '1', p_unit: 'm²', p_justification: 'ab' }],
    ] as const) {
      const r = await anonApi(tv.page, `/rest/v1/rpc/${fn}`, { method: 'POST', body });
      expect([401, 403], fn).toContain(r.status);
      expect(r.json, fn).toMatchObject({ code: '42501' });
    }
  });

  await test.step('a projeção só passa a mostrar algo quando o professor aprova', async () => {
    await prof.page.getByRole('button', { name: 'Distribuição: Diagnóstico' }).click();
    await expect(tv.page.getByRole('heading', { name: 'Diagnóstico: respostas da turma' })).toBeVisible();
    await expect(tv.page.getByText(/Aguardando mais respostas/)).toBeVisible(); // 1 resposta: abaixo do mínimo de 3 equipes
    await expect(tv.page.locator('body')).not.toContainText(/Equipe A|40 m²/); // nem a resposta individual aparece
    await prof.page.getByRole('button', { name: 'Parar projeção' }).click();
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible();
  });

  expectNoUnexpectedErrors([prof, tv, outro], [/Failed to load resource: the server responded with a status of (401|403)/]);
  // o estudante provocou recusas de propósito (400/401/403 do servidor, e o login recusado)
  expectNoUnexpectedErrors([a], [/Failed to load resource: the server responded with a status of 4\d\d/]);
  await closeActors(prof, a, tv, outro);
});
