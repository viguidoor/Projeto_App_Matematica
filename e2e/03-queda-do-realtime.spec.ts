import { expect, test } from '@playwright/test';
import { closeActors, compose, expectNoUnexpectedErrors, newActor, openSession, resetData, studentJoin, submitDiagnostic, teacherLogin, teamRow } from './helpers';

test.afterEach(() => {
  try {
    compose('start realtime'); // nunca deixa o serviço derrubado para os próximos testes
  } catch {
    /* já estava de pé */
  }
});

test('queda e recuperação do Realtime: o painel avisa, segue atualizando por consulta periódica e volta ao tempo real sozinho', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const b = await newActor(browser, 'equipe B');
  const c = await newActor(browser, 'equipe C');

  // evidência do tempo real: mudanças do banco que chegam ao navegador do professor pelo WebSocket
  const changeFrames: Array<{ at: number; frame: string }> = [];
  prof.page.on('websocket', (ws) => {
    if (!ws.url().includes('/realtime/v1/websocket')) return;
    ws.on('framereceived', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : f.payload.toString();
      if (/"type":"(INSERT|UPDATE|DELETE)"/.test(text) && /"record"/.test(text)) changeFrames.push({ at: Date.now(), frame: text });
    });
  });

  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await expect(prof.page.getByText('Conexão: Conectado')).toBeVisible();
  await studentJoin(b.page, code, 'Equipe B');
  await expect(teamRow(prof.page, 'Equipe B')).toContainText('Entrou');
  await expect.poll(() => changeFrames.length, { timeout: 10_000 }).toBeGreaterThan(0); // houve evento pelo tempo real

  await test.step('o serviço de tempo real cai: o painel mostra "Reconectando" e como verificar o servidor', async () => {
    compose('stop realtime');
    await expect(prof.page.getByText('Conexão: Reconectando…')).toBeVisible({ timeout: 30_000 });
    await expect(prof.page.getByText(/projeto do Supabase está ativo/)).toBeVisible();
    await expect(b.page.getByText(/Etapa 1\/4/)).toBeVisible(); // o estudante não depende do tempo real
  });

  await test.step('durante a queda, o painel continua recebendo as equipes (consulta periódica)', async () => {
    await studentJoin(c.page, code, 'Equipe C');
    await expect(teamRow(prof.page, 'Equipe C')).toContainText('Entrou', { timeout: 25_000 });
    await submitDiagnostic(b.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade.' });
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('20 m² ✔', { timeout: 25_000 });
  });

  const religadoEm = Date.now();
  await test.step('o serviço volta: o painel volta a "Conectado" sozinho e recebe eventos pelo tempo real de novo', async () => {
    compose('start realtime');
    await expect(prof.page.getByText('Conexão: Conectado')).toBeVisible({ timeout: 90_000 });
    await expect(prof.page.getByText(/projeto do Supabase está ativo/)).toHaveCount(0);
    // logo depois da volta nenhum evento se perde: o painel se atualiza (tempo real ou recarga de segurança)
    await b.page.getByRole('button', { name: /Aumentar diagonal maior/ }).click();
    await expect(teamRow(prof.page, 'Equipe B')).toContainText('Explorando', { timeout: 20_000 });
    // e, com o canal estabilizado, as próximas mudanças chegam pelo WebSocket (evidência do tempo real de volta)
    await prof.page.waitForTimeout(6_000);
    const antes = changeFrames.filter((f) => f.at > religadoEm).length;
    await b.page.getByRole('button', { name: /Diminuir diagonal maior/ }).click();
    await expect.poll(() => changeFrames.filter((f) => f.at > religadoEm).length, { timeout: 15_000 }).toBeGreaterThan(antes);
  });

  expectNoUnexpectedErrors([b, c]);
  // o professor pode ter erros de rede esperados (WebSocket recusado enquanto o serviço estava fora do ar)
  expectNoUnexpectedErrors([prof], [/WebSocket connection .* failed/, /Failed to load resource/, /ERR_/, /502|503|504/]);
  await closeActors(prof, b, c);
});
