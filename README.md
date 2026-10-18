# CashierMu API — Backend Setup Guide

> **Developers:** coding standards, git workflow, how to add a feature and how versioning works are in [`docs/`](docs/README.md) (English).

A complete guide from zero to a running server integrated with the React Native app.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install PostgreSQL](#2-install-postgresql)
3. [Install pgAdmin (Database GUI)](#3-install-pgadmin-database-gui)
4. [Clone & Install Dependencies](#4-clone--install-dependencies)
5. [Setup Environment Variables](#5-setup-environment-variables)
6. [Setup Database](#6-setup-database)
7. [Run the Server](#7-run-the-server)
8. [Test the API](#8-test-the-api)
9. [Integration with React Native](#9-integration-with-react-native)
10. [Daily Commands](#10-daily-commands)
11. [Project Structure](#11-project-structure)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Make sure the following are installed before you start:

| Tool | Minimum Version | Check with |
|------|--------------|------------|
| Node.js | 20.12.0+ | `node --version` |
| npm | 9+ | `npm --version` |
| Homebrew (Mac) | latest | `brew --version` |

### Install Node.js (if not installed yet)

```bash
# Install nvm (Node Version Manager) first
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Restart your terminal, then install the latest Node.js version
nvm install 22
nvm use 22
nvm alias default 22

# Verify
node --version  # should be v22.x.x
```

### Install Homebrew (Mac, if not installed yet)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## 2. Install PostgreSQL

PostgreSQL is the database this project uses. Think of it as a "data warehouse" where all information (products, transactions, users, etc.) is stored permanently.

### Install via Homebrew

```bash
brew install postgresql@14
```

### Start PostgreSQL automatically when the Mac boots

```bash
brew services start postgresql@14
```

### Verify PostgreSQL is running

```bash
pg_ctl status -D /opt/homebrew/var/postgresql@14
# You should see: "server is running"
```

### Check your PostgreSQL username

Your PostgreSQL username is automatically the same as your Mac username:

```bash
whoami
# Example output: dikomahendra
```

> **Note:** You will use this username later in `DATABASE_URL` in the `.env` file.

---

## 3. Install pgAdmin (Database GUI)

pgAdmin is a visual app for browsing and managing databases — like "Finder" but for data.

### Download

Open [pgadmin.org/download/pgadmin-4-macos](https://www.pgadmin.org/download/pgadmin-4-macos/) and download the latest version.

- Mac chip **Apple Silicon (M1/M2/M3/M4)** → download **ARM64**
- Mac chip **Intel** → download **x86_64**

> Check your Mac's chip: click the Apple logo → **About This Mac** → look at **Chip** or **Processor**.

### Connect to local PostgreSQL

Once pgAdmin is open:

1. Right-click **Servers** → **Register** → **Server...**
2. **General** tab → Name: `CashierMu Local`
3. **Connection** tab:
   - Host: `localhost`
   - Port: `5432`
   - Username: enter the `whoami` result from earlier (example: `dikomahendra`)
   - Password: leave empty
4. Click **Save**

---

## 4. Clone & Install Dependencies

```bash
# Go into the project folder
cd server-cashiermu

# Install all required packages
npm install
```

---

## 5. Setup Environment Variables

Environment variables are secret configuration that is not committed to Git (such as the database password, JWT secrets, etc.).

### Create the `.env` file

```bash
cp .env.example .env
```

### Edit the `.env` file

Open the `.env` file and adjust the values:

```env
NODE_ENV=development
PORT=3000

# Replace "whoami_usernamemu" with the output of: whoami
DATABASE_URL=postgresql://whoami_usernamemu@localhost:5432/cashiermu

# Generate a long random string for JWT security
# Run this command in the terminal to get the value:
# node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
JWT_ACCESS_SECRET=fill_with_a_long_random_string_at_least_32_characters
JWT_REFRESH_SECRET=fill_with_a_different_long_random_string

JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

FRONTEND_ORIGIN=http://localhost:8081
MAX_LOGIN_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=5
```

### Generate the JWT Secret

Run this command twice (for ACCESS and REFRESH) and copy the results into `.env`:

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
```

---

## 6. Setup Database

### Create the `cashiermu` database

```bash
psql postgres -c "CREATE DATABASE cashiermu;"
```

### Run the migration

A migration is a command that creates all the tables in the database based on `prisma/schema.prisma`. Think of it as "deploying a spreadsheet structure" to the database.

```bash
npx prisma migrate dev --name init
```

Expected output:
```
✔ Generated Prisma Client
✔ Applied 1 migration
```

### Fill in initial data (seed)

Seeding fills the database with dummy data for development (users, products, branches, etc.).

```bash
npm run db:seed
```

Expected output:
```
🌱 Seeding database...
✅ Seed complete!

👤 Login credentials:
   Owner  → email: budi@cashiermu.com    PIN: 123456
   Kasir1 → email: siti@cashiermu.com    PIN: 111111
   Kasir2 → email: ahmad@cashiermu.com   PIN: 222222
```

### Verify in pgAdmin

Open pgAdmin → **CashierMu Local** → **Databases** → **cashiermu** → **Schemas** → **Tables**

You should see tables such as: `User`, `Product`, `Transaction`, dll.

---

## 7. Run the Server

```bash
npm run dev
```

Expected output:
```
info: CashierMu API running on port 3000 in development mode
```

The server is now running at `http://localhost:3000`.

> The server restarts automatically every time you save a code change (hot reload via nodemon).

---

## 8. Test the API

### Option 1 — curl (via Terminal)

**Check that the server is up:**
```bash
curl http://localhost:3000/health
# Output: {"status":"ok","timestamp":"..."}
```

**Login:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"credential":"budi@cashiermu.com","pin":"123456"}'
```

Output: you will get an `accessToken` and a `refreshToken`.

**Access an endpoint that requires login** (use the accessToken from login):
```bash
curl http://localhost:3000/api/v1/store \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN_HERE"
```

### Option 2 — Postman (Recommended, more convenient)

1. Download **Postman** from [postman.com](https://www.postman.com/) (free)
2. Create a new request → `POST` → `http://localhost:3000/api/v1/auth/login`
3. **Body** tab → **raw** → **JSON** → enter:
   ```json
   {
     "credential": "budi@cashiermu.com",
     "pin": "123456"
   }
   ```
4. Click **Send** → copy the `accessToken` from the response
5. For other endpoints, add it in the **Authorization** tab → **Bearer Token** → paste the token

### Option 3 — Prisma Studio (visual data browser)

```bash
npx prisma studio
```

Open `http://localhost:5555` — you can see all tables and data directly in the browser.

---

## 9. Integration with React Native

Once the server is running, replace all dummy data in the React Native app with API calls to this server.

### Base URL

| Environment | URL |
|-------------|-----|
| Development (emulator) | `http://localhost:3000` |
| Development (physical device) | `http://YOUR_MAC_IP:3000` |

> Check your Mac's IP: **System Settings** → **Wi-Fi** → **Details** → look at the IP Address. Make sure your phone and Mac are on the same Wi-Fi network.

### Integration Order (following `BACKEND_PROMPT.md`)

Replace the dummy data in the Zustand store one by one, starting with:

1. **Login** → `POST /api/v1/auth/login` — replace `useAppStore.login()`
2. **Store profile** → `GET /api/v1/store` — replace `DUMMY_STORE_PROFILE`
3. **Branches** → `GET /api/v1/branches` — replace `DUMMY_BRANCHES`
4. **Categories** → `GET /api/v1/categories` — replace `DUMMY_CATEGORIES`
5. **Products** → `GET /api/v1/products` — replace `DUMMY_PRODUCTS`
6. **Shift** → `POST /api/v1/shifts/open` + `GET /api/v1/shifts/current`
7. **Transactions** → `POST /api/v1/transactions`
8. **Transaction history** → `GET /api/v1/transactions`
9. **Void transaction** → `POST /api/v1/transactions/:id/void`
10. **Reports** → `GET /api/v1/reports/chart` + `/summary`
11. **Employees** → `GET /api/v1/users` + `POST /api/v1/users`

### Example API call from React Native (Axios)

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
});

// Login
const response = await api.post('/auth/login', {
  credential: 'budi@cashiermu.com',
  pin: '123456',
});
const { accessToken, user } = response.data;

// Store the token (use expo-secure-store, NOT AsyncStorage)
await SecureStore.setItemAsync('accessToken', accessToken);

// Request with the token
api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
const products = await api.get('/products');
```

---

## 10. Daily Commands

| Command | Purpose |
|----------|--------|
| `npm run dev` | Run the server (development) |
| `npm run build` | Build for production |
| `npx prisma studio` | Open the visual database UI |
| `npx prisma migrate dev --name name` | Create a new migration after changing the schema |
| `npm run db:seed` | Reset and re-seed the dummy data |
| `npx prisma generate` | Regenerate the Prisma Client after changing the schema |

---

## 11. Project Structure

```
server-cashiermu/
├── prisma/
│   ├── schema.prisma      # Definition of all database tables
│   └── seed.ts            # Script that fills in dummy data
├── src/
│   ├── config/
│   │   ├── env.ts         # Reads variables from .env
│   │   └── database.ts    # PostgreSQL connection via Prisma
│   ├── middleware/
│   │   ├── authenticate.ts  # Verifies the JWT token
│   │   ├── requireRole.ts   # Checks the role (owner/cashier)
│   │   ├── validate.ts      # Validates the request body (Zod)
│   │   └── errorHandler.ts  # Global error handling
│   ├── modules/           # Each feature has its own folder
│   │   ├── auth/          # Login, logout, refresh token
│   │   ├── store/         # Store profile
│   │   ├── users/         # Employee management
│   │   ├── branches/      # Branch management
│   │   ├── categories/    # Product categories
│   │   ├── products/      # Product and stock management
│   │   ├── shifts/        # Open/close cashier shifts
│   │   ├── transactions/  # Transactions and voids
│   │   ├── pending-bills/ # Pending bills (hold order)
│   │   └── reports/       # Sales reports
│   ├── utils/
│   │   ├── invoice.ts     # Generates invoice numbers
│   │   ├── pagination.ts  # Pagination helper
│   │   └── logger.ts      # Logging (Winston)
│   └── app.ts             # Server entry point
├── .env                   # Secret configuration (do not commit!)
├── .env.example           # .env template
├── package.json
└── tsconfig.json
```

---

## 12. Troubleshooting

### Error: `Can't reach database server`
Make sure PostgreSQL is running:
```bash
brew services start postgresql@14
```

### Error: `relation does not exist`
The migration has not been run:
```bash
npx prisma migrate dev --name init
```

### Error: `JWT_ACCESS_SECRET is required`
The `.env` file has not been created, or the JWT secret is still a placeholder. Make sure you followed [Step 5](#5-setup-environment-variables).

### Error: `Port 3000 already in use`
Another process is using port 3000:
```bash
# Find the process using port 3000
lsof -i :3000

# Kill the process (replace PID with the number from the output above)
kill -9 PID
```

### After changing `schema.prisma`, the tables did not change
Run a new migration:
```bash
npx prisma migrate dev --name change_description
```
