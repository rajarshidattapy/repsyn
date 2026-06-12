import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoSync } from '../src/server.js'
import type { RepoSyncServer } from '../src/types.js'

let repo: string
let server: RepoSyncServer
let base: string
let headers: Record<string, string>

async function api(path: string) {
  const res = await fetch(`${base}${path}`, { headers })
  return { status: res.status, body: (await res.json()) as any }
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'reposync-test-'))
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'demo-repo' }))
  await writeFile(join(repo, 'index.js'), 'export const hello = "world"\n')
  await mkdir(join(repo, 'src'))
  await writeFile(join(repo, 'src', 'app.js'), 'function add(a, b) { return a + b }\n')
  // Secret + ignored content that must never be served.
  await writeFile(join(repo, '.env'), 'SECRET=topsecret\n')
  await mkdir(join(repo, 'node_modules'))
  await writeFile(join(repo, 'node_modules', 'junk.js'), 'noise\n')

  server = await createRepoSync({
    repoPath: repo,
    port: 0,
    tunnel: 'none',
    authKey: 'rs_live_testkey',
    silent: true
  })
  base = server.localUrl
  headers = { authorization: `Bearer ${server.authKey}` }
})

afterAll(async () => {
  await server?.stop()
  await rm(repo, { recursive: true, force: true })
})

describe('auth', () => {
  it('rejects requests without a token', async () => {
    const res = await fetch(`${base}/files`)
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const res = await fetch(`${base}/files`, { headers: { authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })

  it('allows /health without a token', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
  })
})

describe('/files', () => {
  it('lists tracked files and excludes ignored ones', async () => {
    const { body } = await api('/files')
    expect(body.ok).toBe(true)
    expect(body.data.files).toContain('index.js')
    expect(body.data.files).toContain('src/app.js')
    expect(body.data.files).not.toContain('.env')
    expect(body.data.files.some((f: string) => f.startsWith('node_modules'))).toBe(false)
  })
})

describe('/file', () => {
  it('reads a tracked file', async () => {
    const { body } = await api('/file?path=index.js')
    expect(body.ok).toBe(true)
    expect(body.data.content).toContain('hello')
  })

  it('404s on an ignored secret file', async () => {
    const { status } = await api('/file?path=.env')
    expect(status).toBe(404)
  })

  it('blocks path traversal', async () => {
    const { status } = await api('/file?path=../../etc/passwd')
    expect(status).toBe(404)
  })

  it('400s when path is missing', async () => {
    const { status } = await api('/file')
    expect(status).toBe(400)
  })
})

describe('/search', () => {
  it('finds text matches', async () => {
    const { body } = await api('/search?q=add&type=text')
    expect(body.ok).toBe(true)
    expect(body.data.results.some((r: any) => r.path === 'src/app.js')).toBe(true)
  })

  it('supports regex', async () => {
    const { body } = await api('/search?q=function%5Cs%2Badd&type=regex')
    expect(body.data.count).toBeGreaterThan(0)
  })

  it('400s on invalid regex', async () => {
    const { status } = await api('/search?q=%5B&type=regex')
    expect(status).toBe(400)
  })

  it('never leaks ignored file contents', async () => {
    const { body } = await api('/search?q=topsecret&type=text')
    expect(body.data.count).toBe(0)
  })
})

describe('/structure', () => {
  it('returns sizes without content', async () => {
    const { body } = await api('/structure')
    expect(body.data.count).toBeGreaterThan(0)
    expect(body.data.tree[0]).toHaveProperty('size')
    expect(body.data.tree[0]).not.toHaveProperty('content')
  })
})

describe('/diff', () => {
  it('reports a new file after a timestamp', async () => {
    const since = Date.now()
    await new Promise((r) => setTimeout(r, 50))
    await writeFile(join(repo, 'fresh.txt'), 'new content\n')
    // allow the watcher to pick it up
    await new Promise((r) => setTimeout(r, 400))
    const { body } = await api(`/diff?since=${since}`)
    expect(body.data.events.some((e: any) => e.path === 'fresh.txt')).toBe(true)
  })

  it('400s without since', async () => {
    const { status } = await api('/diff')
    expect(status).toBe(400)
  })
})

describe('/openapi.json', () => {
  it('is a valid OpenAPI 3.0 doc naming the repo', async () => {
    const { body } = await api('/openapi.json')
    expect(body.openapi).toMatch(/^3\./)
    expect(body.info.title).toContain('demo-repo')
    expect(body.paths).toHaveProperty('/files')
    expect(body.paths).toHaveProperty('/file')
    expect(body.paths).toHaveProperty('/search')
  })
})

describe('/health', () => {
  it('reports liveness and file count', async () => {
    const { body } = await api('/health')
    expect(body.data.status).toBe('ok')
    expect(body.data.fileCount).toBeGreaterThan(0)
  })
})
