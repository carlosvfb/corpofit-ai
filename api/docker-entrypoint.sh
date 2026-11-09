#!/bin/sh
# CorpoFit AI: aplica as migrações do PostgreSQL antes de subir a API, só em modo SaaS.
set -e
if [ "$SAAS_MODE" = "1" ] || [ "$SAAS_MODE" = "true" ]; then
  node node_modules/prisma/build/index.js migrate deploy
fi
exec "$@"
