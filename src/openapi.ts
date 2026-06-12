import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Ignore } from 'ignore'
import { isIgnored } from './ignore.js'

/** Derive a human repo name from package.json `name`, else the dirname. */
function repoName(repoPath: string): string {
  const pkg = join(repoPath, 'package.json')
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }
      if (parsed.name) return parsed.name
    } catch {
      // ignore malformed package.json
    }
  }
  return basename(repoPath) || 'repo'
}

/** Top-level visible entries, directories suffixed with `/`. */
function topLevelStructure(repoPath: string, ig: Ignore): string[] {
  try {
    return readdirSync(repoPath, { withFileTypes: true })
      .filter((d) => !isIgnored(ig, d.isDirectory() ? `${d.name}/` : d.name))
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
      .sort()
  } catch {
    return []
  }
}

const ENVELOPE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    data: {},
    error: { type: 'string' },
    meta: {
      type: 'object',
      properties: {
        repoPath: { type: 'string' },
        timestamp: { type: 'integer' },
        tunnelUrl: { type: 'string', nullable: true }
      }
    }
  },
  required: ['ok', 'meta']
} as const

/**
 * Generates a valid OpenAPI 3.0 document describing the live repo session.
 * The server URL points at the active tunnel (or localhost when none), so the
 * spec can be imported straight into ChatGPT's "Import from URL".
 */
export function generateOpenApiSpec(args: {
  repoPath: string
  ig: Ignore
  baseUrl: string
  fileCount: number
}): Record<string, unknown> {
  const name = repoName(args.repoPath)
  const structure = topLevelStructure(args.repoPath, args.ig)
  const structureLine = structure.length
    ? `Top-level structure: ${structure.join(', ')}.`
    : 'Top-level structure: (empty).'

  return {
    openapi: '3.0.3',
    info: {
      title: `RepoSync — ${name}`,
      version: '0.1.0',
      description:
        `Live REST access to the local repository "${name}" ` +
        `(${args.fileCount} files indexed). ${structureLine} ` +
        'All endpoints require an Authorization: Bearer token and return a ' +
        '{ ok, data, meta } envelope.'
    },
    servers: [{ url: args.baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      },
      schemas: { Envelope: ENVELOPE_SCHEMA }
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/files': {
        get: {
          operationId: 'listFiles',
          summary: 'Recursive file tree (respects .reposyncignore)',
          responses: { '200': okResponse() }
        }
      },
      '/file': {
        get: {
          operationId: 'readFile',
          summary: "Read a single file's contents",
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Repo-relative path of the file to read.'
            }
          ],
          responses: { '200': okResponse(), '404': { description: 'Not found' } }
        }
      },
      '/search': {
        get: {
          operationId: 'searchRepo',
          summary: 'Grep search across the repo',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Query string (literal text or regex).'
            },
            {
              name: 'type',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['text', 'regex'], default: 'text' }
            }
          ],
          responses: { '200': okResponse() }
        }
      },
      '/diff': {
        get: {
          operationId: 'diffSince',
          summary: 'Files changed since a Unix-ms timestamp',
          parameters: [
            {
              name: 'since',
              in: 'query',
              required: true,
              schema: { type: 'integer' },
              description: 'Unix epoch milliseconds.'
            }
          ],
          responses: { '200': okResponse() }
        }
      },
      '/structure': {
        get: {
          operationId: 'getStructure',
          summary: 'Condensed repo overview (tree + sizes, no content)',
          responses: { '200': okResponse() }
        }
      },
      '/health': {
        get: {
          operationId: 'health',
          summary: 'Liveness check + current tunnel URL',
          security: [],
          responses: { '200': okResponse() }
        }
      }
    }
  }
}

function okResponse() {
  return {
    description: 'OK',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Envelope' }
      }
    }
  }
}
