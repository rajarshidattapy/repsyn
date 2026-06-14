import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RequestHandler } from 'express'

/**
 * Generates a static bearer token of the form `rs_live_<32 hex chars>`.
 * 16 bytes => 32 hex chars of entropy, matching the PRD security model.
 */
export function generateAuthKey(): string {
  return `rs_live_${randomBytes(16).toString('hex')}`
}

/** Where a generated key is cached so it stays stable across restarts. */
const KEY_DIR = join(homedir(), '.reposync')
const KEY_FILE = join(KEY_DIR, 'authkey')

/**
 * Resolves the bearer auth key so the user never has to wire one up manually.
 * Precedence:
 *   1. explicit override (e.g. `--auth-key` flag)
 *   2. `REPOSYNC_KEY` environment variable
 *   3. a previously persisted key at `~/.reposync/authkey`
 *   4. a freshly generated key — which is then persisted for next time
 *
 * This means a plain `reposync` run reuses the same token on every restart
 * without depending on `.env` being loaded into the process environment.
 */
export function resolveAuthKey(override?: string): string {
  const explicit = override?.trim()
  if (explicit) return explicit

  const fromEnv = process.env.REPOSYNC_KEY?.trim()
  if (fromEnv) return fromEnv

  try {
    if (existsSync(KEY_FILE)) {
      const saved = readFileSync(KEY_FILE, 'utf8').trim()
      if (saved) return saved
    }
  } catch {
    // unreadable cache — fall through and regenerate
  }

  const key = generateAuthKey()
  try {
    mkdirSync(KEY_DIR, { recursive: true })
    writeFileSync(KEY_FILE, key + '\n', { mode: 0o600 })
  } catch {
    // non-fatal: the key simply won't persist beyond this run
  }
  return key
}

/** Constant-time string comparison that is safe against length leaks. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Express middleware enforcing `Authorization: Bearer <authKey>` on every
 * request. `/health` is intentionally left open so liveness checks (and the
 * tunnel provider's probes) work without credentials.
 */
export function bearerAuth(authKey: string): RequestHandler {
  return (req, res, next) => {
    const header = req.get('authorization') ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    const token = match?.[1]

    if (!token || !safeEqual(token, authKey)) {
      res.status(401).json({
        ok: false,
        data: null,
        error: 'Unauthorized: missing or invalid bearer token',
        meta: { repoPath: '', timestamp: Date.now(), tunnelUrl: null }
      })
      return
    }
    next()
  }
}
