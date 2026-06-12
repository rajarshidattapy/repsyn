# RepoSync SDK — PRD

**Version:** 0.1  
**Status:** Draft  
**Author:** Paramarsh Labs

---

## Problem

ChatGPT and other AI chat interfaces have no live connection to local codebases. The current workarounds — pasting files manually, using repomix snapshots, or rebuilding the whole workflow in Cursor — either don't scale or lock you into a specific interface. There's no SDK that bridges an arbitrary AI chat frontend to a live local repo via a standard protocol.

---

## Solution

An npm SDK (`reposync`) that:

1. Spins up a local file-watcher server with a REST API
2. Exposes an auto-generated OpenAPI spec consumable by ChatGPT Custom GPT Actions, Claude Projects, or any tool-use capable model
3. Handles tunneling, auth, and change tracking out of the box
4. Optionally layers semantic search on top of raw file reads

One command to start. One URL to paste into your GPT Action. Live from that point on.

---

## Why npm (not pip)

- The core server (Express + chokidar) is a natural Node fit
- ChatGPT Action consumers are typically web-savvy developers already in the JS ecosystem
- `npx reposync` zero-install UX is cleaner than `pip install` + `reposync` for this audience
- Python SDK can be a thin wrapper in v2 for ML/data science users; core stays Node

---

## Target Users

- Developers who prefer ChatGPT/Claude web UI but want repo-aware answers
- Hackathon builders who don't want to switch to Cursor mid-sprint
- Teams that want to give a non-technical stakeholder a GPT that "knows the codebase"

---

## Non-Goals

- Not a VS Code extension (that's Claude Code's territory)
- Not a full RAG pipeline (v1 is grep + file reads; embeddings are v2)
- Not a hosted service — strictly local-first, user owns their data

---

## Core Architecture

```
Your Repo (local fs)
      │
   chokidar watcher
      │
   File Cache (in-memory Map)
      │
   Express REST API  ←──── OpenAPI spec auto-generated
      │
   ngrok / Cloudflare tunnel
      │
   ChatGPT Custom GPT Action / Claude Project Tool
      │
   AI model answers with live file context
```

---

## API Surface (v1)

All endpoints are served on `localhost:{port}` and exposed via tunnel.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/files` | Recursive file tree (respects `.reposyncignore`) |
| GET | `/file?path=` | Read a single file's contents |
| GET | `/search?q=&type=` | Grep search across repo; type = `text` or `regex` |
| GET | `/diff?since=` | Files changed since Unix timestamp |
| GET | `/structure` | Condensed repo overview (file tree + size, no content) |
| GET | `/openapi.json` | Live-generated spec for this repo session |
| GET | `/health` | Liveness check + current tunnel URL |

### Response shape (consistent across all endpoints)

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "repoPath": "/Users/you/project",
    "timestamp": 1718200000,
    "tunnelUrl": "https://abc123.ngrok.io"
  }
}
```

---

## CLI Interface

```bash
# Zero-install
npx reposync

# With options
npx reposync --port 3001 --repo ./my-project --tunnel cloudflare --auth-key mysecret

# Flags
--port         Port to bind (default: 3210)
--repo         Repo path (default: cwd)
--tunnel       Tunnel provider: ngrok | cloudflare | none (default: ngrok)
--auth-key     Static bearer token for request auth (default: auto-generated, printed on start)
--ignore       Comma-separated glob patterns to exclude (merged with .reposyncignore)
--no-tunnel    Disable tunnel, LAN-only
--openapi      Print OpenAPI spec and exit (for manual GPT setup)
```

### Startup output

```
RepoSync v0.1.0
  Repo:     /Users/you/my-project (1,203 files indexed)
  Local:    http://localhost:3210
  Tunnel:   https://a1b2c3.ngrok.io   ← paste this into GPT Action server URL
  Auth key: rs_live_x9k2mq...         ← add as Bearer token in GPT Action auth

  Watching for changes...
```

---

## Programmatic API (for embedding in other tools)

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

console.log(server.tunnelUrl)  // https://xxx.ngrok.io
console.log(server.openApiSpec) // full spec object

