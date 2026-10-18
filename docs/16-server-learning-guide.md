# Learning guide: the CashierMu server and infrastructure

This document is a start-to-finish recap of **what the CashierMu server needs**: why we chose this server, how everything
fits together, what each term means, and how to operate it. It is written as study material for a frontend engineer who is
building their first SaaS, so almost every term is explained from the ground up.

The step-by-step guide with the full commands is in [Deploying to a VPS](15-deployment.md). This document explains
**why** and **what it means**; that one explains **how**.

Contents of this document:

1. The big picture
2. What the backend needs to run
3. Why not shared hosting
4. Choosing a server: options, prices, and the decision
5. Our server specs
6. The full architecture and the journey of one request
7. The components, one by one
8. Setup order from scratch
9. Day-to-day operations
10. Security: layers of defense
11. Backup and recovery
12. Monitoring
13. Monthly costs
14. Problems we hit and what we learned
15. Checklist: done and not done
16. Glossary and abbreviations
17. Further reading and exercises

---

## 1. The big picture

CashierMu is made of four parts that each stand on their own:

| Part             | What it contains                                                                  | Where it lives                                         |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **App**          | The Android cashier app (Expo / React Native)                                     | The cashier's phone, distributed through Google Play   |
| **Landing page** | The marketing site, privacy and terms pages (Astro)                               | Jetorbit hosting, at `cashiermu.com`                   |
| **Backend (API)** | The brain of the system: accounts, products, transactions, reports, offline sync | Biznet server (VPS), at `api.cashiermu.com`            |
| **Database**     | All store data: products, transactions, users                                     | PostgreSQL on the same server                          |

The app does not keep the main data on the phone. It talks to the API over the internet, and the API saves to the
database. The phone only keeps temporary records (the offline transaction queue, a copy of the catalog) so the cashier
can keep selling when the internet drops.

The reason we need our own server: a cashier app for many stores needs **one shared place** that keeps each store's data
separate, calculates prices correctly, and stores a safe history. This is what is called **SaaS** (software as a service).

---

## 2. What the backend needs to run

Our backend is a program that must **stay running all the time**, and it needs:

| Requirement | Our version                                 | What it is for                                                            |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Node.js     | 20                                          | Runs the API code (compiled TypeScript)                                   |
| Express     | 4                                           | Web framework: receives requests and calls the logic                      |
| Prisma      | 5                                           | Connects to the database (ORM) and manages migrations                     |
| PostgreSQL  | 16                                          | The database where all data is stored                                     |
| HTTPS       | Let's Encrypt certificate                   | Encrypts traffic (PINs and tokens must not be readable by anyone)         |
| Secrets     | JWT secret, database password, metrics token | Sign logins and protect access                                            |

These three things decide what kind of server fits: a program that stays running, a real database, and HTTPS. That is
exactly what shared hosting cannot provide (next section).

---

## 3. Why not shared hosting

You already have **Jetorbit Pluto** hosting (shared hosting, 300 MB). It is good, but for something else.

**Shared hosting** = one big server used by hundreds of sites at once. The provider manages everything; you only upload
files. It suits static sites or ordinary PHP.

|                                  | Shared hosting (Pluto)         | VPS                          |
| -------------------------------- | ------------------------------ | ---------------------------- |
| What you get                     | A folder for your site files   | A whole virtual computer     |
| A program that stays running (API) | Not possible                 | Possible                     |
| PostgreSQL database              | Usually only MySQL/MariaDB     | Install anything             |
| Docker                           | No                             | Possible                     |
| Full root/SSH access             | No (or limited)                | Yes                          |
| Provider manages the system      | Yes                            | No (you manage it)           |
| Price                            | Very cheap                     | More expensive               |

Conclusion: the **landing page stays on Pluto** (static files, `cashiermu.com`), and the **backend needs a VPS**
(`api.cashiermu.com`). One domain, two subdomains, two different places.

---

## 4. Choosing a server: options, prices, and the decision

### 4.1 Kinds of places to run a backend

| Option                              | Explanation                                | Pros                                                        | Cons                                                                                                              |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **VPS** (our choice)                | Rent an empty virtual computer             | Cheap and fixed price, you learn a lot, easy to move        | You handle security, backups, and updates                                                                         |
| **PaaS** (Railway, Render, Fly.io)  | Connect GitHub, the platform runs it       | Easiest to start with                                       | Dollar-based costs that grow with usage, vendor lock-in                                                           |
| **Your own server at home/office**  | A mini PC that runs 24 hours               | Cheap at first                                              | Power/internet outages, IP that changes or is blocked by CGNAT, home network security, not suited for production  |
| **Big cloud** (AWS, GCP, Azure)     | A very complete range of services          | Massive scale                                               | Complex, and costs are hard to predict for beginners                                                              |

We chose a **VPS** because the cost is fixed and low, you learn fundamentals used everywhere (Linux, Docker, DNS), and
our deploy kit (Docker Compose) can be moved to another provider at any time.

### 4.2 The options we compared (monthly prices, from the price lists when we researched them)

Prices can change; double-check on the provider's site.

