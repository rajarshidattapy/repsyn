import type { TunnelProvider } from './types.js'

export type TunnelHandle = {
  url: string | null
  close: () => Promise<void>
}

const NOOP: TunnelHandle = { url: null, close: async () => {} }

/**
 * Starts a tunnel to the local port using the requested provider.
 *
 * - `none`  : no tunnel, LAN/localhost only.
 * - `ngrok` : uses the optional `@ngrok/ngrok` dependency. Requires an authtoken
 *             via NGROK_AUTHTOKEN (or a configured ngrok account).
 * - `cloudflare` : reserved for v2; currently degrades to no tunnel with a warning.
 *
 * Never throws: tunnel failures degrade to a local-only server so the SDK
 * stays usable on LAN even when the tunnel can't come up.
 */
export async function startTunnel(
  provider: TunnelProvider,
  port: number,
  opts: { silent?: boolean } = {}
): Promise<TunnelHandle> {
  const warn = (msg: string) => {
    if (!opts.silent) console.warn(`[reposync] ${msg}`)
  }

  if (provider === 'none') return NOOP

  if (provider === 'cloudflare') {
    warn('Cloudflare tunnel is a v2 feature; starting without a tunnel (local only).')
    return NOOP
  }

  // ngrok
  try {
    const ngrok = await loadNgrok()
    if (!ngrok) {
      warn(
        'ngrok is not installed. Install with `npm i @ngrok/ngrok` or run with --no-tunnel. Starting local only.'
      )
      return NOOP
    }

    const authtoken = process.env.NGROK_AUTHTOKEN
    if (!authtoken) {
      warn(
        'NGROK_AUTHTOKEN is not set. Get a free token at https://dashboard.ngrok.com and export it. Starting local only.'
      )
      return NOOP
    }

    const listener = await ngrok.forward({ addr: port, authtoken })
    const url = listener.url()
    return {
      url,
      close: async () => {
        try {
          await listener.close()
        } catch {
          // best-effort teardown
        }
      }
    }
  } catch (err) {
    warn(`Failed to start ngrok tunnel (${(err as Error).message}). Starting local only.`)
    return NOOP
  }
}

/** Dynamically import the optional ngrok dependency; null if unavailable. */
async function loadNgrok(): Promise<null | {
  forward: (opts: { addr: number; authtoken: string }) => Promise<{
    url: () => string | null
    close: () => Promise<void>
  }>
}> {
  try {
    // Indirected so bundlers treat it as a true optional/external dep.
    const mod: any = await import(/* @vite-ignore */ '@ngrok/ngrok')
    return mod.default ?? mod
  } catch {
    return null
  }
}
