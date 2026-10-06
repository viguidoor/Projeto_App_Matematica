import { expect, test } from '@playwright/test';
import {
  closeActors,
  dbCount,
  expectNoUnexpectedErrors,
  fillAnswer,
  goToFinalAndFinish,
  newActor,
  openSession,
  resetData,
  studentJoin,
  submitDiagnostic,
  submitInitialHypothesis,
  teacherLogin,
  teamRow,
  withDb,
} from './helpers';
import { readFileSync } from 'node:fs';

/**
 * Percurso completo, com navegadores INDEPENDENTES e o servidor REAL (stack local, sem mocks):
 * professor · equipe A · equipe B · equipe C · projeção sem login.
 */
test('professor cria a sessão → equipes entram → diagnóstico → exploração → hipótese sem dicas → dicas → revisão → saída → intervenção → projeção aprovada → encerramento', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  const b = await newActor(browser, 'equipe B');
  const c = await newActor(browser, 'equipe C');
  const tv = await newActor(browser, 'projeção (sem login)');
  const actors = [prof, a, b, c, tv];

  // O que a projeção recebe do servidor (todas as respostas de rede): conferido no fim.
  const tvBodies: string[] = [];
  tv.page.on('response', async (r) => {
    if (/\/rest\/v1\/|\/auth\/v1\//.test(r.url())) tvBodies.push(await r.text().catch(() => ''));
  });

  let code = '';

  await test.step('professor entra, abre a sessão e recebe o código (a página nunca será recarregada daqui em diante)', async () => {
    await teacherLogin(prof.page);
    await expect(prof.page.getByText('CONECTADO', { exact: true })).toBeVisible();
    code = await openSession(prof.page);
    await expect(prof.page.getByText(/serão apagados automaticamente em/)).toBeVisible(); // aviso de retenção (30 dias)
    await prof.page.evaluate(() => ((window as unknown as { __vivo: string }).__vivo = 'mesma-pagina'));
  });

  await test.step('a projeção (sem login) abre com o código e ainda não mostra nada', async () => {
    await tv.page.goto(`/#/projecao?codigo=${code}`);
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible();
    await expect(tv.page.getByRole('button')).toHaveCount(0); // sem login, sem controles
    await expect(tv.page.getByText(/Painel do professor/)).toHaveCount(0);
  });

  await test.step('três equipes entram pelo código, em navegadores diferentes; o painel mostra cada uma sem recarregar', async () => {
    await studentJoin(a.page, code, 'Equipe A');
    await expect(a.page.getByText(/Missão 1 — Jardim Geométrico · Etapa 1\/4 · Diagnóstico/)).toBeVisible();
    await expect(a.page.getByText('CONECTADO', { exact: true })).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Entrou');
    await studentJoin(b.page, code, 'Equipe B');
    await studentJoin(c.page, code, 'Equipe C');
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('Entrou');
    await expect(teamRow(prof.page, 'Equipe C')).toContainText('Entrou');
    await expect(prof.page.getByText('Estados das equipes (3)')).toBeVisible();
  });

  await test.step('diagnóstico (sem dicas e sem correção para a equipe); o professor vê as respostas', async () => {
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    await submitDiagnostic(a.page, { calc: '8 x 5', answer: '40', why: 'Multipliquei as diagonais.' });
    await submitDiagnostic(b.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
    await submitDiagnostic(c.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade.' });
    await expect(a.page.getByText(/Confere|Ainda não confere/)).toHaveCount(0); // diagnóstico não devolve acerto
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('40 m² ✎');
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('20 m² ✔');
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Fez o diagnóstico');
  });

  await test.step('exploração: o painel marca "Explorando"; as dicas continuam bloqueadas', async () => {
    await expect(a.page.getByText(/As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial/)).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    await a.page.getByRole('button', { name: /Aumentar diagonal maior/ }).click();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Explorando');
    await a.page.getByRole('button', { name: /Diminuir diagonal maior/ }).click(); // volta a D = 10 m
    await expect(a.page.getByRole('button', { name: /Registrar hipótese inicial com D = 10 m e d = 6 m/ })).toBeVisible();
    await expect(a.page.getByText(/Etapa 2\/4 · Hipótese inicial/)).toBeVisible();
  });

  await test.step('hipótese inicial SEM dicas (equipe A erra; B e C: uma certa, uma errada); o professor vê o padrão como hipótese pedagógica', async () => {
    await submitInitialHypothesis(a.page, { calc: '10 x 6', answer: '60', why: 'Eu, Maria Souza, multipliquei as diagonais.' });
    await submitInitialHypothesis(b.page, { calc: '10 x 6 : 2', answer: '30', why: 'metade' }); // justificativa curta e válida
    await submitInitialHypothesis(c.page, { calc: '10 x 6', answer: '60', why: 'Multiplicamos as diagonais.' });
    await expect(a.page.getByText(/Vocês multiplicaram as duas diagonais/)).toBeVisible();
    await expect(b.page.getByText(/Confere/)).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('60 m² ✎');
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('30 m² ✔');
    await prof.page.getByRole('button', { name: /Ver.*detalhes de Equipe A/ }).click();
    await expect(prof.page.getByText(/Hipótese pedagógica:.*possível omissão da divisão por 2/).first()).toBeVisible();
    await prof.page.getByRole('button', { name: /Ocultar.*detalhes de Equipe A/ }).click();
  });

  await test.step('só agora as dicas são liberadas, uma por vez e só se pedidas', async () => {
    await expect(a.page.getByText(/Dica 1:/)).toHaveCount(0);
    await a.page.getByRole('button', { name: 'Pedir a dica 1 de 3' }).click();
    await expect(a.page.getByText('Dica 1: identifiquem as diagonais')).toBeVisible();
    await expect(a.page.getByText(/Dica 2:/)).toHaveCount(0);
    await expect(a.page.getByRole('button', { name: 'Pedir a dica 2 de 3' })).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Pediu dica');
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('1 de 3');
  });

  await test.step('o professor registra a intervenção (dificuldade → pergunta → resposta) e a equipe A revisa', async () => {
    await prof.page.getByLabel('Equipe', { exact: true }).selectOption({ label: 'Equipe A' });
    await prof.page.getByRole('textbox', { name: 'Dificuldade observada' }).fill('Esqueceram a divisão por 2');
    await prof.page.getByRole('textbox', { name: 'Pergunta ou intervenção' }).fill('Como o losango se relaciona ao retângulo que o envolve?');
    await prof.page.getByRole('textbox', { name: 'Resposta após a mediação' }).fill('Perceberam que é a metade');
    await prof.page.getByRole('button', { name: 'Salvar nota' }).click();
    await expect(prof.page.getByText(/Perceberam que é a metade/)).toBeVisible();
    expect(await dbCount(`select count(*)::int as n from public.interventions where team_alias = 'Equipe A'`)).toBe(1);

    await a.page.waitForTimeout(1_100); // a revisão vem DEPOIS da intervenção
    await a.page.getByRole('button', { name: 'Nova tentativa' }).click();
    await expect(a.page.getByRole('heading', { name: /Revisão: explorem o jardim de novo/ })).toBeVisible();
    await expect(a.page.getByText(/Etapa 3\/4 · Tentativas e revisões/)).toBeVisible();
    await expect(a.page.getByText('Dica 1: identifiquem as diagonais')).toBeVisible(); // a dica já aberta continua visível
    await a.page.getByRole('button', { name: /Registrar nova tentativa/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Tentativa 1 da equipe' })).toBeVisible();
    await fillAnswer(a.page, { calc: '10 x 6 : 2', answer: '30', why: 'É metade do retângulo.' });
    await a.page.getByRole('button', { name: 'Enviar tentativa' }).click();
    await expect(a.page.getByRole('heading', { name: 'Devolutiva da tentativa 1' })).toBeVisible();
    await expect(a.page.getByText(/a área do jardim é 30 m²/)).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('1 (última: 30 m² ✔)');

    // "nova evidência" depois da intervenção: o primeiro registro da equipe feito depois dela
    const evid = await withDb(async (db) => (await db.query(`select registro_seguinte, registro_seguinte_correto from public.v_apos_intervencao where team_alias = 'Equipe A'`)).rows);
    expect(evid).toEqual([{ registro_seguinte: 'tentativa', registro_seguinte_correto: true }]);
  });

  await test.step('problema final (sem dicas) das equipes A e B; o painel marca "Concluiu"', async () => {
    await goToFinalAndFinish(a.page, { calc: '12 x 4 : 2', answer: '24', why: 'Metade do produto.' });
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    await goToFinalAndFinish(b.page, { calc: '12 x 4 : 2', answer: '24', why: 'metade' });
    await expect(a.page.getByText(/A área do canteiro é 24 m²/)).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Concluiu');
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('Concluiu');
    await expect(prof.page.getByText('Concluiu: 2')).toBeVisible();
  });

  await test.step('projeção: só conteúdo aprovado pelo professor (distribuição agregada, nunca apelidos)', async () => {
    await expect(tv.page.getByText('Aguardando o professor escolher o que mostrar.')).toBeVisible(); // nada aprovado até aqui
    await prof.page.getByRole('button', { name: 'Distribuição: Hipótese inicial' }).click();
    await expect(tv.page.getByRole('heading', { name: 'Hipótese inicial: respostas da turma' })).toBeVisible();
    await expect(tv.page.getByText('60 m²')).toBeVisible();
    await expect(tv.page.getByText('2 de 3 equipes')).toBeVisible();
    await expect(tv.page.getByText(/Equipe [ABC]/)).toHaveCount(0);
  });

  await test.step('projeção de um exemplo: o professor revisa e oculta o nome ANTES de projetar', async () => {
    await prof.page.getByRole('button', { name: /Ver.*detalhes de Equipe A/ }).click();
    await prof.page.getByRole('button', { name: /Revisar e projetar como exemplo.*Hipótese inicial/ }).click();
    const preview = prof.page.locator('.preview-box');
    await expect(preview).toContainText('[oculto]'); // detector já oculta "Maria" e "Souza"
    await expect(preview).not.toContainText(/Maria|Souza/);
    await expect(prof.page.getByRole('button', { name: 'Projetar este exemplo' })).toBeDisabled(); // exige confirmação
    await prof.page.getByRole('checkbox', { name: /Revisei o texto/ }).check();
    await prof.page.getByRole('button', { name: 'Projetar este exemplo' }).click();
    await expect(tv.page.getByRole('heading', { name: /Exemplo para discutir/ })).toBeVisible();
    await expect(tv.page.getByText(/\[oculto\]/)).toBeVisible();
    await expect(tv.page.locator('body')).not.toContainText(/Maria|Souza|Equipe A|Equipe B|Equipe C/);
  });

  await test.step('exportação anônima baixada pelo painel: sem apelidos, textos livres, horários nem identificadores', async () => {
    const [download] = await Promise.all([prof.page.waitForEvent('download'), prof.page.getByRole('button', { name: 'Baixar JSON' }).click()]);
    const data = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(data.modo).toBe('CONECTADO');
    expect(data.resumo.equipes).toBe(3);
    expect(data.resumo.hipoteseInicial).toEqual({ respondidas: 3, corretas: 1 });
    expect(data.resumo.saida).toEqual({ respondidas: 2, corretas: 2 });
    const teams = await withDb(async (db) => (await db.query('select id, alias from public.teams')).rows);
    const { geradoEm, ...semDataDeGeracao } = data; // só a data da própria exportação; nenhum horário de atividade
    expect(geradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const text = JSON.stringify(semDataDeGeracao);
    for (const t of teams) {
      expect(text).not.toContain(t.id);
      expect(text).not.toContain(t.alias);
    }
    // textos livres digitados pelas equipes (o rótulo de categoria "produto_sem_metade" é permitido)
    expect(text.match(/Maria|Souza|"metade"|Metade do produto|É metade|Multipliquei|Multiplicamos|T\d{2}:\d{2}/i)?.[0]).toBeUndefined();
  });

  await test.step('o professor encerra a sessão; a equipe C, ainda ativa, é avisada e não consegue mais enviar', async () => {
    await prof.page.getByRole('button', { name: 'Encerrar sessão' }).click();
    await expect(prof.page.getByText(/Sessão encerrada às/)).toBeVisible();
    await expect(c.page.getByText('A sessão foi encerrada pelo professor.')).toBeVisible({ timeout: 40_000 });
    await c.page.getByRole('button', { name: 'Nova tentativa' }).click();
    await expect(c.page.getByText(/A sessão foi encerrada pelo professor/).last()).toBeVisible();
    await expect(c.page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible(); // continua onde estava
    expect(await dbCount(`select count(*)::int as n from public.submissions s join public.teams t on t.id = s.team_id where t.alias = 'Equipe C'`)).toBe(2); // diagnóstico + hipótese: nada novo
  });

  await test.step('prova final: o painel do professor nunca foi recarregado e ninguém teve erro inesperado', async () => {
    expect(await prof.page.evaluate(() => (window as unknown as { __vivo?: string }).__vivo)).toBe('mesma-pagina');
    // a projeção só recebeu conteúdo agregado ou o exemplo revisado: nunca apelidos nem o texto original
    const all = tvBodies.join('\n');
    expect(all).toContain('[oculto]'); // o exemplo aprovado chegou, com o nome já oculto
    expect(all).not.toMatch(/Equipe [ABC]|Maria|Souza/); // nenhum apelido nem nome
    expect(all).not.toMatch(/Multipliquei as diagonais\.|Multiplicamos|"metade"|É metade|Metade do produto/); // nenhum texto NÃO aprovado
    expectNoUnexpectedErrors([prof, a, b, tv]);
    // a equipe C só tem a recusa 400 que o teste provocou de propósito (envio depois do encerramento)
    expect(c.errors).toEqual([expect.stringMatching(/server responded with a status of 400/)]);
  });

  await closeActors(...actors);
});
