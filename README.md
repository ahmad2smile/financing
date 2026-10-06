# Solar financing calculator

Enter your details and get a system price, a risk band and three installment offers (5, 10 and 15 years).

## Run

```bash
pnpm install
cp .env.example .env     # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d     # Postgres :5432, Keycloak :8080
pnpm dev                 # http://localhost:3000, must be this port: Keycloak calls back to it
```

- `/` is the quote form. Signed-out visitors see a link that goes through Keycloak sign in first.
- `/quotes` lists the signed-in user's own quotes, newest first, 10 per page (`?page=2`).
- `/admin/quotes` lists every user's quotes with their owner, 10 per page. Only admins see the nav bar link, others get a 404.
- Both pages render `app/quotes/quotes.tsx` with a scope (`user` or `admin`) after the page checks sign in (and admin). It reads one page from Postgres on the server. The table (`app/quotes/quotes-table.tsx`, shadcn's Table) runs in the browser, so dates show in the viewer's time zone. The page buttons are links.
- UI components come from shadcn with Base UI (`components.json`, `components/ui`). Add more with `pnpm dlx shadcn@latest add <name>`.
- Keycloak admin: http://localhost:8080, `admin` / `admin`. Realm `financing` from `docker/keycloak/financing-realm.json`.
- Seeded users: `admin@test.com` / `admin`, `user@test.com` / `user`. Sign up is open.

`NEXT_PUBLIC_PRICE_PER_KW` in `.env` sets the price of 1 kW for the app and the Postgres money limit. It is fixed at build time and when the Postgres volume is created, so after a change rebuild and reset.

Postgres runs `docker/postgres/*.sql` and Keycloak imports the realm only on first start. After changing them, reset with `docker compose down -v && docker compose up -d`.

## Auth

Better Auth with Keycloak (`lib/auth.ts`), sessions in Postgres.

- Every user needs a first and last name. The app copies "first last" and the email from Keycloak on every sign in.
- Roles come from Keycloak too: realm role `admin` (seeded on `admin@test.com`) is copied to `user.role` on every sign in. A role change applies at the user's next sign in.
- Sign out ends both the app and the Keycloak session.
- When a Keycloak session ends anywhere, Keycloak calls `POST /api/backchannel-logout` and the app ends **all** sessions of that user, on every device.

## Database

Schema in `docker/postgres/*.sql`. Every quote is saved in `quote` with its offers in `quote_offer`, and is never changed or deleted.

- Money columns use the `amount` type: `numeric(12, 2)`, so whole cents only, from 0 to 1000x the biggest possible price (1000 kW x `NEXT_PUBLIC_PRICE_PER_KW`).
- Row level security: a user sees only their own quotes, an admin sees all. Nobody can add a quote for someone else.
- `docker/postgres/04-seed.sql` seeds the two test users with their accounts and quotes. Each account links to Keycloak by user id, so the realm file pins those ids. Regenerate it from a running database with `pg_dump --data-only --column-inserts -t '"user"' -t quote -t quote_offer`, plus the account rows without tokens.
- The app connects as `financing`. `superuser` only runs the setup scripts: the app must never connect as it, because it skips row level security. For each save it sets `app.user_id` for that transaction only (`data/quote-store.ts`).
- The app refuses to start, and refuses every new connection, if its role is a superuser or has `bypassrls` (`data/db.ts`, `instrumentation.ts`).

## Scripts

| Script                         | What it does                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `pnpm test`                    | Jest unit tests                                                                     |
| `pnpm test:e2e:install`        | One-time Chromium download                                                          |
| `pnpm test:e2e`                | Playwright tests, needs `docker compose up -d` (builds the app and runs it on 3100) |
| `pnpm lint`                    | ESLint                                                                              |
| `pnpm format` / `format:check` | Prettier write / check                                                              |

## API

`POST /api/quotes` with a JSON body and a signed-in session cookie. Name and email come from the session, never the body.

| Field                   | Rule                                              |
| ----------------------- | ------------------------------------------------- |
| `requestId`             | UUID, the same on every retry of one quote        |
| `address`               | Non-empty text                                    |
| `monthlyConsumptionKwh` | Number above 0, max 100000, at most 2 decimals    |
| `systemSizeKw`          | Number 1 to 1000, at most 2 decimals              |
| `downPayment`           | Optional (default 0), cents only, below the price |

A repeat of a saved `requestId` saves nothing, so a retry never adds a duplicate. The form makes the id from the inputs and a random value per page load, so a resubmit of the same inputs repeats it.

Price is `systemSizeKw * 1200`, rounded to cents. All rules live in `lib/quote.ts`.

| Status | Body                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `200`  | `{ systemPrice, band, offers: [{ termYears, apr, principalUsed, monthlyPayment }] }`. Sent even if saving fails (logged) |
| `400`  | Body is not JSON: `{ errors: { form } }`                                                                                 |
| `401`  | Not signed in: `{ errors: { form } }`                                                                                    |
| `422`  | Invalid input: `{ errors: { <field>, form? } }`                                                                          |
| `500`  | Unexpected error: logged, no details                                                                                     |