| Provider and plan          | vCPU  | RAM      | Disk       | Price         | Notes                                      |
| -------------------------- | ----- | -------- | ---------- | ------------- | ------------------------------------------ |
| Jetorbit Cloud 1           | 1     | 2 GB     | 25 GB NVMe | Rp 99k        | KVM and root listed                        |
| Jetorbit Cloud 2           | 1     | 4 GB     | 50 GB NVMe | Rp 120k       | KVM and root listed                        |
| Jetorbit Cloud 3x          | 2     | 4 GB     | 60 GB      | Rp 180k       |                                            |
| Jetorbit Cloud Classic 1   | 2     | 4 GB     | 80 GB SSD  | Rp 109k       | **Billed yearly**, VPS is non-refundable   |
| Biznet NEO Lite SS 2.1     | 1     | 2 GB     | 60 GB      | Rp 80k        |                                            |
| Biznet NEO Lite SS 2.2     | 2     | 2 GB     | 60 GB      | Rp 109k       |                                            |
| **Biznet NEO Lite MS 4.2** | **2** | **4 GB** | **60 GB**  | **Rp 139k**   | **Our choice** (monthly)                   |
| Biznet NEO Lite MS 4.4     | 4     | 4 GB     | 60 GB      | Rp 179k       |                                            |

The prices above do not include VAT (11% tax). The MS 4.2 we bought: Rp 139,000 + VAT = **Rp 154,290 per month**.

### 4.3 Why the MS 4.2

1. **4 GB of RAM is the safe point.** Our stack uses about 1 GB while running, but building the Docker image during a
   deploy can temporarily use 1.5 GB or more. With 2 GB, we would need swap and it would still be tight.
2. **2 vCPUs** give headroom when many stores log in (bcrypt hashes the PIN, which uses CPU) or open reports at the same time.
3. **Monthly billing, no contract.** For a product that has just started, yearly billing with no refund is risky.
4. **60 GB of disk** is more than enough: the system takes about 6 GB, Docker images about 2 GB, and sales data is small.
5. **West Java location (near Jakarta)** gives low latency from Indonesia.
6. The plan can be upgraded later without creating a new server.

### 4.4 Why Ubuntu 24.04 LTS

- **LTS (Long Term Support)** gets security updates for about 5 years. Non-LTS releases last only about 9 months, so you
  would have to keep upgrading. A production server needs stability.
- Ubuntu is the most widely used; almost every tutorial and answer on the internet uses it.
- The rule: the April release in even-numbered years (22.04, 24.04, 26.04) is LTS. We chose the mature 24.04; 26.04 is
  also LTS but new, and third-party tools are sometimes late to support it.
- Our app runs **inside a container**, so the Ubuntu version on the server barely affects the app.

### 4.5 What to confirm before buying a VPS

| Question                                         | Why it matters                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Is the virtualization **KVM**?                   | Docker needs KVM. Some cheap plans use OpenVZ/LXC, which do not fit.       |
| Is there full **root** access?                   | To install Docker and configure the server.                                |
| Monthly or yearly billing, is there a **refund**? | Avoid being locked into the wrong server.                                 |
| Is a **public IPv4** included?                   | Without a public IP, the server cannot be reached.                         |
| Is an **Ubuntu LTS** OS option available?        | Matches our guide.                                                         |
| Does the price already include **VAT**?          | Avoid surprises on the bill.                                               |
| Can the plan be **upgraded**?                    | To grow without moving servers.                                            |

How to prove it after buying: `systemd-detect-virt` must answer `kvm`, and `docker run hello-world` must succeed.
We verified both on our server.

---

## 5. Our server specs

| Item                | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Provider and plan   | Biznet Gio, NEO Lite **MS 4.2**                                           |
| Service name        | `cashiermu-prod`                                                          |
| Region              | West Java                                                                 |
| CPU                 | 2 vCPU                                                                    |
| RAM                 | 4 GB (the system reports about 3.8 GiB usable)                            |
| Disk                | 60 GB SSD (about 58 GB visible, 55 GB free at the start)                  |
| Operating system    | Ubuntu 24.04.4 LTS                                                        |
| Virtualization      | KVM (verified with `systemd-detect-virt`)                                 |
| IP                  | 1 public IPv4 address                                                     |
| User                | `deploy` (member of the `sudo` group), logs in with an SSH key only       |
| Address             | `api.cashiermu.com` (A record in Jetorbit DNS)                            |
| Cost                | Rp 139,000 + 11% VAT = Rp 154,290 per month                               |

Estimated memory use during normal operation:

| Component      | Roughly                                       |
| -------------- | --------------------------------------------- |
| Ubuntu system  | 300 MB                                        |
| Docker daemon  | 100 MB                                        |
| PostgreSQL     | 100 to 300 MB (grows with data and connections) |
| API (Node.js)  | 150 to 250 MB                                 |
| Caddy          | 20 to 40 MB                                   |
| **Total**      | about 0.8 to 1 GB                             |

The remaining ~3 GB is a safety margin, including for building images during a deploy.

---

## 6. The full architecture and the journey of one request

### 6.1 Diagram

