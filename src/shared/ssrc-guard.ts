import { CpErrorCode, type CpResult } from './types.js'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
])

function ipv4ToInt(h: string): number | null {
  const parts = h.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(part)) {
      return null
    }
    value = value * 256 + n
  }
  return value
}

function inCidr4(ip: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)
  if (baseInt === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (baseInt & mask)
}

/**
 * Decide whether a host (already lower-cased, brackets stripped) is safe for
 * outbound requests. Rejects loopback, private, link-local, CGNAT, multicast,
 * reserved and IPv4-mapped IPv6 forms.
 */
export function isHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return false
  }
  if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/i.test(host)) {
    // IPv4-mapped IPv6: unwrap and judge the embedded IPv4 literal.
    return judgeIpv4Literal(host.slice(7))
  }
  if (host.includes(':')) {
    // Bare IPv6 literal: normalize then compare against blocked prefixes.
    const normalized = host
    if (normalized.toLowerCase().startsWith('::ffff:')) {
      return judgeIpv4Literal(normalized.slice(7))
    }
    // Expand :: shorthand for prefix checks.
    const halves = normalized.split('::')
    let groups: string[]
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(':') : []
      const right = halves[1] ? halves[1].split(':') : []
      const fill = 8 - left.length - right.length
      if (fill < 0) return false
      groups = [...left, ...Array<string>(fill).fill('0'), ...right]
    } else {
      groups = normalized.split(':')
    }
    if (groups.length !== 8) return false
    const hex = groups.map(g => parseInt(g, 16))
    if (hex.some(n => Number.isNaN(n))) return false
    const first = hex[0] as number
    if (hex.every(n => n === 0)) return false // ::
    // ::1 loopback
    if (
      hex.slice(0, 7).every(n => n === 0) &&
      (hex[7] as number) === 1
    ) {
      return false
    }
    // hex-form IPv4-mapped (::ffff:0:0/96)
    if (
      hex.slice(0, 5).every(n => n === 0) &&
      hex[5] === 0xffff
    ) {
      return judgeIpv4Literal(hexGroupsToIpv4(hex[6] as number, hex[7] as number))
    }
    // IPv4-compatible ::/96 (e.g. ::127.0.0.1 in hex form `::7f00:1`)
    if (hex.slice(0, 6).every(n => n === 0) && !hex.slice(6).every(n => n === 0)) {
      return judgeIpv4Literal(hexGroupsToIpv4(hex[6] as number, hex[7] as number))
    }
    // NAT64 embeds an IPv4 address in the low 32 bits — both the well-known
    // prefix 64:ff9b::/96 (RFC 6052) and the local-use 64:ff9b:1::/96
    // (RFC 8215) count.
    if (
      first === 0x0064 &&
      hex[1] === 0xff9b &&
      (hex[2] === 0 || hex[2] === 1) &&
      hex.slice(3, 6).every(n => n === 0)
    ) {
      return judgeIpv4Literal(hexGroupsToIpv4(hex[6] as number, hex[7] as number))
    }
    if ((first & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false // ff00::/8 multicast
    return true
  }
  const v4 = ipv4ToInt(host)
  if (v4 !== null) return judgeIpv4(v4)
  // Numeric forms the strict dotted parser rejected (`2130706433`, `127.1`,
  // `0x7f000001`, `0177.0.0.1`): OS resolvers still turn these into
  // addresses, so judge them under full inet_aton semantics — and refuse
  // outright when even that cannot parse them.
  const flexible = parseFlexibleIpv4(host)
  if (flexible !== null) return judgeIpv4(flexible)
  if (/^[0-9.]+$/.test(host)) return false
  if (host.length > 253) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false // mDNS / internal
  // Regular DNS name: every dot-separated label must be non-empty, ≤63 chars,
  // and start/end alphanumeric (rejects '.', '..', '-x-', trailing-dot junk).
  return (
    host.split('.').every(label => label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) &&
    /[a-z0-9]/.test(host)
  )
}

function hexGroupsToIpv4(high: number, low: number): string {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.')
}

function judgeIpv4Literal(literal: string): boolean {
  const v4 = ipv4ToInt(literal)
  return v4 !== null && judgeIpv4(v4)
}

function judgeIpv4(ip: number): boolean {
  if (inCidr4(ip, '0.0.0.0', 8)) return false // this-network + 0.0.0.0
  if (inCidr4(ip, '10.0.0.0', 8)) return false // private
  if (inCidr4(ip, '127.0.0.0', 8)) return false // loopback
  if (inCidr4(ip, '169.254.0.0', 16)) return false // link-local
  if (inCidr4(ip, '172.16.0.0', 12)) return false // private
  if (inCidr4(ip, '192.168.0.0', 16)) return false // private
  if (inCidr4(ip, '100.64.0.0', 10)) return false // CGNAT shared address space
  if (inCidr4(ip, '224.0.0.0', 4)) return false // multicast
  if (inCidr4(ip, '240.0.0.0', 4)) return false // reserved
  return true
}

