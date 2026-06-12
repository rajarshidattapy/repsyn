# repsyn

> Bridge any AI chat frontend to a **live local repo** via a standard REST + OpenAPI protocol.

ChatGPT and Claude have no live connection to your local codebase. `reposync` spins up a
local file-watcher server with a REST API, auto-generates an OpenAPI spec, and tunnels it
out so a Custom GPT Action or Claude Project can read your repo **as it changes** — no
copy-pasting, no snapshots, no switching editors.

**One command to start. One URL to paste. Live from that point on.**

```bash
npx reposync
```
---

## Quick start

```bash
# In your repo root:
npx reposync --no-tunnel          # local/LAN only, no account needed
# or, with a public tunnel:
export NGROK_AUTHTOKEN=...         # free token at https://dashboard.ngrok.com
npx reposync                      # ngrok tunnel (default)
```

On start you'll see:

```
RepoSync v0.1.0
  Repo:     /Users/you/my-project (1,203 files indexed)
  Local:    http://localhost:3210
  Tunnel:   https://a1b2c3.ngrok.io   ← paste this + /openapi.json into your GPT Action
  Auth key: rs_live_x9k2mq...         ← add as Bearer token in your GPT Action auth

  Watching for changes...
```

---

## CLI

```bash
npx reposync [options]

--port <number>     Port to bind (default: 3210)
--repo <path>       Repo path (default: cwd)
--tunnel <p>        Tunnel provider: ngrok | cloudflare | none (default: ngrok)
--auth-key <token>  Static bearer token (default: auto-generated, printed on start)
--ignore <globs>    Comma-separated glob patterns to exclude (merged with .reposyncignore)
--no-tunnel         Disable tunnel, LAN-only
--openapi           Print OpenAPI spec and exit (for manual GPT setup)
```

> **Note:** Cloudflare tunnels are a v2 feature. Use `ngrok` or `--no-tunnel` for now.

---

## API surface

All endpoints live on `localhost:{port}`, are exposed via the tunnel, and require an
`Authorization: Bearer <auth-key>` header (except `/health`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/files` | Recursive file tree (respects `.reposyncignore`) |
| GET | `/file?path=` | Read a single file's contents |
| GET | `/search?q=&type=` | Grep search across repo; `type` = `text` or `regex` |
| GET | `/diff?since=` | File events since a Unix-ms timestamp |
| GET | `/structure` | Condensed repo overview (tree + sizes, no content) |
| GET | `/openapi.json` | Live-generated spec for this repo session |
| GET | `/health` | Liveness check + current tunnel URL (no auth) |

Every response uses the same envelope:

```json
{
  "ok": true,
  "data": { },
  "meta": {
    "repoPath": "/Users/you/project",
    "timestamp": 1718200000000,
    "tunnelUrl": "https://abc123.ngrok.io"
  }
}
```

---

## Set up with ChatGPT (Custom GPT Actions)

1. `npx reposync` in your repo root.
2. Copy the **tunnel URL** and **auth key** from stdout.
3. In ChatGPT: **Create a GPT → Configure → Create new Action**.
4. **Import from URL** → paste `https://<tunnel>/openapi.json`.
5. Under **Authentication**, choose **API Key → Bearer**, and paste the auth key.
6. Save. Ask it: *"What changed in the repo since I last asked?"* → it calls `/diff`.

Total setup time: ~3 minutes.

---

## Set up with Claude (Projects / tool use)

The same `/openapi.json` describes tool-use compatible operations
(`listFiles`, `readFile`, `searchRepo`, `diffSince`, `getStructure`). Point any
tool-use capable model at the tunnel base URL, register the operations from the
spec, and supply the bearer token as the `Authorization` header. No changes to the
spec are needed between ChatGPT and Claude.

---

## Programmatic API

```js
import { createRepoSync } from 'reposync'

const server = await createRepoSync({
  repoPath: '/path/to/repo',
  port: 3210,
  tunnel: 'ngrok',
  authKey: process.env.REPOSYNC_KEY,
  ignore: ['dist/**', '*.lock'],
  onFileChange: (path, type) => console.log(`[${type}] ${path}`)
})

console.log(server.tunnelUrl)   // https://xxx.ngrok.io (or null)
console.log(server.openApiSpec) // full spec object
console.log(server.authKey)     // bearer token

await server.stop()
```

---

## Security model

- Every request requires `Authorization: Bearer <auth-key>` (except `/health`).
- The auth key is auto-generated (`rs_live_` + 32 hex chars) if you don't supply one,
  and printed **once** to stdout — never logged elsewhere. Comparison is constant-time.
- `.reposyncignore` (same syntax as `.gitignore`) excludes sensitive files. These secure
  defaults are **always** applied, even with no ignore file:

  ```
  .env*    *.pem    *.key    *.p12    secrets/
  node_modules/    .git/    dist/    build/    *.lock
  ```

- Path traversal is blocked: `/file` and `/search` can only read inside the repo root,
  and only files that are tracked (i.e. not ignored).
- The tunnel URL is ephemeral — it changes on restart (unless you use a paid ngrok plan).
- No data leaves your machine except through the tunnel to your AI provider.

---

## Change tracking

The watcher keeps a ring buffer of the **last 100** file events:

```ts
type FileEvent = {
  path: string                          // relative to repo root
  type: 'add' | 'change' | 'unlink'
  timestamp: number                     // Unix ms
  sizeDelta?: number                    // bytes added/removed
}
```

`GET /diff?since=<unix_ms>` returns all events after that timestamp — call it at the
start of a conversation so the model knows what changed since last session.

---

## Development

```bash
npm install
npm run dev          # run the CLI from source (tsx)
npm run typecheck    # tsc --noEmit
npm run build        # bundle to dist/ (tsup)
npm test             # vitest
```

---

## License

MIT © Paramarsh Labs