```
 [Cashier phone: CashierMu app]      [Customer browser]         [Site visitor]
        |  HTTPS                           |  HTTPS                    |  HTTPS
        |  api.cashiermu.com               |  api.cashiermu.com/r/...  |  cashiermu.com
        v                                  v                           v
 +------------------------------------------------+      +---------------------------+
 |  Biznet VPS (Ubuntu 24.04, 2 vCPU, 4 GB)       |      | Jetorbit Pluto hosting    |
 |                                                |      | (shared hosting)          |
 |  Firewall: only ports 22, 80, 443              |      |  Static landing page      |
 |    |                                           |      |  (Astro: HTML, CSS, JS)   |
 |    v                                           |      +---------------------------+
 |  +------------- Docker Compose -------------+  |
 |  |  Caddy  --->  API (Node.js)  --->  PostgreSQL |   External services:
 |  |  HTTPS        Express + Prisma      data      |   - Cloudinary (product photos)
 |  +-------------------------------------------+  |   - Grafana Cloud (dashboards, alerts)
 |   Alloy (ships logs and metrics)  Backup script |   - Off-server backup storage
 +------------------------------------------------+
```

### 6.2 The journey of one request: the cashier taps "Pay"

1. The **app** (on the phone) sends an HTTPS request to `https://api.cashiermu.com/api/v1/transactions`.
2. **DNS** translates the name `api.cashiermu.com` into the server's IP address (the A record).
3. The request reaches the server through the **firewall** (only ports 22, 80, 443 are open) and arrives at port 443.
4. **Caddy** receives it, decrypts the HTTPS traffic with its certificate, and forwards it to the API over Docker's private network.
5. The **API** checks the login token, validates the request body, **recalculates the price on the server** (it does not
   trust the numbers from the phone), and saves the transaction in **PostgreSQL** within a single database transaction.
6. The API responds, and the answer travels back through Caddy to the phone.
7. If the internet drops at step 1, the app **keeps the transaction on the phone** and sends it automatically later with
   the same idempotency key, so it is never recorded twice.

### 6.3 Why the landing page and the API use different addresses

- `cashiermu.com` points to Jetorbit hosting (static files).
- `api.cashiermu.com` points to the VPS IP. This is just one extra DNS record; **no new domain needs to be bought**.
- Keeping them separate means the landing page stays up while the API server is being updated, and vice versa.

---

## 7. The components, one by one

### 7.1 Linux, users, and sudo

- **Linux** is the server's operating system. You control it through text (the terminal), not windows.
- **root** is the user with full power. It is dangerous to use day to day, so we create a regular user, **`deploy`**.
- **sudo** gives `deploy` root power for a single command when needed (`sudo apt update`).
- **apt** is Ubuntu's package manager: `apt update` (fetch the latest list), `apt upgrade` (install updates), `apt install` (install programs).
- **systemd** runs background services and starts them automatically when the server boots (`systemctl restart ssh`).
- **cron** runs scheduled tasks (we use it for the nightly backup).
- The server clock is usually **UTC** (universal time). WIB (Western Indonesia Time) = UTC + 7. That is why a backup at
  20:00 UTC runs at 03:00 WIB. Check with `timedatectl`.

### 7.2 SSH: how to get into the server

- **SSH (Secure Shell)** is a way to log in to the server's terminal remotely, encrypted.
- It uses a **key pair**: a **private key** (on your Mac, the file `cashiermu_vps`, never to be shared) and a **public key**
  (the `.pub` file, installed on the server). The server recognizes your key without a password.
- We disabled **password login** and **root login** (`/etc/ssh/sshd_config.d/00-hardening.conf`). Anyone guessing
  passwords has no way in.
- **fail2ban** blocks IP addresses that repeatedly fail to log in over SSH.
- **Deploy key**: a separate SSH key **on the server** (`cashiermu_deploy`), registered on GitHub as a **read-only** key
  for the backend repo. Its purpose: the server may pull the code but cannot change it.
  This key is different from the login key (`cashiermu_vps`, from the Mac to the server).

### 7.3 Firewall: two layers

1. **Security Group** in the Biznet panel (outside the server): only allows ports 22, 80, 443.
2. **UFW** inside the server (Uncomplicated Firewall): the same rules as a backup.

The ports in use: **22** (SSH, for you), **80** (HTTP, which Caddy uses to obtain certificates and redirect to HTTPS),
**443** (HTTPS, the app traffic). Everything else is closed, including the database port (5432).

### 7.4 Docker and Docker Compose

- **Docker** runs programs inside **containers**: isolated boxes holding the program and everything it needs.
  The result is the same on a Mac, on the server, anywhere.
- **Image** = a template (recipe + contents) built from a `Dockerfile`. **Container** = an image that is running.
- **Volume** = storage that survives even if the container is deleted. Important: the database data lives in the
  `db-data` volume, the HTTPS certificates in `caddy-data`, and the logs in `api-logs`.
- **Network** = a private network between containers. Containers talk to each other by name (`db`, `api`).
- **Docker Compose** runs several containers at once from a single file, `deploy/docker-compose.prod.yml`.
- `restart: unless-stopped` makes a container come back up on its own after a crash or a server reboot (we have tested this).
- **Healthcheck**: Docker periodically checks `GET /health`; a `healthy` status means the API is answering.

Our three containers:

