#!/bin/sh
# Etapa de build do serviço "api" na Vercel: aplica as migrações do PostgreSQL antes de publicar.
# Use MIGRATE_DATABASE_URL (conexão DIRETA, sem pooler) se o seu banco tiver pooler (ex.: Neon); sem ela
# usa DATABASE_URL. Uma migração que falha derruba o deploy, e a versão anterior segue no ar.
set -e
URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"
if [ -z "$URL" ]; then
  echo "DATABASE_URL ausente: configure o banco nas variaveis de ambiente do projeto." >&2
  exit 1
fi
DATABASE_URL="$URL" node node_modules/prisma/build/index.js migrate deploy
