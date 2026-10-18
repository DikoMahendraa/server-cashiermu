# Deploying to a VPS

The whole production stack runs from one folder, `deploy/`, with Docker Compose:

```
internet ──443──► Caddy (HTTPS, certificates) ──► API (Node) ──► PostgreSQL
                                                    │
                          volumes: db-data, api-logs, caddy-data (certificates)
```

Only ports 22 (SSH), 80 and 443 are open. The database has **no** published port. `/metrics` is hidden from the internet.

Needs: a Linux VPS (Ubuntu 22.04/24.04, KVM, root access, public IPv4), 2 GB RAM or more, and a DNS record for the API address.
The runbook assumes `api.cashiermu.com`; the landing page stays on `cashiermu.com`.

## 1. DNS (once)

Where `cashiermu.com`'s DNS is managed, add an **A record**: name `api`, value = the VPS's IPv4. Check it from your laptop:

```bash
dig +short api.cashiermu.com     # must print the VPS IP before you start Caddy
```

## 2. First login and hardening (once)

Log in as root with the details from your provider, then:

```bash
adduser deploy && usermod -aG sudo deploy          # a normal user for daily work
# on YOUR laptop: ssh-copy-id deploy@<VPS-IP>      # then confirm  ssh deploy@<VPS-IP>  works WITHOUT a password
```

Only after the key login works, back on the server:

On Ubuntu 22.04/24.04 the files in `/etc/ssh/sshd_config.d/` are read **before** the main config and the first value wins, so a
cloud image's own file (for example `50-cloud-init.conf`) can quietly keep password login on. Put our rules in a file that sorts first:

```bash
printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/00-hardening.conf
sudo sshd -t && sudo systemctl restart ssh
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication) '     # must print: no / no
# keep this session open, open a NEW terminal and confirm  ssh deploy@<VPS-IP>  still works before closing anything

sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw --force enable
sudo apt update && sudo apt install -y fail2ban unattended-upgrades git
sudo dpkg-reconfigure -plow unattended-upgrades    # answer Yes: automatic security updates
```

**Swap (do this on 2 GB servers; harmless on 4 GB).** Building the image can briefly need more memory than 2 GB; swap stops the build from being killed:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Install Docker (once)

```bash
curl -fsSL https://get.docker.com | sudo sh       # Docker's official installer; read it first if you like
sudo usermod -aG docker deploy                    # then log out and back in
docker compose version
```

## 4. Get the code (once)

The repository is private, so use a read-only **deploy key**:

```bash
ssh-keygen -t ed25519 -C "cashiermu-vps" -f ~/.ssh/cashiermu_deploy -N ""
cat ~/.ssh/cashiermu_deploy.pub                   # GitHub → repo → Settings → Deploy keys → Add (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/cashiermu_deploy\n' >> ~/.ssh/config
git clone git@github.com:DikoMahendraa/Server-CashierMu.git && cd Server-CashierMu/deploy
```

## 5. Configure

```bash
cp .env.example .env && chmod 600 .env
openssl rand -hex 32      # run three times: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (all different)
openssl rand -hex 16      # METRICS_TOKEN
nano .env                 # fill them in; check API_DOMAIN, PUBLIC_BASE_URL, FRONTEND_ORIGIN
```

The API refuses to start with weak, example or identical secrets, so a typo fails loudly instead of running unsafe.

## 6. First deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy   # creates the tables
docker compose -f docker-compose.prod.yml ps                                       # db, api, caddy all "running/healthy"
curl -s https://api.cashiermu.com/health                                          # {"status":"ok",...}
```

Caddy fetches the HTTPS certificate on the first request (a few seconds). If it fails, the DNS record is usually not
pointing at the server yet (`docker compose -f docker-compose.prod.yml logs caddy`).

Then in the **app**: build with `EXPO_PUBLIC_API_URL=https://api.cashiermu.com/api/v1` (production profile in `eas.json` or the
EAS environment variables), register a test store, sell something, and open `https://api.cashiermu.com/r/<token>` from a receipt link.

## 7. Backups (do this the same day)

```bash
chmod +x backup.sh restore-test.sh
./backup.sh                                       # first dump, in ~/backups
./restore-test.sh                                 # proves it restores (uses a scratch database, never the live one)
crontab -e                                        # add the nightly job from the top of backup.sh
```

Copy dumps **off the server**: install [rclone](https://rclone.org), connect a Cloudflare R2 or Backblaze B2 bucket
(`rclone config`), and set `RCLONE_REMOTE=remote:bucket` in the cron line. A dump on the same disk is not a backup.

## 8. Updating to a new version

```bash
cd ~/Server-CashierMu && git pull
cd deploy
./backup.sh                                                                        # always back up first
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy   # only does something if there are new migrations
curl -s https://api.cashiermu.com/health
```

**Rolling back:** `git checkout <previous tag>` and rebuild. If the new version ran a migration, restore the pre-update dump
instead of just switching code back (`gunzip -c ~/backups/<file>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U cashiermu -d cashiermu`
after stopping the API).

## 9. Monitoring

Use Grafana Cloud's free tier (see `docs/13-monitoring.md`): run Alloy next to the API with `monitoring/alloy/config.cloud.alloy`,
scraping `api:3000/metrics` with `METRICS_TOKEN`, and mount the `api-logs` volume for logs. Attach a contact point to the alerts.
Also add an external uptime check on `https://api.cashiermu.com/health` (UptimeRobot or Better Stack, free).

## Useful commands

```bash
docker compose -f docker-compose.prod.yml logs -f api        # live API logs
docker compose -f docker-compose.prod.yml restart api
docker stats --no-stream                                     # memory/CPU per container
df -h /                                                      # disk (watch it: images, logs and backups grow)
```

## Sizing

| Plan | Fits? |
| ---- | ----- |
| 1 vCPU, 2 GB RAM, 25 GB | Runs the stack and a pilot. Tight while building (use the swap above) and the disk fills over time; watch `df -h`. |
| 1 vCPU, 4 GB RAM, 50 GB | Comfortable for the pilot and the first stores. Recommended start. |
| 2 vCPU, 4 GB RAM | Next step when p95 latency or CPU stays high on the Grafana dashboard. |

One server is a single point of failure: when it is down, stores can still sell (offline mode) and everything syncs afterwards.
