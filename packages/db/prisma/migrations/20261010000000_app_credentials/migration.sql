-- Senha local do Jesus (decisão 0015). Gerado a partir do schema.prisma e completado à mão com o que o
-- Prisma não modela: as restrições e os privilégios (seção 5.3).

-- Papéis sem login. O login (com senha aleatória guardada no cofre) é ligado na instalação, fase 4.
-- Os papéis valem para o servidor inteiro; se já existirem (outro banco do mesmo servidor), segue em frente.
DO $$
BEGIN
  BEGIN
    CREATE ROLE jesus_app NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE ROLE jesus_config NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- CreateTable
CREATE TABLE "app_credentials" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "password_hash" TEXT NOT NULL,
    "recovery_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_credentials_pkey" PRIMARY KEY ("id"),
    -- Uma credencial só.
    CONSTRAINT "app_credentials_single_row" CHECK ("id" = 1),
    -- Só hashes bcrypt: um texto qualquer (ou uma senha em texto puro) não entra.
    CONSTRAINT "app_credentials_password_is_bcrypt" CHECK ("password_hash" ~ '^\$2[aby]\$[0-3][0-9]\$[./A-Za-z0-9]{53}$'),
    CONSTRAINT "app_credentials_recovery_is_bcrypt" CHECK ("recovery_hash" ~ '^\$2[aby]\$[0-3][0-9]\$[./A-Za-z0-9]{53}$'),
    CONSTRAINT "app_credentials_failed_attempts_nonnegative" CHECK ("failed_attempts" >= 0)
);

-- Só o processo principal (jesus_config) lê e grava; o papel do Cérebro e do Executor (jesus_app) não vê nada.
REVOKE ALL ON "app_credentials" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "app_credentials" TO jesus_config;
