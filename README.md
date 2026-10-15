# Sava partner API

Small REST API PoC built with Node.js 20, Express, Neon PostgreSQL (`pg`), and Zod validation. All partner data is scoped to the authenticated partner. Dates are ISO `YYYY-MM-DD`, timestamps are UTC ISO 8601 strings, and amounts are integer AOA. Business-day defaults use `Africa/Luanda`.

Route handlers are grouped by domain in `src/routes/` (`auth`, `properties`, `reservations`, `booking-links`, `guests`, `payments`, `analytics`, and `settings`). Shared database access, authentication, validation, serializers, and reservation creation live in `src/lib/shared.js`; `src/server.js` wires routes, middleware, and docs.

## Run locally

Add a Neon connection string to `.env` as `DATABASE_URL=postgresql://...` (the Neon pooled URL is suitable for the API). Install dependencies, apply the schema, seed demo data, and start:

```sh
npm install
npm run migrate
npm run seed
npm start
```

The server listens on `http://localhost:3000`; set `PORT` to change it. `PUBLIC_BASE_URL` sets the origin used for share links. Demo credentials: `marta@sava.ao` / `SavaDemo2026!` (override the seeded password with `DEMO_PASSWORD` when seeding). `DB_POOL_MAX` controls the PostgreSQL connection pool size; Neon serverless deployments can set a small value.

## Docker

Build the image with `docker build -t sava-api .`. Apply migrations with `docker run --rm --env-file .env sava-api npm run migrate`, then seed with `docker run --rm --env-file .env sava-api npm run seed`. Start the API with `docker run --rm -p 3000:3000 --env-file .env -v sava-uploads:/app/uploads sava-api`. The Neon database remains external; `DATABASE_URL` is provided from the host `.env` file at runtime and is excluded from the image.

The idempotent PostgreSQL schema is in `migrations/001_init.sql`. Use `npm run migrate` after changing it. `npm run seed` adds demo listings and reservations without clearing existing records. Uploaded property images are stored under `uploads/` and served from `/uploads`.

## API and verification

- API base: `/api/v1`
- Swagger UI: `/api/v1/docs`
- OpenAPI JSON: `/api/v1/openapi.json`
- Tests: `npm test`

The integration test creates a temporary schema inside the configured PostgreSQL database and removes it afterward. Set `DATABASE_URL` to a Neon connection string before running it. Payment records are demo bookkeeping entries only; no payment provider is connected. Booking links expire after seven days. The public link response intentionally excludes street address, partner identity, and contact details.

Reservation prices are calculated from the current property nightly rate and the date range. Status changes follow pending → confirmed → checked_in → completed, with cancellation permitted from pending, confirmed, or checked_in. This PoC does not yet implement provider webhooks, email/notification delivery, image object storage, multi-currency, rate calendars, or review ingestion. Rating and occupancy figures in the seed data are static demo metrics.
