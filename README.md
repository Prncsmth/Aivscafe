# Aiv's Cafe

POS, inventory, cash shifts, delivery tracking and sales/profit reports for **Yummy Brew Blend & Takoyaki Delight by Aiv's Cafe** (Hamugaway Lifestyle Hub, Cordova, Cebu). The POS keeps working when the internet drops and syncs safely when it returns.

```
AIV'S CAFE/
├── BACKEND/    Express + TypeScript REST API, Prisma ORM, PostgreSQL (Neon)
└── FRONTEND/   Next.js 16 + React 19 + Tailwind 4, installable PWA with offline POS
```

The two projects are independent: separate `package.json`, `.env`, build and deploy. The frontend never talks to the database. It only calls the API.

---

## 1. Setup

Requirements: Node.js 20+ and a Neon PostgreSQL database.

### Backend
```bash
cd BACKEND
npm install
cp .env.example .env          # fill in the values (see below)
npx prisma migrate deploy     # create tables
npm run db:seed               # OPTIONAL demo data + demo logins (owner / cashier)
# or, for a clean production database:
#   OWNER_NAME="..." OWNER_USERNAME=... OWNER_PASSWORD='...' npm run db:setup-owner
npm run dev                   # http://localhost:<PORT>/api
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) |
| `DIRECT_URL` | Neon **direct** connection string (used by migrations) |
| `PORT` | API port |
| `NODE_ENV` | `development` or `production` |
| `CORS_ORIGINS` | Comma-separated frontend origins allowed to call the API |
| `JWT_ACCESS_SECRET` | Long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | Session lifetimes |
| `COOKIE_SAMESITE` / `COOKIE_SECURE` | `lax`/`false` for localhost. Use `none`/`true` when frontend and backend are on different domains (HTTPS) |
| `BUSINESS_TIMEZONE` | `Asia/Manila`. Used for daily order numbers and reports |

### Frontend
```bash
cd FRONTEND
npm install
cp .env.example .env          # NEXT_PUBLIC_API_URL=https://your-api/api
npm run dev                   # development (no service worker)
npm run build && npm start    # production build: static files in out/ + offline service worker
```
`NEXT_PUBLIC_API_URL` is inlined at build time, so rebuild after you change it. A production build fails if it is missing.

### Deploying
- **Backend:** any Node host (Render, Railway, Fly, a VPS). Use `npm run build`, then `npm run db:deploy`, then `npm start`. Set the env vars there, with `NODE_ENV=production`, `CORS_ORIGINS=https://<frontend>`, `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`.
- **Frontend:** the `out/` folder is plain static files. Deploy it to Netlify, Vercel (static), Cloudflare Pages or any web server. It must be served over HTTPS for the service worker (offline mode) to work.

### Go-live checklist (Neon Singapore + Render + Vercel)
1. **Neon:** create a project in **AWS Asia Pacific (Singapore)**. Put its pooled and direct URLs in `BACKEND/.env` (never in `.env.example`).
2. **Tables:** `cd BACKEND && npx prisma migrate deploy`.
3. **Owner account:** set `OWNER_NAME`, `OWNER_USERNAME` and `OWNER_PASSWORD` in your terminal, then run `npm run db:setup-owner`. Do not run the demo seed.
4. **Menu:** confirm the prices in `BACKEND/prisma/menu.json`, then run `npm run menu:import -- --dry-run` to check and `npm run menu:import` to import.
5. **GitHub:** push the repo. `.env` files are git-ignored; check that no real password is in any `.env.example`.
6. **Render:** go to New → Blueprint and pick the repo (`render.yaml`). Fill in `DATABASE_URL`, `DIRECT_URL` and `CORS_ORIGINS` (your Vercel URL).
7. **Vercel:** create a new project from the repo with root directory `FRONTEND`. Set the env var `NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com/api`.
8. Sign in on the real URL. Then on Menu & Prices add recipes, on Purchases enter the current stock, and on Users create the cashier accounts.

### Tests
```bash
cd BACKEND  && npm test    # 58 tests: API, permissions, inventory, shifts, reports, offline sync
cd FRONTEND && npm test    # 18 tests: offline outbox / sync engine, cart & money math
```
The backend tests start their own throwaway PostgreSQL (embedded-postgres) and **never touch your Neon data**. To run them against a disposable Neon branch, set `TEST_DATABASE_URL`. The tests erase whatever database it points to.

---

## 2. What it solves

