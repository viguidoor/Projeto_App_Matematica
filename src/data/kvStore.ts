export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Avisa mudanças feitas aqui ou (no navegador) em outra aba do mesmo navegador. */
  subscribe(listener: () => void): () => void;
  /** false quando o armazenamento do navegador não está disponível (dados só na memória). */
  readonly persistent: boolean;
}

export class MemoryStore implements KeyValueStore {
  readonly persistent = false;
  private data = new Map<string, string>();
  private listeners = new Set<() => void>();

  get(key: string) {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.data.set(key, value);
    this.notify();
  }
  remove(key: string) {
    this.data.delete(key);
    this.notify();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    this.listeners.forEach((l) => l());
  }
}

/**
 * localStorage do navegador. O evento `storage` sincroniza ABAS DO MESMO NAVEGADOR;
 * não existe sincronização entre navegadores ou dispositivos diferentes (isso é a Etapa 2).
 */
export class LocalStorageStore implements KeyValueStore {
  readonly persistent: boolean;
  private fallback = new MemoryStore();
  private listeners = new Set<() => void>();

  constructor() {
    let ok = false;
    try {
      const probe = '__operacao_area_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      ok = true;
    } catch {
      ok = false;
    }
    this.persistent = ok;
    if (ok) window.addEventListener('storage', () => this.notify());
    else this.fallback.subscribe(() => this.notify());
  }

  get(key: string) {
    return this.persistent ? window.localStorage.getItem(key) : this.fallback.get(key);
  }
  set(key: string, value: string) {
    if (!this.persistent) return this.fallback.set(key, value);
    window.localStorage.setItem(key, value);
    this.notify();
  }
  remove(key: string) {
    if (!this.persistent) return this.fallback.remove(key);
    window.localStorage.removeItem(key);
    this.notify();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    this.listeners.forEach((l) => l());
  }
}
