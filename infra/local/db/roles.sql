\set pgpass `echo "$POSTGRES_PASSWORD"`
-- Define a senha só dos papéis que a imagem criou (varia entre versões da imagem).
SELECT format('ALTER ROLE %I WITH PASSWORD %L', rolname, :'pgpass')
FROM pg_roles
WHERE rolname IN ('authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin', 'supabase_storage_admin')
\gexec
