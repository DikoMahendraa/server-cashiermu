# Monitoring with Grafana

Two dashboards and eight alerts answer "is it working, and if not, why?" for the API and the mobile app.

```
 mobile app ──(errors, events, slow calls)──► Alloy :12347 ─┐
                                                              ├─► Loki (logs)  ──┐
 API ──► logs/api.log (JSON lines) ─────────► Alloy ─────────┘                   ├─► Grafana :3001
 API ──► GET /metrics (Bearer token) ───────► Prometheus ────────────────────────┘   (dashboards + alerts)
```

## Run it locally

```bash
npm run monitoring:up      # writes the metrics token from .env, starts Prometheus, Loki, Alloy, Grafana
```

Open **http://localhost:3001** (user `admin`, password `admin`; change it, or set `GRAFANA_ADMIN_PASSWORD`). The folder
**CashierMu** holds the dashboards and alert rules; everything is provisioned from `monitoring/`, so nothing is configured by hand.
`npm run monitoring:down` stops it (data is kept in Docker volumes).

The API needs these in its `.env` (see `.env.example`): `METRICS_TOKEN` (any long random string) and `LOG_FILE=logs/api.log`.
Restart the API after changing `.env`.

## What is collected

**Backend metrics** (`GET /metrics`, Prometheus format, needs `Authorization: Bearer <METRICS_TOKEN>`; with no token it is
open in development and **disabled in production**):

| Metric | Meaning |
| ------ | ------- |
| `cashiermu_http_request_duration_seconds` | Requests by method, **route pattern** and status (never real URLs: no ids or tokens, no series explosion) |
| `cashiermu_checkout_total{result,channel,code}` | Sales and failures, online vs synced-offline, with the error code |
| `cashiermu_checkout_replays_total` | Retries answered by the idempotency key |
| `cashiermu_offline_issues_total{type}` | Price adjusted / stock negative / shift closed on offline sales |
| `cashiermu_login_total{result}` | success, invalid_credentials, locked |
| `cashiermu_db_up` | 1 if the database answers a trivial query (checked on every scrape) |
| `nodejs_*`, `process_*` | Memory, CPU, event loop lag, GC |

**Backend logs**: one JSON object per line (`LOG_FILE`), each request with `requestId`, `route`, `status`, `durationMs`,
`userId`, `storeId`. No URLs, query strings, bodies, names or phone numbers. Every response carries `X-Request-Id`; a 500 also
returns it in the body, so a cashier's screenshot leads straight to the log line.

**App telemetry** (`src/observability/telemetry.ts` in the app): uncaught JS errors and error-boundary catches, `checkout`
(success / queued_offline / failed), `offline_sync`, `offline_sale_refused`, `connectivity` changes, `api_error` (5xx and 429
by route pattern), slow calls (>3 s) as measurements, and screen views. It is sent in Grafana Faro's JSON format straight to
Alloy's `faro.receiver`, so the app needs **no native module and no rebuild**. Privacy is enforced in code: no names, phones,
emails, amounts or item names; error text is scrubbed of emails and long digit runs.

## Point the app at the collector

In the app's `.env` (see `.env.example`):

```
EXPO_PUBLIC_TELEMETRY_URL=http://<your Mac's LAN IP>:12347/collect   # a phone cannot use localhost
EXPO_PUBLIC_APP_ENV=development                                      # production for store builds
```

Leave `EXPO_PUBLIC_TELEMETRY_URL` empty and telemetry is off. Items are buffered while the phone is offline and sent when it
is back; a burst is capped at 60 items per minute so a crash loop cannot flood the collector or the phone's data.

## Alerts (provisioned in `monitoring/grafana/provisioning/alerting/rules.yml`)

| Alert | Fires when |
| ----- | ---------- |
| API is down / Database is not answering | Prometheus cannot scrape the API, or `cashiermu_db_up` is 0, for 2 min (critical) |
| Server errors above 5% | 5xx share of requests > 5% for 5 min, with some traffic (critical) |
| Slow responses | p95 latency > 2 s for 10 min |
| Unexpected checkout failures | > 5 failures in 15 min that are not normal business rejections (price changed, no stock, no shift) |
| Many login lockouts | > 10 lockouts in 10 min: guessing, or `TRUST_PROXY` not set |
| App errors spiking | > 10 app errors in 10 min (production) |
| Offline sale refused by the server | Any: a customer paid but the sale was not recorded (critical) |

Alerts only change state until a **contact point** is attached. In Grafana: *Alerting → Contact points → Add* (email, Slack,
Telegram, WhatsApp via webhook…), then *Notification policies → default policy* → pick it. That choice is yours (it holds a
secret such as a bot token), so it is not in the repo.

## Grafana Cloud instead of running Grafana yourself

The free tier is enough to start. Create a stack on grafana.com (an account step only you can do), then:

1. *Connections → Add new connection → Hosted Prometheus metrics / Hosted logs*: note the remote-write and Loki URLs and
   user ids, and create an access policy token with `metrics:write` and `logs:write`.
2. Run Alloy next to the API with `monitoring/alloy/config.cloud.alloy` and the environment variables listed at its top
   (`METRICS_TOKEN`, `API_TARGET`, `GC_PROM_URL`, `GC_PROM_USER`, `GC_LOKI_URL`, `GC_LOKI_USER`, `GC_API_KEY`, optionally
   `FARO_API_KEY`). Mount the API's `logs/` folder into the container at `/var/log/cashiermu`.
3. Put Alloy's port 12347 behind HTTPS (for example `telemetry.example.com`) and use that as `EXPO_PUBLIC_TELEMETRY_URL`;
   set `EXPO_PUBLIC_TELEMETRY_KEY` to the same value as `FARO_API_KEY` (it limits drive-by posting; it is not a secret,
   the app ships it).
4. *Dashboards → New → Import*: upload `monitoring/grafana/dashboards/*.json` and pick your Prometheus and Loki data
   sources (the files expect data source uids `prometheus` and `loki`; rename yours or edit the uids). Alert rules can be
   imported the same way from `rules.yml`.

## Troubleshooting

- **Dashboard empty:** `docker compose -f monitoring/docker-compose.yml ps`; open Prometheus at http://localhost:9090/targets (the
  `cashiermu-api` target must be UP). A 401 there means the token file is stale: run `npm run monitoring:token`.
- **No API logs:** is `LOG_FILE` set, and did you restart the API? The file must exist at `logs/api.log`.
- **No app data:** the phone must reach the collector (`http://<LAN IP>:12347`); check *Alloy UI* at http://localhost:12345 and
  `faro_receiver_*` counters at http://localhost:12345/metrics.
