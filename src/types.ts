/** A single file-system change event tracked by the watcher. */
export type FileEvent = {
  /** Path relative to the repo root, using forward slashes. */
  path: string
  type: 'add' | 'change' | 'unlink'
  /** Unix epoch in milliseconds. */
  timestamp: number
  /** Bytes added (positive) or removed (negative) by this event, when known. */
  sizeDelta?: number
}

/** An entry in the cached file index. */
export type FileEntry = {
  /** Path relative to the repo root, using forward slashes. */
  path: string
  /** Size in bytes. */
  size: number
  /** Last modified time, Unix epoch ms. */
  mtime: number
}

export type TunnelProvider = 'ngrok' | 'cloudflare' | 'none'

/** Options accepted by {@link createRepoSync}. */
export type RepoSyncOptions = {
  /** Absolute or relative path to the repo to serve. Defaults to cwd. */
  repoPath?: string
  /** Port to bind the local HTTP server. Default 3210. */
  port?: number
  /** Tunnel provider. Default 'ngrok'. */
  tunnel?: TunnelProvider
  /** Static bearer token. Auto-generated if omitted. */
  authKey?: string
  /** Extra ignore glob patterns, merged with .reposyncignore + defaults. */
  ignore?: string[]
  /** Callback fired on every watched file change. */
  onFileChange?: (path: string, type: FileEvent['type']) => void
  /** Suppress the startup banner (used for embedding / tests). */
  silent?: boolean
}

/** Handle returned by {@link createRepoSync}. */
export type RepoSyncServer = {
  /** Resolved absolute repo path. */
  repoPath: string
  port: number
  /** Local base URL, e.g. http://localhost:3210 */
  localUrl: string
  /** Public tunnel URL, or null when no tunnel is active. */
  tunnelUrl: string | null
  /** The bearer token required by every request. */
  authKey: string
  /** The generated OpenAPI 3.0 spec object. */
  openApiSpec: Record<string, unknown>
  /** Number of files currently indexed. */
  fileCount: number
  /** Stop the server, watcher and tunnel. Idempotent. */
  stop: () => Promise<void>
}

/** Consistent envelope returned by every endpoint. */
export type ApiResponse<T = unknown> = {
  ok: boolean
  data: T | null
  error?: string
  meta: {
    repoPath: string
    timestamp: number
    tunnelUrl: string | null
  }
}