| Container | Image                                  | Job                              | Port to the outside              |
| --------- | -------------------------------------- | -------------------------------- | -------------------------------- |
| `caddy`   | `caddy:2-alpine`                       | The front door, HTTPS            | 80, 443                          |
| `api`     | the image we build (`Dockerfile`)      | Application logic                | none (private network only)      |
| `db`      | `postgres:16-alpine`                   | Database                         | none (private network only)      |

Our Dockerfile is staged (**multi-stage**): the *build* stage compiles TypeScript, and the *runtime* stage carries only
what is needed to run, and runs as a regular user (`node`), not root.

### 7.5 Caddy: the front door (reverse proxy)

- A **web server** receives web requests. A **reverse proxy** stands in front of another program and forwards requests to it.
- Caddy handles **automatic HTTPS**: it fetches a free certificate from **Let's Encrypt** and renews it on its own
  (certificates last 90 days). The requirements: the DNS record points to the server and ports 80 and 443 are open.
- It hides `/metrics` from the internet (answering 404), compresses responses, and adds security headers (**HSTS**
  forces browsers to always use HTTPS).
- Its configuration is one short file: `deploy/Caddyfile`.
- The alternative is Nginx; it does a similar job, but automatic HTTPS needs an extra tool.

### 7.6 API: Node.js, Express, Prisma

- **Node.js** runs JavaScript on the server. **Express** is the web framework on top of it.
- **Prisma** is an **ORM** (Object-Relational Mapper): you write TypeScript code, and Prisma generates SQL for the database.
- **Migrations** = ordered scripts that create and change tables (the `prisma/migrations` folder). With every release, we run
  `prisma migrate deploy` so the database keeps up with the code.
- **Configuration through environment variables** in `deploy/.env` (not committed to Git): the database password, the JWT secret, the public address, and so on.
- The server **refuses to start** in production if a secret is weak or is a sample value; this is deliberate so that
  misconfiguration gets noticed.
- **Request ID**: every response carries `X-Request-Id`, so a problem can be traced in the logs.
- **Idempotency key**: a unique key per transaction so that resending (for example after the internet drops) does not create a duplicate transaction.

### 7.7 PostgreSQL: the database

- Stores all the data. It runs in the `db` container, with its data in the `db-data` volume.
- It has **no port open to the outside**: only the `api` container on the private network can reach it.
- Each store is separated at the code level: every query is filtered by the `storeId` from the login token.
- **Backup**: see section 11. Data in a volume is not a backup; if the volume breaks, the data is gone.

### 7.8 DNS: names become addresses

- **DNS (Domain Name System)** translates a name (`api.cashiermu.com`) into an IP (`139.190.97.4`).
- **A record** = a name pointing to an IPv4 address. We have one: `api` → your server's IP.
- **Nameserver** = the server that holds the authoritative answers. For `cashiermu.com`, that is `ns1.jetorbit.net` and
  `ns2.jetorbit.net`; changes are made in the **Zone Editor** of Jetorbit's cPanel.
- **TTL (Time To Live)** = how long others may keep (cache) an answer. A TTL of 300 = 5 minutes. A long TTL (for example
  14400 = 4 hours) makes changes spread slowly. **Lower the TTL before moving servers.**
- **NXDOMAIN** = the answer "this name does not exist". This answer can also be cached for a short while, so your Mac may
  still fail even though the DNS is already correct.
- **Propagation** = the process of a DNS change spreading across the world (minutes to hours).
- Check from the terminal: `dig +short api.cashiermu.com`, or ask the source directly with `dig +short api.cashiermu.com @ns1.jetorbit.net`.

### 7.9 Monitoring: Alloy, Prometheus, Loki, Grafana

- **Metrics** = numbers over time (request count, speed, memory). The API exposes them at `/metrics` (protected by a token,
  hidden from the internet by Caddy).
- **Logs** = records of events (one JSON line per request, with no personal data).
- **Prometheus** stores metrics, **Loki** stores logs, and **Grafana** displays them as dashboards and sends **alerts**.
- **Alloy** is the collector: it reads logs and metrics on the server and sends them to Grafana.
- We set up a Backend dashboard and an App dashboard, plus 8 alerts. Details in [Monitoring (Grafana)](13-monitoring.md).

---

## 8. Setup order from scratch

This is the order we followed. The full commands are in [Deploying to a VPS](15-deployment.md); here you learn
**the reason for each step**.

| #  | Step                                                                          | Why                                                                      |
| -- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1  | Order the VPS (Ubuntu 24.04, MS 4.2, monthly) and install the **SSH key** when ordering | The server can only be entered with a key from the very start, no password |
| 2  | Create a DNS **A** record: `api` → the server IP                              | The name must point to the server before Caddy can obtain a certificate  |
| 3  | First login as `deploy`, check `kvm`, RAM, disk                               | Confirms the server matches what was purchased                           |
| 4  | `apt update && apt upgrade`                                                   | Install the latest security updates                                      |
| 5  | Lock down SSH: turn off password login and root login                         | Only key holders can get in                                              |
| 6  | Test the login from a **second terminal** before closing the first            | If you get it wrong, you are not locked out                              |
| 7  | UFW firewall (22, 80, 443), install **fail2ban** and automatic updates        | Reduces attacks and keeps the server up to date                          |
| 8  | Install **Docker**                                                            | To run the stack                                                         |
| 9  | Create a **deploy key** on the server and register it on GitHub (read-only)   | The server may pull the private code                                     |
| 10 | `git clone` the backend repo                                                  | Fetches the Dockerfile and deploy files                                  |
| 11 | Create `deploy/.env` with random secrets (`openssl rand -hex`)                | Production configuration, not committed to Git                           |
| 12 | `docker compose up -d --build`                                                | Builds and runs db, api, caddy                                           |
| 13 | `prisma migrate deploy`                                                       | Creates the tables in the new database                                   |
| 14 | Check `https://api.cashiermu.com/health`                                      | Proof that everything works and the HTTPS certificate was issued         |
| 15 | `backup.sh`, `restore-test.sh`, the cron schedule                             | Data is safe and proven to be recoverable                                |
| 16 | Test a server reboot                                                          | Everything starts on its own after a restart                             |

