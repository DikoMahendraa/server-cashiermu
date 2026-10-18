#!/usr/bin/env bash
# Nightly PostgreSQL backup: a compressed dump on this server (kept KEEP_DAYS days) and, if RCLONE_REMOTE is set,
# a copy off the server. A backup that only lives on the same disk as the database is not a backup.
#
# Cron (as the deploy user), every night at 02:30 server time:
#   30 2 * * * RCLONE_REMOTE=r2:cashiermu-backups /home/deploy/Server-CashierMu/deploy/backup.sh >> /var/log/cashiermu-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE="docker compose -f docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/cashiermu-$stamp.sql.gz"

# pg_dump runs INSIDE the database container, so no database port is ever opened to the host
$COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' | gzip -9 > "$file.tmp"

# Refuse to keep an empty or damaged dump
gzip -t "$file.tmp"
if [ "$(stat -c %s "$file.tmp" 2>/dev/null || stat -f %z "$file.tmp")" -lt 1000 ]; then
  echo "backup too small, something is wrong" >&2
  rm -f "$file.tmp"
  exit 1
fi
mv "$file.tmp" "$file"
echo "backup written: $file ($(du -h "$file" | cut -f1))"

find "$BACKUP_DIR" -name 'cashiermu-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$file" "$RCLONE_REMOTE" --quiet
  echo "copied off-server to $RCLONE_REMOTE"
else
  echo "WARNING: RCLONE_REMOTE not set, this backup exists only on this server" >&2
fi
