import { stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { Ignore } from 'ignore'
import { isIgnored } from './ignore.js'
import type { FileEntry, FileEvent } from './types.js'

const RING_SIZE = 100

/** Normalize an absolute path to a repo-relative, forward-slashed path. */
function toRel(repoPath: string, abs: string): string {
  return relative(repoPath, abs).split(sep).join('/')
}

/**
 * Wraps chokidar with an in-memory file index (path -> {size, mtime}) and a
 * bounded ring buffer of the most recent {@link FileEvent}s. All ignore
 * filtering flows through the shared {@link Ignore} matcher so the watcher,
 * the file tree and search all agree on what is visible.
 */
export class RepoWatcher {
  readonly repoPath: string
  private readonly ig: Ignore
  private readonly onChange?: (path: string, type: FileEvent['type']) => void
  private watcher: FSWatcher | null = null

  /** path -> entry */
  private readonly cache = new Map<string, FileEntry>()
  /** Most recent events, oldest first, capped at RING_SIZE. */
  private readonly events: FileEvent[] = []

  private readyResolve!: () => void
  /** Resolves once the initial scan has completed. */
  readonly ready: Promise<void>

  constructor(opts: {
    repoPath: string
    ignore: Ignore
    onFileChange?: (path: string, type: FileEvent['type']) => void
  }) {
    this.repoPath = resolve(opts.repoPath)
    this.ig = opts.ignore
    this.onChange = opts.onFileChange
    this.ready = new Promise((res) => {
      this.readyResolve = res
    })
  }

  /** Begin watching. Resolves the `ready` promise after the initial scan. */
  start(): Promise<void> {
    const watcher = chokidar.watch(this.repoPath, {
      ignoreInitial: false,
      persistent: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: (path: string) => {
        const rel = toRel(this.repoPath, path)
        if (rel === '' || rel === '.') return false
        return isIgnored(this.ig, rel)
      }
    })

    watcher
      .on('add', (p, s) => this.record(p, 'add', s?.size))
      .on('change', (p, s) => this.record(p, 'change', s?.size))
      .on('unlink', (p) => this.record(p, 'unlink'))
      .on('ready', () => this.readyResolve())

    this.watcher = watcher
    return this.ready
  }

  private record(abs: string, type: FileEvent['type'], size?: number): void {
    const rel = toRel(this.repoPath, abs)
    if (!rel) return

    const prev = this.cache.get(rel)
    let sizeDelta: number | undefined

    if (type === 'unlink') {
      sizeDelta = prev ? -prev.size : undefined
      this.cache.delete(rel)
    } else {
      const newSize = size ?? prev?.size ?? 0
      sizeDelta = newSize - (prev?.size ?? 0)
      this.cache.set(rel, { path: rel, size: newSize, mtime: Date.now() })
    }

    const event: FileEvent = { path: rel, type, timestamp: Date.now() }
    if (sizeDelta !== undefined) event.sizeDelta = sizeDelta

    this.events.push(event)
    if (this.events.length > RING_SIZE) this.events.shift()

    this.onChange?.(rel, type)
  }

  /** Snapshot of all indexed files, sorted by path. */
  list(): FileEntry[] {
    return [...this.cache.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Current number of indexed files. */
  get size(): number {
    return this.cache.size
  }

  /** True if `relPath` is currently indexed (visible & not ignored). */
  has(relPath: string): boolean {
    return this.cache.has(relPath.replace(/\\/g, '/'))
  }

  /** Events strictly after `since` (Unix ms), oldest first. */
  diffSince(since: number): FileEvent[] {
    return this.events.filter((e) => e.timestamp > since)
  }

  /** Resolve a repo-relative path to an absolute path on disk. */
  async resolveFile(relPath: string): Promise<{ size: number } | null> {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!this.cache.has(norm)) return null
    try {
      const s = await stat(resolve(this.repoPath, norm))
      return { size: s.size }
    } catch {
      return null
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
