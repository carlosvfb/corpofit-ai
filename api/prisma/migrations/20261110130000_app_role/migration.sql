-- Papel restrito da aplicação para o Row Level Security.
-- O dono do banco em alguns provedores (Neon, por exemplo) tem BYPASSRLS, e então o RLS não valeria para ele.
-- `corpofit_app` não tem BYPASSRLS nem superusuário: as transações de academia/personal/biblioteca trocam para
-- ele (`SET LOCAL ROLE`, ver api/saas/org/context.js). Não tem LOGIN: só se chega a ele a partir do papel dono.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corpofit_app') THEN
    CREATE ROLE corpofit_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- O papel conectado precisa poder assumi-lo (necessário em versões do PostgreSQL em que o criador não recebe isso sozinho).
DO $$
BEGIN
  EXECUTE format('GRANT corpofit_app TO %I', current_user);
EXCEPTION WHEN others THEN
  NULL;
END $$;

GRANT USAGE ON SCHEMA public TO corpofit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO corpofit_app;

-- Tabelas criadas por migrações futuras também.
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO corpofit_app', current_user);
EXCEPTION WHEN others THEN
  NULL;
END $$;
