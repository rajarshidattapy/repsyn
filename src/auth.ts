import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

/**
 * Generates a static bearer token of the form `rs_live_<32 hex chars>`.
 * 16 bytes => 32 hex chars of entropy, matching the PRD security model.
 */
export function generateAuthKey(): string {
  return `rs_live_${randomBytes(16).toString('hex')}`
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
    if (req.path === '/health') return next()

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