/**
 * Full inet_aton-style parsing: OS resolvers accept `2130706433`, `127.1`,
 * `0x7f000001` and `0177.0.0.1` as loopback, so the guard must judge every
 * numeric form instead of letting it fall through to the DNS-name path.
 * Returns null when the string is not a numeric IPv4 form at all.
 */
export function parseFlexibleIpv4(host: string): number | null {
  if (!/^[0-9xXa-fA-F.]+$/.test(host) || !/\d/.test(host)) return null
  const parts = host.split('.')
  if (parts.length < 1 || parts.length > 4 || parts.some(p => p === '')) return null
  const values: number[] = []
  for (const part of parts) {
    let value: number
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      value = Number.parseInt(part, 16)
    } else if (/^0[0-7]+$/.test(part)) {
      value = Number.parseInt(part, 8)
    } else if (/^\d+$/.test(part)) {
      value = Number.parseInt(part, 10)
    } else {
      return null
    }
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null
    values.push(value)
  }
  // Classic inet_aton layout: every part except the last is one byte; the
  // last part fills the remaining width (`127.1` == `127.0.0.1`).
  const lastWidthBytes = 5 - values.length
  const last = values[values.length - 1] as number
  if (last >= 256 ** lastWidthBytes) return null
  let high = 0
  for (let index = 0; index < values.length - 1; index += 1) {
    const v = values[index] as number
    if (v > 0xff) return null
    high = high * 256 + v
  }
  return (high * 256 ** lastWidthBytes + last) >>> 0
}

/** Validate an outbound URL; returns the parsed URL or a closed error. */
export function assertSafeUrl(raw: string | URL): CpResult<URL> {
  let url: URL
  try {
    url = raw instanceof URL ? raw : new URL(raw)
  } catch {
    return { ok: false, error: { code: CpErrorCode.unsafeUrl, message: 'malformed url' } }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      error: { code: CpErrorCode.unsafeUrl, message: `protocol not allowed: ${url.protocol}` },
    }
  }
  if (url.username || url.password) {
    return {
      ok: false,
      error: { code: CpErrorCode.unsafeUrl, message: 'embedded credentials are not allowed' },
    }
  }
  if (!isHostAllowed(url.hostname)) {
    return {
      ok: false,
      error: { code: CpErrorCode.unsafeUrl, message: `host not allowed: ${url.hostname}` },
    }
  }
  return { ok: true, data: url }
}

export interface SafeFetchOptions {
  timeoutMs?: number | undefined
  maxRedirects?: number | undefined
  headers?: Record<string, string> | undefined
  /**
   * Response body byte cap (F2, ruling-approved default 2 MiB). Oversized
   * bodies abort the connection and return an explicit error — a truncated
   * document is never handed to the digest comparison downstream.
   */
  maxBytes?: number | undefined
}

/**
 * Default response body cap for the catalog/sidecar channel: sidecars are
 * hundred-byte scale, catalogs tens-of-KB scale, so 2 MiB leaves orders of
 * headroom while bounding the unbounded-`text()` surface (SECURITY-B4-D1a F2②,
 * patterns ②「有界响应体」/⑤「失败/超大响应路径单审」).
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const SENSITIVE_REDIRECT_HEADERS =
  /^(authorization|cookie|cookie2|proxy-authorization|x-zdsh-pc-intent)$/i

/**
 * DNS resolution gate (F2, SECURITY-B4-D1a): classify EVERY address the
 * hostname resolves to before connecting — a public-looking hostname that
 * resolves to loopback/private/link-local ranges is refused, closing the
 * literal-only-judgment bypass. Local implementation of the webstack
 * `safety/ssrf.ts` G2 pattern (lookup(all:true) → per-address classification
 * → DNS failure fail-closed), reusing this module's own isHostAllowed/judgeIpv4
 * family for the classification. DNS errors normalize to `source_unreachable`
 * (no new error code: CpErrorCode is contract-export surface).
 *
 * Documented residual (zdsh-security-patterns ②, webstack ssrf.ts header same
 * shape): global fetch re-resolves when it connects, so a short-TTL rebinding
 * answer differing between this gate and the connection remains a TOCTOU
 * residual — accepted risk per the family standard (per-hop re-validation is
 * the backstop; connection pinning via a lookup hook would require an undici
 * dependency = supply-chain surface change, out of card scope).
 */
