#!/usr/bin/env bash
# Ежедневный бэкап CRM: PostgreSQL + uploads
# Использование: APP_DIR=/path/to/site ./backup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/www-root/data/www/155.212.175.33}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/crm-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date +%F_%H%M)

# По умолчанию как в .env.example; при других данных задайте переменные окружения
DB_USER="${DB_USER:-crm}"
DB_PASS="${DB_PASS:-crm}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-crm_base}"

DEST="${BACKUP_ROOT}/${STAMP}"
mkdir -p "$DEST"

export PGPASSWORD="$DB_PASS"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c -f "${DEST}/crm_base.dump"
unset PGPASSWORD

if [[ -d "${APP_DIR}/backend/uploads" ]]; then
  tar -czf "${DEST}/uploads.tar.gz" -C "${APP_DIR}/backend" uploads
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"${KEEP_DAYS}" -exec rm -rf {} +

echo "OK backup -> ${DEST}"
ls -lh "$DEST"
