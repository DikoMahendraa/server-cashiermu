# 18. Production monitoring: UptimeRobot and Grafana Cloud

Two complementary layers:

| Layer | Answers | Runs on |
| ----- | ------- | ------- |
| **UptimeRobot** | "Is the server up?" | Outside the server (if the server dies completely, it still notifies you) |
| **Grafana Cloud + Alloy** | "Why is it slow or failing? How many transactions today?" | Alloy on the server, dashboards in the cloud |

The dashboards and their alerts are explained in [Monitoring (Grafana)](13-monitoring.md). This document is specifically about
running it on the VPS.

## 1. UptimeRobot (about 10 minutes)

1. Sign up at uptimerobot.com (free plan, checks every 5 minutes).
2. **Add New Monitor**, type **HTTP(s) - Keyword**:
   - URL `https://api.cashiermu.com/health`
   - Keyword `ok` (match the `/health` response body: `curl -s https://api.cashiermu.com/health`), alert when the keyword is **missing**
   - Interval 5 minutes
3. Add an **alert contact** (email first). Test it by briefly stopping the API:
   `docker compose -f docker-compose.prod.yml stop api`, wait for the notification, then `start api`.
4. Optional: HTTP(s) monitors for `https://cashiermu.com` (landing) and `https://docs.cashiermu.com`.

## 2. Set up Grafana Cloud

These are steps you can only do in the browser.

1. Sign up at grafana.com and create a **stack** (pick the nearest region, for example Singapore).
2. **Connections → Hosted Prometheus metrics**: note the **remote write URL** and **username** (a number). These are `GC_PROM_URL` and `GC_PROM_USER`.
3. **Connections → Hosted logs**: note the **URL** and **username**. These are `GC_LOKI_URL` and `GC_LOKI_USER`.
4. **Administration → Access policies → Create access policy**: scopes `metrics:write` and `logs:write`, then create a **token**.
   This is `GC_API_KEY`. The token is shown only once; store it in a password manager.
5. Generate a random string for `FARO_API_KEY`: `openssl rand -hex 16`.

## 3. Run Alloy on the server

1. DNS: create an **A** record `telemetry` → the server IP (in the Zone Editor, not Dynamic DNS), then check with
   `dig +short telemetry.cashiermu.com @8.8.8.8`.
2. In `~/Server-CashierMu/deploy/.env` set the following values (no spaces around `=`). `METRICS_TOKEN` must be set, otherwise
   `/metrics` is disabled and there are no API metrics:

```
METRICS_TOKEN=<openssl rand -hex 32>
GC_PROM_URL=...
GC_PROM_USER=...
GC_LOKI_URL=...
GC_LOKI_USER=...
GC_API_KEY=...
FARO_API_KEY=...
```

3. Apply it (`--profile monitoring` starts Alloy; without it Alloy does not run):

```bash
cd ~/Server-CashierMu && git pull && cd deploy
docker compose -f docker-compose.prod.yml --profile monitoring up -d --build
docker compose -f docker-compose.prod.yml --profile monitoring ps
docker compose -f docker-compose.prod.yml logs --tail 30 alloy
```

`alloy` must be `running` and its log must not contain `401`/`403`/`connection refused` errors. Because `METRICS_TOKEN` changes,
the API is recreated too (unavailable for a few seconds).

Note: from now on, always include `--profile monitoring` on later `up -d` runs. Without it Compose does not manage Alloy.

4. Check from outside: `curl -si -X POST https://telemetry.cashiermu.com/collect -H 'Content-Type: application/json' -d '{}' | head -3`.
   A `401` (empty key) or `400` (empty body) means the path is alive. A `404` or TLS error means DNS or Caddy is not right yet.

## 4. Dashboards and alerts

1. **Dashboards → New → Import**, upload `monitoring/grafana/dashboards/*.json`. Select your own Prometheus and Loki data sources. The
   files expect the uids `prometheus` and `loki`; if yours differ, change the uid in the data source or in the JSON.
2. Check **Explore → Prometheus**, query `up{job="cashiermu-api"}`. A value of `1` means API metrics are arriving.
3. Alerts: import `monitoring/prometheus/rules.yml` as alert rules, or create your own. At minimum:
   - API not responding (`up == 0` for 5 minutes)
   - High 5xx error rate
   - High p95 latency
   - Container memory approaching its limit
4. **Alerting → Contact points → New**: email first, then Telegram if you like. Connect it through a **Notification policy**. Test it
   with the **Test** button on the contact point. **An alert without a contact point notifies no one.**

## 5. Connect the app

The app sends telemetry to `https://telemetry.cashiermu.com/collect`. In the app repo (`eas.json`, the `env` section of each build profile):

```
EXPO_PUBLIC_TELEMETRY_URL=https://telemetry.cashiermu.com/collect
EXPO_PUBLIC_TELEMETRY_KEY=<the same FARO_API_KEY value>
```

This value is bundled into the app, so it is not a secret; it only limits arbitrary submissions. Because `EXPO_PUBLIC_*` variables
are baked in at build time, the app **must be rebuilt**. Telemetry does not include customer names or phone numbers (enforced in code).

## 6. Free-tier limits and cost

The Grafana Cloud free plan has limits on metrics, logs, and retention; check the numbers on your plan page. A small store's daily
logs are far below the limits. If you approach a limit, lower `LOG_LEVEL` or the scrape interval (15 seconds in `config.cloud.alloy`).

## Common problems

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Empty dashboard | Alloy is not running, or `METRICS_TOKEN` is empty | `ps`, then check the Alloy log; set `METRICS_TOKEN` |
| Alloy log shows `401`/`403` to Grafana | Wrong `GC_API_KEY`, or missing scope | Create a new token with `metrics:write` and `logs:write` |
| API logs do not appear | Empty log volume | `LOG_FILE` is already set in compose; check `docker compose ... exec alloy ls /var/log/cashiermu` |
| App telemetry does not arrive | Wrong `telemetry` DNS, or the app was not rebuilt | Check the `curl` in step 3.4, rebuild the app |
| Alerts never arrive | No contact point or notification policy | Set them up and test with the **Test** button |