| Problem at the stall | How the system handles it |
|---|---|
| Manual order taking, wrong totals/change | Touch POS; the server re-prices every online order; change computed automatically; integer-centavo math (no float errors) |
| Inconsistent prices (menu board vs counter) | One price list (Menu page); every price change is audited and bumps the catalog version |
| Untracked ingredients, running out mid-night | Recipes per size and add-on; stock deducted on every order; low-stock and out-of-stock badges on the POS |
| Expired ingredients | Purchases create expiry batches; "expiring soon" list; waste/spoilage log |
| Unclear profit | Reports separate revenue, COGS, gross profit, expenses, inventory losses and estimated net operating profit, and warn when data is incomplete |
| Cash discrepancies | Shifts with starting cash, cash in/out, expected vs counted cash, GCash kept separate; big differences go to the owner for review |
| Messy delivery / Messenger orders | Order types Walk-in, Delivery, Messenger; delivery areas with fees; strict status workflow; live queue board |
| Internet drops at the night market | Offline POS with IndexedDB outbox and idempotent sync (below) |

---

## 3. Roles

Enforced **on the backend**. The UI only hides what a role cannot use.

- **Owner:** everything: menu, prices, recipes, ingredients, purchases, suppliers, stock counts, expenses, reports, users, settings, audit log, sync-conflict review, shift review, voids.
- **Cashier:** open/close own shift, cash in/out, POS, order queue and status, record payments, verify GCash, cancel **pending** orders, record waste, and view stock levels (no costs). Cashiers cannot change prices, manage users, see profit/costs, void completed orders, adjust stock counts or alter history. Order history is limited to the last 3 days.

---

## 4. Offline POS: how it works

1. While online, the app caches the **catalog, settings and current shift** in IndexedDB. After the first visit, the service worker caches the whole app.
2. When offline (the browser reports offline or `/api/health` fails), or when an online submit gets **no response**, the order is written to an **IndexedDB outbox** with:
   - a client-generated UUID `clientId` (the idempotency key)
   - a temporary receipt number `OFF-XXXX-0001`
   - the catalog version
   - the prices that were charged
3. A sync engine sends pending orders to `POST /api/sync/orders`. It runs when the connection returns and every 15 seconds, and you can also retry by hand on the **Sync** page. Retries use exponential backoff: 8 automatic attempts, then manual.
4. The server processes **each order in its own transaction**:
   - `Order.clientId` is UNIQUE. A repeated or concurrent send returns the first result, so a request that succeeded but lost its response is never duplicated.
   - Inventory is deducted once per order: an `inventoryDeductedAt` guard plus a UNIQUE `(orderId, ingredientId, SALE)` key in the stock ledger.
   - The price that was charged is kept. If it differs from the current menu price, a **PRICE_MISMATCH** conflict is flagged. Newer server prices are never overwritten.
   - The sale is accepted even if stock goes negative (the customer was already served), and an **INSUFFICIENT_STOCK** conflict is flagged.
   - Other flags: unavailable item, cashier discount over the limit, shift already closed.
   - Offline **GCash is always UNVERIFIED** until someone verifies it.
5. The device marks an order **Synced** only after the server acknowledges it. Unsynced orders are never deleted. Synced ones are pruned after 7 days.

**Limitations (by design):**
- Two devices that are offline at the same time do **not** share orders or stock. Each keeps its own outbox. Stock can be over-sold between them, and this shows up as INSUFFICIENT_STOCK conflicts after sync.
- Offline sign-in reuses the last profile that signed in on the device and allows POS use only. The session is refreshed when the connection returns.
- The offline catalog is only as fresh as the last online visit. The POS shows when the prices were saved.
- The shift must be opened online.

---

## 5. Business rules and assumptions

- **Money:** integer centavos everywhere (₱49.00 = `4900`).
- **Units:** each ingredient is stored in a base unit (g, ml or pcs). Purchases can be entered in kg or L and are converted. Incompatible units are rejected.
- **Costing:** weighted-average cost, recalculated on each purchase. COGS is recipe quantity × average cost at the time of sale. Purchases are inventory, not expenses.
- **Batches/expiry:** used for expiry tracking (consumed first-expiry-first-out). Costing stays weighted-average.
- **Insufficient stock (online):** blocked by default, and the owner can override (audited). This is configurable on the Settings page. Negative stock is never silent.
- **Order workflow:** Pending → Preparing → Ready → Completed (pick-up), or → Out for delivery → Delivered (delivery). One step at a time. Completion requires full payment.
- **Cancel vs void:**
  - Cashiers can cancel *pending* orders, and ingredients are restored automatically.
  - Later cancellations and voids of completed orders are owner-only. Ingredients count as used unless the owner chooses to restore them, and they are restored at most once.
  - Payments are refunded and recorded on the acting user's shift.
