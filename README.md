# Solar financing calculator

Enter your details and get a system price, a risk band and three installment offers (5, 10 and 15 years).

## Run

```bash
pnpm install
pnpm dev                 # http://localhost:3000
```

## Scripts

| Script                         | What it does                                         |
| ------------------------------ | ---------------------------------------------------- |
| `pnpm test`                    | Jest unit and API route tests                        |
| `pnpm test:e2e:install`        | One-time Chromium download into `node_modules`       |
| `pnpm test:e2e`                | Playwright browser tests (builds and starts the app) |
| `pnpm lint`                    | ESLint                                               |
| `pnpm format` / `format:check` | Prettier write / check                               |

## API

`POST /api/quotes` with a JSON body. Numbers must be JSON numbers, not strings.

| Field                   | Rule                                              |
| ----------------------- | ------------------------------------------------- |
| `fullName`, `address`   | Non-empty text                                    |
| `email`                 | Valid email                                       |
| `monthlyConsumptionKwh` | Above 0, max 100000                               |
| `systemSizeKw`          | 1 to 1000, at most 2 decimals                     |
| `downPayment`           | Optional (default 0), cents only, below the price |

Price is `systemSizeKw * 1200`, rounded to cents.

Responses:

- `200` `{ systemPrice, band, offers: [{ termYears, apr, principalUsed, monthlyPayment }] }`
- `400` body is not JSON: `{ errors: { form } }`
- `422` invalid input: `{ errors: { <field>, form? } }`. `form` holds errors for the whole request.

All rules live in `lib/quote.ts`. The form uses react-hook-form with `formSchema`, which applies the same rules to the typed text (digits, optional thousands commas, optional decimals).
