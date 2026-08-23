# Discipline+

Discipline+ is a private fitness, habit, scheduling, and progress-tracking app. Production keeps the existing Hostinger website and uses Cloudflare for the backend:

- Hostinger serves the React single-page app at `fitness.aparishhouse.com` from the `main` branch.
- Cloudflare Workers provides the authenticated API at `discipline-plus.bfust27.workers.dev`.
- Cloudflare D1 stores profiles, exercises, plans, schedules, and progress logs.
- Cloudflare Access protects the Worker API, and the Worker permits only the configured owner email.
- The Worker calls OpenAI for spreadsheet-to-plan analysis.

## Development

Install dependencies and initialize the local D1 database:

```powershell
npm install
npm run db:migrate:local
```

Create a `.dev.vars` file with local-only values for the two declared secrets:

```dotenv
ALLOWED_EMAIL=developer@example.com
OPENAI_API_KEY=your-local-api-key
```

Then run the Cloudflare development server:

```powershell
npm run dev:cloudflare
```

The ordinary `npm run dev` command starts only Vite and is useful for frontend styling work; backend requests require the Cloudflare development server.

## Verification

```powershell
npm run lint
npm run build
npm run deploy:check
```

## Production setup

The production Worker is configured in `wrangler.jsonc` for the `discipline-plus` D1 database. Hostinger remains authoritative for `aparishhouse.com` and continues to host the frontend.

1. Authenticate Wrangler with `npx wrangler login`.
2. Create the database with `npx wrangler d1 create discipline-plus` and record the generated database ID in `wrangler.jsonc`.
3. Apply the schema with `npm run db:migrate:remote`.
4. Add `ALLOWED_EMAIL` and `OPENAI_API_KEY` as encrypted Worker secrets.
5. Set the Cloudflare Access team domain and application audience in `wrangler.jsonc`.
6. Deploy with `npm run deploy`.
7. Protect the `discipline-plus` Worker with a Cloudflare Access application. The frontend uses a top-level Access login redirect and then calls the Worker with encrypted Access credentials.

The first authorized production request creates the owner's profile. On first load, the app seeds its built-in starter exercise library into D1.
