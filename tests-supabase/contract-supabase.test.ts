import { afterAll, beforeAll } from 'vitest';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import { defineContract } from '../tests/contract/contract';
import { disposeAll, loginTeacher, newDevice, reloadDevice, resetData } from './world';

// Cada estudante é um DISPOSITIVO diferente (armazenamento próprio), todos atrás do mesmo IP (a rede da escola).
let teacher: SupabaseRepository;
beforeAll(async () => {
  await resetData();
  teacher = await loginTeacher('a');
});
afterAll(disposeAll);

defineContract('SupabaseRepository (CONECTADO, stack local)', async () => {
  await resetData();
  const devices = new Map<object, SupabaseRepository>();
  return {
    teacher,
    newStudent: () => {
      const d = newDevice();
      devices.set(d, d);
      return d;
    },
    reload: (s) => reloadDevice(s as SupabaseRepository),
  };
});
