import type { CatalogEntry } from '../shared/catalog.js';
import { validateCatalogEntry } from '../shared/catalog.js';
import { cpErr, cpOk, type CpResult } from '../shared/types.js';
import type { HttpPort, FileSystemPort } from './ports.js';

export interface CatalogLoadInput {
  seedPath: string;
  cachePath: string;
  remoteUrl?: string;
}

export interface LoadedCatalog {
  entries: CatalogEntry[];
  mode: 'fresh' | 'cached' | 'seed';
  fetchedAt?: string;
}

interface SnapshotFile {
  version: 1;
  fetchedAt: string;
  entries: unknown[];
}

function parseEntries(raw: unknown[]): CpResult<CatalogEntry[]> {
  const entries: CatalogEntry[] = [];
  for (const item of raw) {
    const validated = validateCatalogEntry(item);
    if (!validated.ok) return validated;
    entries.push(validated.data);
  }
  return cpOk(entries);
}

/**
 * Three-tier catalog loading with graceful degradation:
 * remote success → fresh (cache rewritten); remote failure → cached snapshot
 * (degraded); nothing cached → bundled seed.
 */
export async function loadCatalog(
  input: CatalogLoadInput,
  ports: Pick<EnginePortsLike, 'fs' | 'http'>,
): Promise<CpResult<LoadedCatalog>> {
  if (input.remoteUrl) {
    const fetched = await ports.http.fetchText(input.remoteUrl);
    if (fetched.ok) {
      try {
        const parsed = JSON.parse(fetched.data) as SnapshotFile;
        const entries = parseEntries(Array.isArray(parsed.entries) ? parsed.entries : []);
        if (!entries.ok) return entries;
        const snapshot: SnapshotFile = {
          version: 1,
          fetchedAt: new Date().toISOString(),
          entries: parsed.entries,
        };
        try {
          ports.fs.writeFileAtomic(input.cachePath, JSON.stringify(snapshot, null, 2));
        } catch {
          // cache write failure must not fail a successful fetch
        }
        return cpOk({ entries: entries.data, mode: 'fresh', fetchedAt: snapshot.fetchedAt });
      } catch {
        return cpErr('source_unreachable', 'remote catalog returned invalid JSON');
      }
    }
    // fall through to cache / seed
  }
  const cachedRaw = ports.fs.readFile(input.cachePath);
  if (cachedRaw !== null) {
    try {
      const parsed = JSON.parse(cachedRaw) as SnapshotFile;
      const entries = parseEntries(Array.isArray(parsed.entries) ? parsed.entries : []);
      if (!entries.ok) return entries;
      return cpOk({
        entries: entries.data,
        mode: 'cached',
        fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : undefined,
      });
    } catch {
      // corrupt cache falls through to seed
    }
  }
  const seedRaw = ports.fs.readFile(input.seedPath);
  if (seedRaw === null) {
    return cpErr('offline_degraded', 'no catalog source available (offline, no cache, no seed)');
  }
  try {
    const parsed = JSON.parse(seedRaw) as SnapshotFile | { entries: unknown[] };
    const entries = parseEntries(Array.isArray((parsed as SnapshotFile).entries) ? (parsed as SnapshotFile).entries : []);
    if (!entries.ok) return entries;
    return cpOk({ entries: entries.data, mode: 'seed' });
  } catch {
    return cpErr('internal', 'bundled seed catalog is corrupted');
  }
}

// Structural subset of EnginePorts so the loader stays decoupled from node impls.
interface EnginePortsLike {
  fs: FileSystemPort;
  http: HttpPort;
}
