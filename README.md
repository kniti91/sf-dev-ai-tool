# VibeSafe API

Initial Express and TypeScript backend foundation for VibeSafe. The API listens on port `4500` by default.

## Start locally

```bash
npm install
npm run dev
```

Health check: `GET http://localhost:4500/health`

Development authentication is bypassed by default. Any login values create an ephemeral development session. Set `AUTH_BYPASS=false` to exercise password validation; bypass is always disabled when `NODE_ENV=production`.

## Salesforce Connected App setup

Create a Salesforce External Client App or Connected App with OAuth enabled. Configure the callback URL exactly as:

```text
http://localhost:4500/api/v1/org-connections/oauth/callback
```

Enable the API and refresh-token scopes, then create `.env` from `.env.example` and set:

```text
SALESFORCE_CLIENT_ID=<consumer key>
SALESFORCE_CLIENT_SECRET=<consumer secret, optional for a public PKCE client>
SALESFORCE_REDIRECT_URI=http://localhost:4500/api/v1/org-connections/oauth/callback
TOKEN_ENCRYPTION_KEY=<64 hexadecimal characters>
```

Generate an encryption key locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Restart the backend after changing `.env`. The UI supports both Production (`login.salesforce.com`) and Sandbox (`test.salesforce.com`) authorization.

After connecting, use **Sync components** in the Components screen. The backend retrieves Apex classes, triggers, and accessible LWC bundle resources through Salesforce Tooling API. Starting an analysis runs Salesforce Code Analyzer and AI analysis against transient source, then stores findings, summaries, recommendations, and scores without storing source code.

## Salesforce Code Analyzer v5

Local and worker environments require Salesforce CLI, Java, and the official Code Analyzer plugin:

```bash
npm install --global @salesforce/cli@latest
sf plugins install @salesforce/plugin-code-analyzer
sf code-analyzer run -h
```

The backend runs the `Recommended` rules once per component batch in an isolated temporary workspace and deletes that workspace in a `finally` block. Salesforce source is fetched in batches and is never persisted. AI analysis uses a bounded worker pool so a large scan does not issue an unbounded number of provider requests.

Configure batch behavior with `SCAN_COMPONENT_BATCH_SIZE` (default `100`) and `AI_COMPONENT_CONCURRENCY` (default `3`). Configure the analyzer executable and timeout with `SALESFORCE_CODE_ANALYZER_COMMAND` and `SALESFORCE_CODE_ANALYZER_TIMEOUT_MS`. Set `SALESFORCE_CODE_ANALYZER_ENABLED=false` only when a deployment intentionally uses the limited fallback rules.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

## Current endpoints

- `GET /health`
- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password`
- `GET /api/v1/auth/session`
- `GET /api/v1/org-connections`
- `POST /api/v1/org-connections/oauth/start`
- `GET /api/v1/org-connections/oauth/callback`
- `DELETE /api/v1/org-connections/:id`
- `GET /api/v1/org-connections/:id`
- `POST /api/v1/org-connections/:id/discover`
- `GET /api/v1/org-connections/:id/artifacts`
- `GET /api/v1/scans`
- `POST /api/v1/scans`
- `GET /api/v1/scans/:id`
- `GET /api/v1/scans/:id/items`
- `GET /api/v1/scans/:id/items/:artifactId/source-context`
- `POST /api/v1/scans/:id/cancel`
- `GET /api/v1/scans/:id/findings`
- `GET /api/v1/findings`
- `GET /api/v1/findings/:id`
- `POST /api/v1/findings/:id/explanation`

## Current boundary

Runtime persistence uses PostgreSQL through Prisma. Salesforce OAuth tokens are encrypted, source code is transient, and OpenAI is the current AI provider. A durable external job worker and Claude provider remain future increments.
