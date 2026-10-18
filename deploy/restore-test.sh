#!/usr/bin/env bash
# Proves a backup can really be restored: loads a dump into a scratch database and counts what came back.
# It never touches the live "cashiermu" database. Run it after your first backup and then every few weeks.
#   ./restore-test.sh                 -> uses the newest dump in $BACKUP_DIR
#   ./restore-test.sh path/to/file.sql.gz
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
file="${1:-$(ls -1t "$BACKUP_DIR"/cashiermu-*.sql.gz 2>/dev/null | head -n1)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "no backup file found" >&2; exit 1; }
COMPOSE="docker compose -f docker-compose.prod.yml"
echo "restoring $file into a scratch database…"

$COMPOSE exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists restore_test && createdb -U "$POSTGRES_USER" restore_test'
gunzip -c "$file" | $COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q' > /dev/null

echo "rows restored:"
$COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_test -At -c "select '"'"'stores: '"'"' || count(*) from \"Store\"; select '"'"'users: '"'"' || count(*) from \"User\"; select '"'"'transactions: '"'"' || count(*) from \"Transaction\";"'

$COMPOSE exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_test'
echo "OK: the backup restores cleanly (scratch database removed)"
