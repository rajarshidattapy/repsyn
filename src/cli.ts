import { resolve } from 'node:path'
import { Command } from 'commander'
import { createRepoSync } from './server.js'
import { buildIgnore } from './ignore.js'
import { generateOpenApiSpec } from './openapi.js'
import { RepoWatcher } from './watcher.js'
import type { TunnelProvider } from './types.js'

const VERSION = '0.1.0'

type CliOptions = {
  port: string
  repo: string
  // commander folds `--no-tunnel` into this prop as `false`.
  tunnel: string | false
  authKey?: string
  ignore?: string
  openapi?: boolean
}

function parseIgnore(csv?: string): string[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Build the CLI program. Exported so tests can introspect it. */
export function buildProgram(): Command {
  const program = new Command()
  program
    .name('reposync')
    .description('Bridge any AI chat frontend to a live local repo.')
    .version(VERSION)
    .option('--port <number>', 'Port to bind', '3210')
    .option('--repo <path>', 'Repo path', process.cwd())
    .option('--tunnel <provider>', 'Tunnel provider: ngrok | cloudflare | none', 'ngrok')
    .option('--auth-key <token>', 'Static bearer token (default: auto-generated)')
    .option('--ignore <globs>', 'Comma-separated glob patterns to exclude')
    .option('--no-tunnel', 'Disable tunnel, LAN-only')
    .option('--openapi', 'Print OpenAPI spec and exit')
    .action((opts: CliOptions) => run(opts))
  return program
}

async function run(opts: CliOptions): Promise<void> {
  const repoPath = resolve(opts.repo)
  const extraIgnore = parseIgnore(opts.ignore)

  // --openapi: print spec for the repo and exit without starting a server.
  if (opts.openapi) {
    const ig = buildIgnore(repoPath, extraIgnore)
    const watcher = new RepoWatcher({ repoPath, ignore: ig })
    watcher.start()
    await watcher.ready
    const spec = generateOpenApiSpec({
      repoPath,
      ig,
      baseUrl: `http://localhost:${opts.port}`,
      fileCount: watcher.size
    })
    await watcher.stop()
    process.stdout.write(JSON.stringify(spec, null, 2) + '\n')
    return
  }

  // --no-tunnel sets opts.tunnel to undefined via commander's negation, so we
  // honor it explicitly. Otherwise validate the provided provider.
  let tunnel: TunnelProvider = 'ngrok'
  if (opts.tunnel === false || opts.tunnel === 'none') {
    tunnel = 'none'
  } else if (opts.tunnel === 'ngrok' || opts.tunnel === 'cloudflare') {
    tunnel = opts.tunnel
  } else {
    console.error(`[reposync] Unknown tunnel provider "${opts.tunnel}". Use ngrok | cloudflare | none.`)
    process.exitCode = 1
    return
  }

  const server = await createRepoSync({
    repoPath,
    port: Number(opts.port),
    tunnel,
    authKey: opts.authKey,
    ignore: extraIgnore
  })

  printBanner(server.repoPath, server.fileCount, server.localUrl, server.tunnelUrl, server.authKey)

  const shutdown = async () => {
    console.log('\n[reposync] Shutting down...')
    await server.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function printBanner(
  repoPath: string,
  fileCount: number,
  localUrl: string,
  tunnelUrl: string | null,
  authKey: string
): void {
  const files = fileCount.toLocaleString()
  const lines = [
    `RepoSync v${VERSION}`,
    `  Repo:     ${repoPath} (${files} files indexed)`,
    `  Local:    ${localUrl}`
  ]
  if (tunnelUrl) {
    lines.push(`  Tunnel:   ${tunnelUrl}   ← paste this + /openapi.json into your GPT Action`)
  } else {
    lines.push(`  Tunnel:   (none) — local/LAN only. Import ${localUrl}/openapi.json manually.`)
  }
  lines.push(`  Auth key: ${authKey}   ← add as Bearer token in your GPT Action auth`)
  lines.push('')
  lines.push('  Watching for changes...')
  console.log(lines.join('\n'))
}

buildProgram().parseAsync(process.argv).catch((err) => {
  console.error(`[reposync] ${(err as Error).message}`)
  process.exit(1)
})