---

## 9. Day-to-day operations

All of these commands are run on the server, in the `~/Server-CashierMu/deploy` folder.

| Need                             | Command                                                  |
| -------------------------------- | -------------------------------------------------------- |
| See status                       | `docker compose -f docker-compose.prod.yml ps`           |
| Watch the API logs live          | `docker compose -f docker-compose.prod.yml logs -f api`  |
| Restart the API                  | `docker compose -f docker-compose.prod.yml restart api`  |
| Check memory and CPU usage       | `docker stats --no-stream`                               |
| Check the disk                   | `df -h /`                                                |
| Check health from the outside    | `curl -s https://api.cashiermu.com/health`               |
| Manual backup                    | `./backup.sh`                                            |

**Updating to a new version:**

1. `cd ~/Server-CashierMu && git pull`
2. `cd deploy && ./backup.sh` (always back up first)
3. `docker compose -f docker-compose.prod.yml up -d --build`
4. `docker compose -f docker-compose.prod.yml run --rm -T api npx prisma migrate deploy`
5. Check `/health`.

**Rollback:** go back to the previous tag (`git checkout <tag>`) and rebuild. If the new release ran a migration,
restore the database from the pre-update backup; do not just swap the code.

**Routine things to look at:** the disk (`df -h`), memory (`free -h`), and the Grafana dashboards. Caddy renews the HTTPS
certificate by itself; Ubuntu security updates install automatically, but now and then the server asks for a restart (`/var/run/reboot-required`).

---

## 10. Security: layers of defense

Security is built in layers, so that one leaking layer does not immediately mean a breach.

| Layer          | What we do                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network        | The security group and UFW only open ports 22, 80, 443; the database and API have no open ports                                                                                                 |
| Server access  | Login with an SSH key only, no password, no root; fail2ban blocks repeated attempts                                                                                                             |
| Code on server | Read-only deploy key; `.env` with 600 permissions and not in Git                                                                                                                                |
| Traffic        | HTTPS required (HTTP is redirected), HSTS, security headers (helmet), `X-Powered-By` removed                                                                                                    |
| Application    | PINs stored as bcrypt hashes; login attempt limits per address and per account; short-lived JWT tokens; each store's data separated by `storeId`; the server recalculates prices               |
| Configuration  | The server refuses to start with weak secrets; `/metrics` and `/docs` are not exposed in production                                                                                             |
| Updates        | Automatic Ubuntu security updates (unattended-upgrades)                                                                                                                                         |
| Recovery       | Daily backups proven to be restorable                                                                                                                                                           |

**Risks we accept for the beginning** (to be reviewed as the number of stores grows): refresh tokens are not rotated yet,
login lockout is kept in the memory of a single process, data lists are not paginated, the offline queue on the phone is
stored unencrypted, and crashes outside JavaScript are not reported yet. The full list is in [Production checklist](14-production-checklist.md).

**Secrets**: never put `.env`, SSH private keys (`cashiermu_vps`, `cashiermu_deploy` without `.pub`), console passwords,
or tokens in chat, Git, or screenshots. If one has already been exposed, **replace** the value.

---

## 11. Backup and recovery

**The 3-2-1 rule**: keep **3** copies of your data, on **2** different types of storage, with **1** copy off-site.

| Copy                                                                                                        | Our status                                         |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| The original database (`db-data` volume)                                                                    | In place                                           |
| Daily dump on the server (`~/backups`, kept for 14 days)                                                    | In place, cron schedule 20:00 UTC (03:00 WIB)      |
| Copy off the server (Cloudflare R2 through `rclone`, see [Off-site backup](17-r2-offsite-backup.md))        | In place; also enable the bucket lock              |

How it works:

- `backup.sh` runs `pg_dump` **inside the db container** (no database port is opened), compresses it with gzip,
  checks that the file is not corrupt and not empty, then deletes dumps older than 14 days.
- `restore-test.sh` restores the latest dump into a **temporary** database named `restore_test`, counts the stores, users, and
  transactions, then deletes it. The real database is untouched. Run it after the first backup and every few weeks.
- A backup that has never been tested for restoring is only a hope.

Restoring after a disaster (outline): stop the API, `gunzip -c file.sql.gz | docker compose ... exec -T db psql -U cashiermu -d cashiermu`,
start the API again, then check `/health`. Practice this once with a trial database so you do not panic when you really need it.

---

## 12. Monitoring

