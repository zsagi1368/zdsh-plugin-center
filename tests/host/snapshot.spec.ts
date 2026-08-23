import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../src/host/snapshot.js';
import type { EnginePorts } from '../../src/host/ports.js';
import { nodePorts } from '../../src/host/ports.js';

const COMMIT = 'e'.repeat(40);

const goodEntry = {
  id: 'owner/repo',
  source: 'github',
  owner: 'owner',
  repo: 'repo',
  pinnedCommit: COMMIT,
  title: { zh: '条目', en: 'Entry' },
  summary: { zh: '摘要', en: 'Summary' },
  category: 'misc',
  evidence: 'installable',
  compat: 'unknown',
  scriptsPolicy: 'none',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function makeFs(): EnginePorts['fs'] {
  return nodePorts().fs;
}

function tempLayout(): { root: string; seedPath: string; cachePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pc-snap-'));
  const seedPath = join(root, 'seed.json');
  const cachePath = join(root, 'cache.json');
  return { root, seedPath, cachePath };
}

describe('catalog three-tier loading', () => {
  it('fresh remote wins and rewrites the cache', async () => {
    const layout = tempLayout();
    const fs = makeFs();
    const remote = JSON.stringify({ version: 1, fetchedAt: '2026-08-24T00:00:00Z', entries: [goodEntry] });
    const http = {
      fetchText: async () => ({ ok: true as const, data: remote }),
    };
    const result = await loadCatalog(
      {
        seedPath: layout.seedPath,
        cachePath: layout.cachePath,
        remoteUrl: 'https://registry.example.com/catalog.json',
      },
      { fs, http },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mode).toBe('fresh');
      expect(result.data.entries).toHaveLength(1);
    }
    // cache now populated
    const cached = JSON.parse(readFileSync(layout.cachePath, 'utf8')) as { entries: unknown[] };
    expect(cached.entries).toHaveLength(1);
  });

  it('degrades to cache when remote fails', async () => {
    const layout = tempLayout();
    const fs = makeFs();
    writeFileSync(layout.cachePath, JSON.stringify({ version: 1, fetchedAt: 'old', entries: [goodEntry] }), 'utf8');
    const http = { fetchText: async () => ({ ok: false as const, error: { code: 'source_unreachable' as const, message: 'down' } }) };
    const result = await loadCatalog(
      { seedPath: layout.seedPath, cachePath: layout.cachePath, remoteUrl: 'https://registry.example.com/catalog.json' },
      { fs, http },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mode).toBe('cached');
      expect(result.data.entries).toHaveLength(1);
    }
  });

  it('falls back to the bundled seed when offline with no cache', async () => {
    const layout = tempLayout();
    const fs = makeFs();
    writeFileSync(layout.seedPath, JSON.stringify({ version: 1, fetchedAt: '', entries: [goodEntry] }), 'utf8');
    const http = { fetchText: async () => ({ ok: false as const, error: { code: 'source_unreachable' as const, message: 'down' } }) };
    const result = await loadCatalog(
      { seedPath: layout.seedPath, cachePath: layout.cachePath, remoteUrl: 'https://registry.example.com/catalog.json' },
      { fs, http },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.mode).toBe('seed');
  });

  it('rejects remote catalogs containing invalid entries without touching the cache', async () => {
    const layout = tempLayout();
    const fs = makeFs();
    const bad = JSON.stringify({
      version: 1,
      fetchedAt: '',
      entries: [{ ...goodEntry, pinnedCommit: 'floating-main' }],
    });
    const http = { fetchText: async () => ({ ok: true as const, data: bad }) };
    const result = await loadCatalog(
      { seedPath: layout.seedPath, cachePath: layout.cachePath, remoteUrl: 'https://registry.example.com/catalog.json' },
      { fs, http },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('untrusted_source');
    expect(fs.readFile(layout.cachePath)).toBeNull();
  });
});
