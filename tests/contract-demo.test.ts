import { MemoryStore } from '../src/data/kvStore';
import { DemoRepository } from '../src/data/demoRepository';
import { defineContract } from './contract/contract';

// No modo DEMONSTRAÇÃO, professor e estudantes compartilham o mesmo navegador (mesmo repositório).
defineContract('DemoRepository (DEMONSTRAÇÃO)', async () => {
  let t = 1_700_000_000_000;
  const repo = new DemoRepository(new MemoryStore(), { now: () => (t += 1000), random: () => Math.random() });
  return { teacher: repo, newStudent: () => repo, reload: (s) => s };
});