| Tool                                           | What it does                                              | Status                                                   |
| ---------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `/health`                                      | The API's "I am alive" answer                             | In place                                                 |
| Docker healthcheck                             | Docker marks the API healthy or not                       | In place                                                 |
| Grafana dashboards and alerts (API and app)    | Speed, errors, transactions, offline sync                 | Files ready in `monitoring/`; **not installed on the server yet** |
| External uptime monitor (UptimeRobot / Better Stack) | Tells you when the server is down                   | **Not yet**                                              |
| Grafana alert contact point                    | Where alerts are sent (email, WhatsApp, Telegram)         | **Not yet**                                              |

The uptime monitor matters because it watches from **outside** the server: if the server dies completely, the tools
inside the server die with it and cannot tell anyone.

---

## 13. Monthly costs

| Item                       | Estimate                     | Notes                                                    |
| -------------------------- | ---------------------------- | -------------------------------------------------------- |
| Biznet MS 4.2 VPS          | Rp 154,290                   | Rp 139,000 + 11% VAT                                     |
| Jetorbit Pluto hosting     | about Rp 16k                 | From the price list we saw; check your own bill          |
| `cashiermu.com` domain     | yearly fee                   | Divide by 12 for a monthly estimate                      |
| Grafana Cloud              | free                         | The free plan is enough to start                         |
| Cloudinary                 | free                         | Free plan for product photos                             |
| Off-server backup          | free up to a small quota     | Cloudflare R2 / Backblaze B2                             |
| Google Play developer account | one-time fee              | You have already created it                              |
| EAS Build (Expo)           | free with limits             | Longer build queues on the free plan                     |

The regular total is about **Rp 175 to 200 thousand per month**. This is an estimate; follow your real bills.

---

## 14. Problems we hit and what we learned

Problems are part of learning. Here is what happened and how to recognize it next time.

| Problem                                                       | Cause                                                                                   | Lesson                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GitHub rejects the push: "email privacy restrictions"         | The commit email was treated as private by the account in use                           | Check the email settings on GitHub or use a noreply address; check which account is active                          |
| `Permission denied (publickey)` when testing GitHub           | The command was run on the **Mac**, not on the server                                   | Look at the prompt: `deploy@cashiermu-prod` is the server, `➜ ... git:(main)` is the Mac                            |
| `api.cashiermu.com` points to the hosting IP                  | cPanel created a record automatically through its **Dynamic DNS** feature               | One name has one correct record; check the Zone Editor. The Dynamic DNS update link is a secret                     |
| DNS "not found" even though it was already created            | The cache held an old NXDOMAIN answer and the TTL was long                              | Ask the nameserver directly; use public DNS over HTTPS; wait out the TTL; flush the Mac's cache                     |
| Expo commands fail on the Mac                                 | Node 20.10 is too old (needs 20.19.4 or later)                                          | Use Node 22 LTS through `nvm`                                                                                       |
| Docker build fails (code 127)                                 | The `prepare` script (husky) is not present in the production build                     | Remove `prepare` in the Docker runtime stage                                                                        |
| `docker compose run` swallows the rest of the commands        | Without `-T`, it reads terminal input                                                   | Use `run --rm -T` in scripts                                                                                        |
| SSH settings do not take effect                               | On Ubuntu 22.04 and 24.04, files in `sshd_config.d/` are read first and win             | Put our rules in the file that sorts first (`00-hardening.conf`) and verify with `sshd -T`                          |
| The backup schedule shows up twice                            | The command that adds the cron entry was run twice                                      | Always check `crontab -l` after changing it                                                                         |
| A bash script behaves strangely on the Mac                    | The Mac uses **zsh**, the server uses **bash**; they split variables differently        | Test the script in the same shell it will run in                                                                    |
| Jetorbit's yearly plan                                        | Yearly billing and a non-refundable VPS                                                 | Start monthly; ask about the refund policy before paying                                                            |

---

## 15. Checklist: done and not done

**Done**

- [x] Server ordered and verified (KVM, Ubuntu 24.04, 4 GB RAM, 60 GB)
- [x] Login with an SSH key only; root and password turned off
- [x] Firewall, fail2ban, automatic security updates
- [x] Docker installed; code pulled with a read-only deploy key
- [x] Production `.env` with random secrets
- [x] db, api, caddy running; migrations applied
- [x] DNS `api.cashiermu.com` correct; HTTPS certificate from Let's Encrypt issued
- [x] `/metrics` and `/docs` hidden; HTTP redirected to HTTPS
- [x] Backups, restore test, and the nightly schedule
- [x] Server starts on its own after a reboot
- [x] Docker log size limit (3 files x 10 MB per container), active after the next `docker compose up -d`

**Not done (in priority order)**

- [x] Off-server backup copy (`rclone` to R2); the 14-day bucket lock may not be active, check in the dashboard
- [ ] External uptime monitor
- [ ] Alloy and Grafana Cloud on the server, plus an alert contact point
- [ ] Production app build, tested on a real phone (store registration, selling, offline, printing)
- [ ] Google Play preparation (closed testing, privacy URL, data safety form)
- [ ] In-app account deletion (a Google Play requirement)
- [ ] Tidy up the app's photo permissions
- [ ] Schedule regular restore drills

---

## 16. Glossary and abbreviations

### Infrastructure and networking

