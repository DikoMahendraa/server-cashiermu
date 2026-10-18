# 17. Off-server backup with Cloudflare R2

The daily dump on the server (see [Deploying to a VPS](15-deployment.md)) only protects you from accidental deletion. If the
VPS breaks, the account is suspended, or the server is compromised, that dump is lost too. This document describes a second
copy on **Cloudflare R2**, how to protect it from deletion, and how to restore from it. Basic backup terms are in the
[Server learning guide](16-server-learning-guide.md).

## How it works

```
cron 03:00 WIB ─► backup.sh ─► pg_dump (in the db container) ─► ~/backups/cashiermu-<timestamp>.sql.gz   (kept 14 days)
                                                      └──► rclone copy ─► R2: cashiermu-backups   (locked 14 days, deleted after 30 days)
```

- `backup.sh` uses `rclone copy`, **not** `sync`. The script never deletes the copy in R2, so deleting a local dump does not
  delete the one in R2.
- File names contain the UTC time, so no file is ever overwritten.
- The copy to R2 only runs when `RCLONE_REMOTE` is set. Without it the script prints `WARNING: RCLONE_REMOTE not set`.

## 1. Set up R2

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**, named `cashiermu-backups`. Keep it private (the default).
2. **Manage API Tokens** → **Create API token**:
   - Permission **Object Read & Write**
   - **Specify bucket**: only `cashiermu-backups`
3. Store the **Access Key ID**, **Secret Access Key**, and **endpoint** (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) in a
   password manager. The secret is shown only once. Never put it in Git, chat, or screenshots.

## 2. Connect the server

On the server, as the `deploy` user:

```bash
sudo apt install -y rclone
rclone config            # n, name: r2, storage: s3, provider: Cloudflare, enter key and endpoint, leave acl empty
rclone config update r2 no_check_bucket true
```

`no_check_bucket` is needed because a token restricted to a single bucket is not allowed to create buckets, and rclone will
try to. Use interactive mode so the secret does not end up in your command history (`~/.bash_history`). The key is stored in
`~/.config/rclone/rclone.conf`; that file contains secrets and must not be copied anywhere.

Test:

```bash
echo test > /tmp/test.txt && rclone copy /tmp/test.txt r2:cashiermu-backups/ && rclone ls r2:cashiermu-backups
rclone delete r2:cashiermu-backups/test.txt && rm /tmp/test.txt
```

Run this test **before** enabling the bucket lock (section 4), because afterwards the test file cannot be deleted until its
lock period expires.

## 3. Schedule it

```bash
echo '0 20 * * * RCLONE_REMOTE=r2:cashiermu-backups /home/deploy/Server-CashierMu/deploy/backup.sh >> /home/deploy/backup.log 2>&1' | crontab -
crontab -l       # must be exactly one line
```

`0 20 * * *` in UTC is 03:00 WIB. The next day: `tail -5 ~/backup.log` should contain `copied off-server`, and
`rclone ls r2:cashiermu-backups` shows the new file.

## 4. Protect against deletion

An **Object Read & Write** token can write, read, **and delete** objects. R2 has no "write-only" token. This means that if the
server is compromised, an attacker who finds `rclone.conf` can delete every backup. The defense is the **bucket lock**, which
prevents objects from being deleted or overwritten for a set period, no matter who holds the token.

1. Dashboard → bucket `cashiermu-backups` → **Settings** → **Bucket lock rules** → **Add rule**.
2. Name `retain-14d`, empty prefix (the whole bucket), retention **14 days**.
3. **Lifecycle rule** (Settings → Object lifecycle rules): delete objects after **30 days**, so the bucket does not grow
   forever. The bucket lock takes precedence, so objects are not deleted before 14 days even if the lifecycle rule is shorter.
4. Verify the lock works, using a file that **already exists** in the bucket:

```bash
rclone delete r2:cashiermu-backups/cashiermu-<one-of-the-backups>.sql.gz
```

That command must **fail** (access denied error). If it succeeds, the lock is not active yet; do not consider the backups safe.

Things to keep in mind:

- The lock holds **all** objects, including files uploaded by mistake, for 14 days. That is why the test with a throwaway file
  happens before the lock.
- The bucket cannot be emptied while a lock rule exists. To delete the bucket, delete the rule first.
- The lock only protects against a leaked token. Anyone who can sign in to the **Cloudflare dashboard** can delete the lock
  rule, so enable **2FA** on the Cloudflare account and use a unique password.
- A 14-day retention means an attack that is discovered only after more than 14 days can still wipe out old backups. Raise the
  retention once the store data grows large (the cost is small, dumps are only a few MB).

## 5. Restore from R2

Worst case: the server is gone and you start from a new VPS.

1. Prepare the new server until Docker is running, following [Deploying to a VPS](15-deployment.md) until the empty database
   is up.
2. Install rclone and create the `r2` remote again. An **Object Read only** token is enough for this; create a new one in the
   dashboard.
3. Download the latest dump:

```bash
rclone lsl r2:cashiermu-backups | sort -k2,3 | tail -3          # find the latest
rclone copy r2:cashiermu-backups/cashiermu-<timestamp>.sql.gz ~/backups/
```

4. Restore (stop the API first so there are no new writes):

```bash
cd ~/Server-CashierMu/deploy
docker compose -f docker-compose.prod.yml stop api
gunzip -c ~/backups/cashiermu-<timestamp>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml up -d
curl -s https://api.cashiermu.com/health
```

5. Open the app, log in, and check the latest data (sales, stock).

**Practice this once before there are real stores**, on a test VPS or with `restore-test.sh`. A backup that has never been
restored is only a hope. Once a month, download one dump from R2 and run a restore test.

## 6. Routine

| When | What |
| ---- | ---- |
| Every morning (quick) | `tail -3 ~/backup.log` or check the uptime notification |
| Every month | Download one dump from R2, run a restore test |
| Every month | `rclone ls r2:cashiermu-backups` includes today's dump; check the size looks reasonable |
| When replacing the server | Create a new R2 token, **revoke the old token** in the dashboard |
| If `rclone.conf` or the server is suspected leaked | Revoke the R2 token immediately and create a new one |

## Common problems

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `AccessDenied` / `403` on `rclone copy` | The token does not cover the bucket, or `no_check_bucket` is not set | Recreate the token with the right bucket, run `rclone config update r2 no_check_bucket true` |
| `NoSuchBucket` | Wrong endpoint or bucket name | Check `rclone config show r2` (do not share the output, it contains keys) and the bucket name |
| `WARNING: RCLONE_REMOTE not set` | Cron does not load the variable | Make sure the cron line contains `RCLONE_REMOTE=r2:cashiermu-backups` |
| `backup.log` does not grow | Cron is not running, or is duplicated | `crontab -l`, must be one line |
| Cannot delete the test file | Bucket lock is active | Expected; wait for the retention period to end |
