import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSafeUrl, isHostAllowed, safeFetch } from '../../src/shared/ssrc-guard.js';
import { CpErrorCode } from '../../src/shared/types.js';

const ALLOWED = 'https://registry.example.com/catalog.json';

describe('ssrc guard host vector table', () => {
  const blocked: Array<[string, string]> = [
    ['plain localhost', 'http://localhost/x'],
    ['localhost with port', 'http://localhost:3080/x'],
    ['uppercase localhost', 'http://LOCALHOST/x'],
    ['subdomain localhost', 'http://api.localhost/x'],
    ['loopback v4', 'http://127.0.0.1/x'],
    ['loopback v4 alt', 'http://127.8.8.8/x'],
    ['loopback v6', 'http://[::1]/x'],
    ['unspecified v4', 'http://0.0.0.0/x'],
    ['private 10/8', 'http://10.1.2.3/x'],
    ['private 172.16/12', 'http://172.16.0.1/x'],
    ['private 172.31 edge', 'http://172.31.255.255/x'],
    ['private 192.168', 'http://192.168.1.1/x'],
    ['link local v4', 'http://169.254.169.254/latest/meta-data'],
    ['cgnat 100.64/10', 'http://100.64.0.1/x'],
    ['cgnat upper edge', 'http://100.127.255.254/x'],
    ['multicast v4', 'http://224.0.0.1/x'],
    ['reserved 240/4', 'http://240.0.0.1/x'],
    ['mapped loopback', 'http://[::ffff:127.0.0.1]/x'],
    ['mapped private', 'http://[::ffff:192.168.0.9]/x'],
    ['bare ipv6 ::', 'http://[::]/x'],
    ['unique local fc00::/7', 'http://[fd00::1]/x'],
    ['link local fe80::/10', 'http://[fe80::1]/x'],
    ['multicast ff02::1', 'http://[ff02::1]/x'],
    ['non-http protocol', 'file:///etc/passwd'],
    ['ftp protocol', 'ftp://example.com/file'],
    ['embedded credentials', 'https://user:pass@example.com/x'],
    ['garbage url', 'not-a-url'],
    ['mdns .local', 'http://printer.local/x'],
    ['decimal loopback', 'http://2130706433/'],
    ['short-form loopback', 'http://127.1/'],
    ['hex loopback', 'http://0x7f000001/'],
    ['octal loopback', 'http://0177.0.0.1/'],
    ['mixed numeric private', 'http://10.1/x'],
    ['ipv4-compatible v6 hex', 'http://[::7f00:1]/x'],
    ['nat64 v6', 'http://[64:ff9b::7f00:1]/x'],
  ];

  for (const [label, url] of blocked) {
    it(`blocks ${label}`, () => {
      const result = assertSafeUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(CpErrorCode.unsafeUrl);
      }
    });
  }

  const allowed: string[] = [
    ALLOWED,
    'http://example.com/insecure-ok',
    'https://a.b.c.example.com/deep/path?q=1',
    'https://203.0.113.10/test-net-3',
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(assertSafeUrl(url).ok).toBe(true);
    });
  }
});

describe('isHostAllowed direct judgments', () => {
  it('accepts regular dns names', () => {
    expect(isHostAllowed('dsh-hub.example.org')).toBe(true);
  });
  it('rejects empty and dotted junk', () => {
    expect(isHostAllowed('')).toBe(false);
    expect(isHostAllowed('..')).toBe(false);
  });
  it('rejects cgnat lower edge exactly', () => {
    expect(isHostAllowed('100.63.255.255')).toBe(true); // outside CGNAT
    expect(isHostAllowed('100.65.0.0')).toBe(false); // inside CGNAT
  });
});

// ---------------------------------------------------------------------------
// safeFetch channel locks (TC-B4-PC1 F2 ruling-A + F3):
//   - DNS resolution gate: per-address classification, fail-closed on errors;
//   - bounded body reader (default 2 MiB, explicit maxBytes honored);
//   - https-only on every hop of the fetch channel (assertSafeUrl untouched).
// ---------------------------------------------------------------------------

const dns = vi.hoisted(() => ({
  results: new Map<string, Array<{ address: string; family: number }> | Error>(),
  calls: [] as string[],
}));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    dns.calls.push(hostname);
    const entry = dns.results.get(hostname);
    if (entry === undefined) throw new Error(`ENOTFOUND ${hostname} (no test fixture)`);
    if (entry instanceof Error) throw entry;
    return entry;
  },
}));

const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; init: RequestInit }>,
  responder: null as null | ((url: URL) => Response),
}));

function publicHost(name: string): void {
  dns.results.set(name, [{ address: '93.184.216.34', family: 4 }]);
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      net.calls.push({ url: String(input), init });
      if (net.responder === null) throw new Error('no responder configured');
      return net.responder(new URL(String(input)));
    }),
  );
}

beforeEach(() => {
  dns.results.clear();
  dns.calls.length = 0;
  net.calls.length = 0;
  net.responder = null;
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamBody(totalBytes: number, chunkBytes = 65_536): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(0x61));
      sent += size;
    },
  });
}