| Term                                    | Meaning                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| **VPS** (Virtual Private Server)        | A rented virtual computer whose contents you manage yourself                                  |
| **vCPU**                                | A virtual processor core                                                                      |
| **RAM**                                 | Fast working memory where programs run                                                        |
| **SSD / NVMe**                          | Types of fast disk (NVMe is faster than ordinary SSD)                                         |
| **KVM**                                 | A full virtualization technology; a requirement for Docker to run well                        |
| **Hypervisor**                          | Software that divides one physical machine into several VPSs                                  |
| **Shared hosting**                      | One server used by many sites; you only upload files                                          |
| **PaaS** (Platform as a Service)        | A platform that runs your code without you managing servers                                   |
| **IaaS** (Infrastructure as a Service)  | Renting raw infrastructure, such as a VPS                                                     |
| **SaaS** (Software as a Service)        | Software sold as a subscription service; CashierMu is SaaS                                    |
| **Data center**                         | A building full of servers with backup power and internet                                     |
| **IP**                                  | The numeric address of a device on the internet                                               |
| **IPv4 / IPv6**                         | Two versions of IP addresses (IPv4 example `139.190.97.4`; IPv6 is longer)                    |
| **CGNAT**                               | The internet provider shares one public IP among many customers; makes a home server unreachable |
| **Port**                                | A "numbered door" on a server: 22 SSH, 80 HTTP, 443 HTTPS, 5432 PostgreSQL                    |
| **Firewall**                            | A guard that allows or rejects traffic according to rules                                     |
| **Security Group**                      | A firewall on the cloud provider's side, outside the server                                   |
| **UFW**                                 | Ubuntu's simple built-in firewall, inside the server                                          |
| **Latency**                             | The delay of data traveling (the closer the server, the smaller it is)                        |
| **Bandwidth / transfer**                | The amount of data allowed to pass per month                                                  |
| **Uptime**                              | The percentage of time the server is up and serving                                           |
| **SLA**                                 | The provider's service level promise (for example 99.9% uptime)                               |
| **OOM killer**                          | A Linux mechanism that forcibly kills programs when memory runs out                           |
| **Swap**                                | Disk space used as backup RAM                                                                 |

### DNS and the web

| Term                       | Meaning                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| **DNS**                    | The system that translates domain names into IPs                                   |
| **Domain / subdomain**     | `cashiermu.com` is a domain; `api.cashiermu.com` is a subdomain                    |
| **A record**               | A name pointing to an IPv4 address                                                 |
| **CNAME**                  | A name pointing to another name                                                    |
| **TXT record**             | A text note in DNS (used for verification, for example by Google)                  |
| **Nameserver (NS)**        | The server that holds a domain's authoritative DNS data                            |
| **TTL**                    | How long a DNS answer may be kept in cache                                         |
| **NXDOMAIN**               | The DNS answer "name does not exist"                                               |
| **Propagation**            | The process of a DNS change spreading                                              |
| **Zone Editor**            | The cPanel menu for changing DNS records                                           |
| **HTTP / HTTPS**           | The web protocol; HTTPS is the encrypted version                                   |
| **SSL / TLS**              | The encryption technology behind HTTPS (TLS is the successor to SSL)               |
| **Certificate**            | A file that proves the server's identity for HTTPS                                 |
| **Let's Encrypt**          | A free HTTPS certificate issuer                                                    |
| **HSTS**                   | A header that tells browsers to always use HTTPS                                   |
| **Reverse proxy**          | A server in front of another program that forwards requests                        |
| **CORS**                   | Browser rules about which sites may call an API                                    |
| **API**                    | A program interface: how an app talks to a server                                  |
| **REST**                   | An API style that uses addresses and HTTP methods (GET, POST, PATCH, DELETE)       |
| **Endpoint**               | A single API address, for example `/api/v1/transactions`                           |
| **JSON**                   | The text data format used by APIs                                                  |
| **Health check**           | An address that answers "I am alive" (`/health`)                                   |

### Linux and servers

| Term                            | Meaning                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Linux / Ubuntu**              | The server operating system; Ubuntu is the distribution                          |
| **LTS**                         | Long Term Support: a release with long-term security support                     |
| **Terminal / shell**            | The text command window (Mac uses zsh, the server uses bash)                     |
| **SSH**                         | A way to log in to the server's terminal remotely, encrypted                     |
| **Private / public key**        | An SSH key pair; the private one is kept secret, the public one is installed on the server |
| **Deploy key**                  | A read-only SSH key for a single GitHub repo                                     |
| **root**                        | The user with full power                                                         |
| **sudo**                        | Runs a single command with root power                                            |
| **apt**                         | Ubuntu's package manager                                                         |
| **systemd / systemctl**         | The background service manager                                                   |
| **cron / crontab**              | The periodic task scheduler                                                      |
| **UTC / WIB**                   | Universal time / Western Indonesia Time (UTC + 7)                                |
| **fail2ban**                    | A program that blocks IPs that repeatedly fail to log in                         |
| **unattended-upgrades**         | Automatic security updates                                                       |
| **chmod 600**                   | Sets a file so only its owner can read and write it                              |

### Docker and the application

