/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND?: 'demo' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  /** Chave PÚBLICA (anon/publishable). A chave secreta/service_role nunca entra no aplicativo. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