- **Expected cash** = starting cash + cash received − cash refunds + cash in − cash out. GCash is never counted as cash.
- **Messenger orders** are typed in by staff. There is no Facebook integration.
- **Demo seed:** every menu price, recipe quantity, cost, stock level and delivery fee in `prisma/seed.ts` is illustrative. Replace them on the Menu, Inventory and Settings pages before real use. Defaults in Settings (20% max cashier discount, ₱50 review threshold, 3-day expiry warning) are placeholders.

---

## 6. API overview

All endpoints are under `/api` and return `{ success, data, meta? }` or `{ success: false, error: { code, message, details } }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Catalog | `GET /catalog`, `GET /catalog/admin`, `POST/PATCH /categories`, `POST/PATCH /products`, `POST /products/:id/variants`, `PATCH /variants/:id`, `PUT /variants/:id/recipe`, `POST/PATCH /modifiers`, `PUT /modifiers/:id/recipe` |
| Orders | `GET /orders`, `GET /orders/queue`, `GET /orders/:id`, `POST /orders`, `POST /orders/:id/status`, `POST /orders/:id/cancel`, `POST /orders/:id/void`, `POST /orders/:id/payments`, `GET /payments/unverified`, `POST /payments/:id/verify` |
| Inventory | `GET/POST/PATCH /ingredients`, `POST /ingredients/:id/adjust`, `POST /ingredients/:id/waste`, `GET /ingredients/:id/batches`, `GET /inventory/low-stock`, `GET /inventory/expiring`, `GET /inventory/movements`, `GET /inventory/valuation` |
| Purchasing | `GET/POST/PATCH /suppliers`, `GET/POST /purchases`, `GET /purchases/:id` |
| Shifts | `GET /shifts/current`, `POST /shifts/open`, `POST /shifts/current/cash-movements`, `POST /shifts/:id/close`, `GET /shifts`, `GET /shifts/:id`, `POST /shifts/:id/review` |
| Finance | `GET/POST/PATCH/DELETE /expenses`, `GET /reports/sales`, `GET /reports/inventory-consumption`, `GET /reports/waste`, `GET /reports/shifts`, `GET /dashboard/owner`, `GET /dashboard/cashier` |
| Sync | `POST /sync/orders`, `GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve` |
| Admin | `GET/POST/PATCH /users`, `GET/PATCH /settings`, `GET/POST/PATCH /delivery-areas`, `GET /audit-logs`, `GET /health` |

### Security measures
- **Passwords:** bcrypt (cost 12). Minimum 8 characters, and not the same as the username.
- **Login throttling:** counted in the database, so it survives restarts.
  - 5 wrong passwords lock that account for 15 minutes.
  - 20 failures from one IP block that IP for 15 minutes.
  - On top of that, there is a per-IP rate limit.
- **Access tokens:** HS256 JWT signed with `JWT_ACCESS_SECRET`, valid 15 minutes, kept in memory only. The algorithm, issuer and audience are pinned. Permissions always come from the database role, never from the token.
- **Refresh tokens:** random 384-bit token in an httpOnly, Secure, SameSite cookie. Only its SHA-256 hash is stored, and it rotates on every use. Replaying an old token revokes all of that user's sessions and is audited.
- **CSRF:** cookie endpoints reject foreign `Origin` headers. CORS only allows `CORS_ORIGINS`.
- **API:** Helmet headers, `Cache-Control: no-store`, a 300 requests/min per-IP limit, Zod validation on all input, and role checks on the server.
- **Frontend (Vercel):** CSP, HSTS, `X-Frame-Options: DENY`, nosniff, a referrer policy and a permissions policy. The offline sign-in expires 12 hours after the last online sign-in.
- **Startup checks:** in production the API refuses to start with a weak JWT secret, a non-https or localhost CORS origin, or insecure cookies.
- **Audit log:** records logins, failed logins, lockouts, token reuse, price changes, voids, stock adjustments and overrides.

Security: bcrypt password hashing; short-lived JWT access tokens kept in memory only; rotating refresh tokens in an httpOnly cookie (only a hash is stored server-side); rate-limited login; Helmet; strict CORS; Zod validation on every body, query and route parameter; and an audit log for sensitive actions.