async function assertHostResolvesAllowed(hostname: string): Promise<CpResult<null>> {
  // Lazy import keeps this module importable in non-node bundles (client face).
  const { lookup } = await import('node:dns/promises')
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch (error) {
    // Fail-closed: a DNS failure is never guessed around or let through.
    return {
      ok: false,
      error: {
        code: CpErrorCode.sourceUnreachable,
        message: `dns resolution failed for host: ${hostname} (${error instanceof Error ? error.message : 'unknown error'})`,
      },
    }
  }
  if (addresses.length === 0) {
    return {
      ok: false,
      error: {
        code: CpErrorCode.sourceUnreachable,
        message: `dns resolution returned no addresses for host: ${hostname}`,
      },
    }
  }
  for (const entry of addresses) {
    if (!isHostAllowed(entry.address)) {
      return {
        ok: false,
        error: {
          code: CpErrorCode.unsafeUrl,
          message: `host ${hostname} resolves to a disallowed address: ${entry.address} (family ${entry.family})`,
        },
      }
    }
  }
  return { ok: true, data: null }
}

function bodyTooLarge(maxBytes: number): CpResult<never> {
  return {
    ok: false,
    error: {
      code: CpErrorCode.sourceUnreachable,
      message: `response body exceeds ${maxBytes} bytes`,
    },
  }
}

/**
 * Bounded body reader (G4 pattern, webstack `safety/outbound.ts` readBounded
 * shape): accumulate at most maxBytes, abort the underlying connection the
 * moment the bound is crossed and return an explicit error — an oversized
 * response is a failure, never a truncated success.
 */
async function readBodyBounded(
  response: Response,
  maxBytes: number,
  stop: AbortController,
): Promise<CpResult<string>> {
  const reader = response.body?.getReader()
  if (reader === undefined) {
    // Non-streaming body fallback (polyfill shapes): buffer once, then bound.
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      stop.abort()
      return bodyTooLarge(maxBytes)
    }
    return { ok: true, data: new TextDecoder('utf-8', { fatal: false }).decode(buffer) }
  }
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      received += value.byteLength
      if (received > maxBytes) {
        stop.abort() // cut the connection early; do not consume the rest
        await reader.cancel().catch(() => undefined)
        return bodyTooLarge(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released by cancel()
    }
  }
  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, data: new TextDecoder('utf-8', { fatal: false }).decode(merged) }
}

/**
 * fetch wrapper that re-validates every hop (redirects are followed manually)
 * so a redirect cannot smuggle us onto a private address, and credential
 * headers are stripped the moment we leave the original origin.
 *
 * Channel hardening (TC-B4-PC1 F3): this fetch path serves the remote
 * catalog + sidecar channel, whose integrity credential (a bare sha256
 * sidecar) only authenticates over TLS — plaintext http: lets a MITM rewrite
 * catalog and sidecar together. Every hop therefore requires `https:`.
 * `assertSafeUrl` keeps accepting http: for display-only homepage validation
 * (catalog data surface untouched).
 *
 * Each hop additionally passes the DNS resolution gate (F2) and the response
 * body is read under a byte bound (default 2 MiB).
 */
export async function safeFetch(
  rawUrl: string | URL,
  options: SafeFetchOptions = {},
): Promise<CpResult<{ status: number; text: string }>> {
  const maxRedirects = options.maxRedirects ?? 3
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES
  let current = assertSafeUrl(rawUrl)
  let origin = current.ok ? current.data.origin : ''
  let headers: Record<string, string> = { ...(options.headers ?? {}) }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!current.ok) return current
    if (current.data.protocol !== 'https:') {
      // F3: the catalog/sidecar fetch channel is https-only on every hop
      // (an https origin may not downgrade through a redirect either).
      return {
        ok: false,
        error: {
          code: CpErrorCode.unsafeUrl,
          message: `protocol not allowed for fetched content: ${current.data.protocol} (https only)`,
        },
      }
    }
    if (current.data.origin !== origin) {
      // Cross-origin hop: credentials must not follow a redirect.
      const sanitized: Record<string, string> = {}
      for (const [key, value] of Object.entries(headers)) {
        if (!SENSITIVE_REDIRECT_HEADERS.test(key)) sanitized[key] = value
      }
      headers = sanitized
      origin = current.data.origin
    }
    // F2: resolve and classify every address before connecting (fail-closed).
    const dnsCheck = await assertHostResolvesAllowed(current.data.hostname)
    if (!dnsCheck.ok) return dnsCheck
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, options.timeoutMs ?? 15_000)
    try {
      const response = await fetch(current.data, {
        redirect: 'manual',
        headers,
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return {
            ok: false,
            error: { code: CpErrorCode.sourceUnreachable, message: 'redirect without location' },
          }
        }
        current = assertSafeUrl(new URL(location, current.data))
        continue
      }
      // F2: cheap declared-length rejection before reading any bytes.
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        controller.abort()
        return bodyTooLarge(maxBytes)
      }
      const body = await readBodyBounded(response, maxBytes, controller)
      if (!body.ok) return body
      return { ok: true, data: { status: response.status, text: body.data } }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: CpErrorCode.sourceUnreachable,
          message: error instanceof Error ? error.message : 'fetch failed',
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    ok: false,
    error: { code: CpErrorCode.sourceUnreachable, message: 'too many redirects' },
  }
}