await server.stop()
```

---

## Security Model

- All requests require `Authorization: Bearer <auth-key>` header
- Auth key auto-generated (32-char random hex) on start if not provided
- Printed once to stdout; not logged elsewhere
- `.reposyncignore` (same syntax as `.gitignore`) excludes sensitive files — `.env`, `*.pem`, `secrets/` excluded by default
- Tunnel URL is ephemeral (changes on restart unless paid ngrok plan)
- No data leaves the machine except through the tunnel to the AI provider

### Default `.reposyncignore` entries

```
.env*
*.pem
*.key
*.p12
secrets/
node_modules/
.git/
dist/
build/
*.lock
```

---

## Change Tracking

The watcher maintains a ring buffer of the last 100 file events:

```ts
type FileEvent = {
  path: string          // relative to repo root
  type: 'add' | 'change' | 'unlink'
  timestamp: number     // Unix ms
  sizeDelta?: number    // bytes added/removed
}
```

`GET /diff?since=<unix_ms>` returns all events after that timestamp. The AI model can call this at conversation start to understand what changed since last session.

---

## OpenAPI Spec Generation

`/openapi.json` is generated at startup from the actual repo state:

- Includes repo name (from `package.json` or dirname) in the `info.title`
- Lists the top-level directory structure in the description so the model has structural context before making any calls
- Spec is valid OpenAPI 3.0 — paste the URL directly into ChatGPT's "Import from URL" in GPT Actions

---

## Setup Flow (end user)

1. `npx reposync` in repo root
2. Copy tunnel URL from stdout
3. In ChatGPT: Create GPT → Configure → Add Action → Import from URL → paste `https://<tunnel>/openapi.json`
4. Set auth type to Bearer, paste auth key
5. Save. Start chatting with live repo context.

Total setup time: ~3 minutes.

---

## v1 Scope (MVP)

- [ ] File watcher + in-memory cache (chokidar)
- [ ] REST API (5 core endpoints)
- [ ] Auto-generated OpenAPI spec
- [ ] ngrok tunnel integration
- [ ] Static bearer token auth
- [ ] `.reposyncignore` support with secure defaults
- [ ] CLI with startup output
- [ ] Programmatic API
- [ ] `/diff` change tracking
- [ ] README with ChatGPT + Claude setup guides

---

## v2 Scope (Post-MVP)

- Semantic search via local embeddings (no external API — `@xenova/transformers`, runs in-process)
- `GET /similar?to=path&k=5` endpoint — find files semantically related to a given file
- Cloudflare Tunnel support (no account needed, no URL rotation)
- Python SDK (`pip install reposync`) — thin wrapper calling the Node server
- MCP server mode — expose repo as an MCP tool for Claude Desktop / Claude Code
- Multi-repo support — serve multiple repos under namespaced paths
- VS Code extension — `reposync` status bar, start/stop without terminal

---

## Package Structure

```
reposync/
├── src/
│   ├── cli.ts           # CLI entrypoint
│   ├── server.ts        # Express app + routes
│   ├── watcher.ts       # chokidar wrapper + cache
│   ├── tunnel.ts        # ngrok / cloudflare abstraction
│   ├── openapi.ts       # spec generator
│   ├── auth.ts          # bearer token middleware
│   ├── ignore.ts        # .reposyncignore parser
│   └── index.ts         # programmatic API exports
├── bin/
│   └── reposync.js      # npx entrypoint
├── test/
├── package.json
└── README.md
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `chokidar` | File watching |
| `ngrok` | Tunnel (v1) |
| `glob` | File tree enumeration |
| `ignore` | `.gitignore`-syntax parsing |
| `commander` | CLI arg parsing |
| `zod` | Runtime schema validation on query params |

Zero runtime dependencies on any AI SDK — this is infrastructure, not a wrapper.

---

## Success Metrics (v1)

- Cold start to tunnel live in under 5 seconds on a 10k-file repo
- `/file` response under 50ms for files under 500KB
- `/search` response under 200ms for grep across 10k files
- Zero false-positive auth failures
- Works with ChatGPT Custom GPT Actions and Claude Projects tool definitions without modification