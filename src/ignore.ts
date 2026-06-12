import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/**
 * Secure-by-default ignore patterns. These are always applied so that
 * secrets and bulky/noisy directories never leave the machine, even if the
 * user has no .reposyncignore file.
 */
export const DEFAULT_IGNORE = [
  '.env*',
  '*.pem',
  '*.key',
  '*.p12',
  'secrets/',
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  '*.lock'
]

/**
 * Builds an {@link Ignore} matcher from the default patterns, the repo's
 * .reposyncignore file (if present) and any extra patterns supplied via CLI
 * or the programmatic API.
 */
export function buildIgnore(repoPath: string, extra: string[] = []): Ignore {
  const ig = ignore()
  ig.add(DEFAULT_IGNORE)

  const ignoreFile = join(repoPath, '.reposyncignore')
  if (existsSync(ignoreFile)) {
    try {
      ig.add(readFileSync(ignoreFile, 'utf8'))
    } catch {
      // Unreadable ignore file: fall back to defaults rather than crash.
    }
  }

  if (extra.length) ig.add(extra)
  return ig
}

/**
 * Returns true if `relPath` (relative to repo root, forward-slashed) should
 * be excluded. The `ignore` library throws on absolute or empty paths, so we
 * guard those here.
 */
export function isIgnored(ig: Ignore, relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized === '.') return false
  return ig.ignores(normalized)
}