| Term                       | Meaning                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| **Docker**                 | Runs programs in isolated containers                                             |
| **Image**                  | The template a container is based on                                             |
| **Container**              | An image that is running                                                         |
| **Dockerfile**             | The recipe for building an image                                                 |
| **Docker Compose**         | Runs several containers from a single YAML file                                  |
| **Volume**                 | Storage that survives even if the container is deleted                           |
| **Multi-stage build**      | A staged Dockerfile so the final image is small and clean                        |
| **YAML**                   | A configuration file format (`docker-compose.prod.yml`)                          |
| **Environment variable**   | A setting passed to a program through its environment, not the code              |
| **`.env`**                 | A file containing environment variables (secrets, not committed to Git)          |
| **Node.js / Express**      | The server JavaScript runtime / the web framework                                |
| **ORM / Prisma**           | A translator from code to SQL; Prisma is our ORM                                 |
| **Migration**              | An ordered script that changes the database structure                            |
| **PostgreSQL**             | The relational database we use                                                   |
| **SQL**                    | The language for querying and changing databases                                 |
| **Database transaction**   | A group of changes that either all succeed or all get cancelled                  |
| **bcrypt**                 | A way to store a PIN as a hash that cannot be reversed                           |
| **Hash**                   | A one-way fingerprint of data                                                    |
| **JWT**                    | A login token signed by the server                                               |
| **Idempotency key**        | A unique key so a repeated request is not processed twice                        |
| **Rate limit**             | A cap on the number of requests per unit of time                                 |
| **Multi-tenant**           | Many stores use the same system with separated data                              |
| **CI/CD**                  | Automation of tests and releases (not used yet; a natural next step)             |

### Monitoring, backup, and releases

| Term                                      | Meaning                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Metrics**                               | Numbers over time (requests per second, memory)                                               |
| **Log**                                   | A record of events                                                                            |
| **Prometheus / Loki / Grafana / Alloy**   | Metric store / log store / dashboard / collector                                              |
| **Faro**                                  | Grafana's telemetry format for apps                                                           |
| **Alert**                                 | An automatic notification when something is abnormal                                          |
| **p95**                                   | The response time that 95% of requests are faster than                                        |
| **3-2-1 backup**                          | 3 copies, 2 types of storage, 1 off-site                                                      |
| **pg_dump**                               | The PostgreSQL tool for making a copy of a database                                           |
| **rclone**                                | A tool for copying files to cloud storage (R2, B2)                                            |
| **SemVer**                                | Version numbering `MAJOR.MINOR.PATCH`                                                         |
| **Git / GitHub**                          | A code change tracker / a place to host it                                                    |
| **Branch / merge / tag**                  | A line of work / combining branches / a marker for a release version                          |
| **EAS**                                   | Expo Application Services: builds the app on Expo's servers                                   |
| **APK / AAB**                             | Android app files: APK for installing directly, AAB for uploading to Google Play              |
| **Keystore**                              | The Android app signing key file; if lost, you cannot update the same app                     |
| **PPN**                                   | Indonesian VAT (Value Added Tax, 11%)                                                         |

---

## 17. Further reading and exercises

**Official documentation to read in order**

1. Docker: `docs.docker.com` (Get started, then Compose)
2. Caddy: `caddyserver.com/docs` (Caddyfile concepts)
3. Ubuntu Server: `ubuntu.com/server/docs`
4. PostgreSQL: `postgresql.org/docs` (the Backup and Restore section)
5. Prisma: `prisma.io/docs` (Migrate)
6. Let's Encrypt: `letsencrypt.org/docs` (How it works)
7. Grafana: `grafana.com/docs`

**Documents in this repo that complement this one**

- [Architecture](03-architecture.md): how requests flow through the code.
- [Deploying to a VPS](15-deployment.md): the full commands.
- [Production checklist](14-production-checklist.md): the list that must be satisfied before real stores use it.
- [Monitoring (Grafana)](13-monitoring.md): Grafana dashboards and alerts.
- [Offline sales](12-offline-sales.md): how offline transactions are sent safely.

**Questions to test your understanding** (answer on your own first, then check the docs):

1. Why must the API not open port 3000 to the internet? Who acts as the front door?
2. What happens in steps 2 to 5 when the cashier taps "Pay"?
3. Why is the PIN stored as a hash and not as plain text? Can you see a user's PIN in the database?
4. What is the difference between the login key `cashiermu_vps` and the deploy key `cashiermu_deploy`?
5. Why do we lower the DNS TTL before moving servers?
6. What is the risk of keeping backups only on the same server?
7. Why do we test the login from a second terminal before closing the first SSH session?
8. What happens to a transaction if the server is down for ten minutes, and how is it neither lost nor duplicated?

**Hands-on exercises** (safe because there is no real store data yet):

1. Stop the API and start it again: `docker compose -f docker-compose.prod.yml stop api`, check with `curl`, then `start api`. Notice when `/health` fails.
2. Watch the logs while you open `/health` a few times. Find `requestId` and `durationMs`.
3. Temporarily change the backup schedule to every minute, watch files appear in `~/backups`, then change it back.
4. Run `./restore-test.sh` and explain what each line does.
5. Find out: how much longer is the HTTPS certificate valid? (Hint: `openssl s_client`, or look in the browser.)
6. Rewrite section 6.2 in your own words without looking at the document.