describe('safeFetch F3: https-only fetch channel (every hop)', () => {
  it('refuses http: before any DNS or fetch happens', async () => {
    const result = await safeFetch('http://example.com/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CpErrorCode.unsafeUrl);
      expect(result.error.message).toMatch(/https only/);
    }
    expect(dns.calls).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });

  it('refuses an https→http redirect downgrade on the next hop', async () => {
    publicHost('a.example');
    net.responder = () =>
      new Response(null, { status: 302, headers: { location: 'http://b.example/catalog.json' } });
    const result = await safeFetch('https://a.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(CpErrorCode.unsafeUrl);
  });

  it('keeps assertSafeUrl (display-only homepage validation) accepting http:', () => {
    // F3 scope lock: the catalog DATA surface (homepage validation through
    // assertSafeUrl) is untouched — only the fetch channel is https-only.
    expect(assertSafeUrl('http://example.com/insecure-ok').ok).toBe(true);
  });
});

describe('safeFetch F2: DNS resolution gate (webstack ssrf.ts G2 pattern)', () => {
  it('refuses a hostname resolving to loopback', async () => {
    dns.results.set('evil.example', [{ address: '127.0.0.1', family: 4 }]);
    const result = await safeFetch('https://evil.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CpErrorCode.unsafeUrl);
      expect(result.error.message).toMatch(/disallowed address: 127\.0\.0\.1/);
    }
    expect(net.calls).toHaveLength(0);
  });

  it('refuses private / link-local / ipv6-loopback resolutions', async () => {
    for (const [host, address, family] of [
      ['p.example', '10.1.2.3', 4],
      ['l.example', '169.254.169.254', 4],
      ['v6.example', '::1', 6],
      ['cgnat.example', '100.64.0.1', 4],
    ] as Array<[string, string, number]>) {
      dns.results.set(host, [{ address, family }]);
      const result = await safeFetch(`https://${host}/catalog.json`);
      expect(result.ok, host).toBe(false);
      if (!result.ok) expect(result.error.code, host).toBe(CpErrorCode.unsafeUrl);
    }
  });

  it('refuses when ANY address of a multi-record answer is private', async () => {
    dns.results.set('mixed.example', [
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    const result = await safeFetch('https://mixed.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/192\.168\.1\.1/);
  });

  it('fails closed on DNS errors (normalized to source_unreachable, no new codes)', async () => {
    dns.results.set('nx.example', new Error('ENOTFOUND nx.example'));
    const result = await safeFetch('https://nx.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CpErrorCode.sourceUnreachable);
      expect(result.error.message).toMatch(/dns resolution failed/);
    }
    expect(net.calls).toHaveLength(0);
  });

  it('fails closed on an empty answer set', async () => {
    dns.results.set('empty.example', []);
    const result = await safeFetch('https://empty.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CpErrorCode.sourceUnreachable);
      expect(result.error.message).toMatch(/no addresses/);
    }
  });

  it('re-runs the DNS gate on every redirect hop', async () => {
    publicHost('a.example');
    publicHost('b.example');
    let hop = 0;
    net.responder = () => {
      hop += 1;
      return hop === 1
        ? new Response(null, { status: 302, headers: { location: 'https://b.example/catalog.json' } })
        : new Response('{"version":1}', { status: 200 });
    };
    const result = await safeFetch('https://a.example/catalog.json');
    expect(result.ok).toBe(true);
    expect(dns.calls).toEqual(['a.example', 'b.example']);
  });

  it('passes a clean public resolution through to a successful fetch', async () => {
    publicHost('good.example');
    net.responder = () => new Response('catalog body', { status: 200 });
    const result = await safeFetch('https://good.example/catalog.json');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
      expect(result.data.text).toBe('catalog body');
    }
  });
});

describe('safeFetch F2: bounded body reader (G4 pattern)', () => {
  it('rejects an oversized body via declared content-length before reading', async () => {
    publicHost('big.example');
    net.responder = () => new Response('x'.repeat(5000), { status: 200 });
    const result = await safeFetch('https://big.example/catalog.json', { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CpErrorCode.sourceUnreachable);
      expect(result.error.message).toMatch(/exceeds 1024 bytes/);
    }
    expect((net.calls[0]!.init.signal as AbortSignal).aborted).toBe(true);
  });

  it('rejects an oversized streamed body (no content-length) and aborts', async () => {
    publicHost('stream.example');
    net.responder = () => new Response(streamBody(4096, 512), { status: 200 });
    const result = await safeFetch('https://stream.example/catalog.json', { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/exceeds 1024 bytes/);
    expect((net.calls[0]!.init.signal as AbortSignal).aborted).toBe(true);
  });

  it('accepts a body exactly at the bound', async () => {
    publicHost('edge.example');
    net.responder = () => new Response(streamBody(1024, 256), { status: 200 });
    const result = await safeFetch('https://edge.example/catalog.json', { maxBytes: 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toHaveLength(1024);
  });

  it('locks the 2 MiB default: a 2.5 MiB body is refused without explicit maxBytes', async () => {
    publicHost('default.example');
    net.responder = () => new Response(streamBody(2.5 * 1024 * 1024), { status: 200 });
    const result = await safeFetch('https://default.example/catalog.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/exceeds 2097152 bytes/);
  });
});
