#!/bin/sh
set -e

echo "==> Running prisma migrate deploy..."
npx prisma migrate deploy

echo "==> Starting API server..."
exec node dist/src/main.js
