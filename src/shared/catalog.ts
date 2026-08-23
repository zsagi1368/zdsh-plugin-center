import { normalizePluginId, type CpResult } from './types.js';

export type EvidenceLevel = 'discovered' | 'installable' | 'verified' | 'recommended';
export type CompatLevel = 'exact' | 'range-supported' | 'unknown';
export type ScriptsPolicy = 'none' | 'allowlisted';
export type CatalogSource = 'github' | 'npm';

export interface BilingualText {
  zh: string;
  en: string;
}

/**
 * A trusted-catalog entry. GitHub entries must pin an exact 40-hex commit;
 * npm entries carry a version plus integrity digest instead.
 */
export interface CatalogEntry {
  id: string;
  source: CatalogSource;
  owner?: string;
  repo?: string;
  pinnedCommit?: string;
  packageName?: string;
  version?: string;
  integritySha256?: string;
  title: BilingualText;
  summary: BilingualText;
  category: string;
  evidence: EvidenceLevel;
  compat: CompatLevel;
  scriptsPolicy: ScriptsPolicy;
  homepage?: string;
  updatedAt: string;
}

const COMMIT_HEX = /^[0-9a-f]{40}$/;

export function isValidCommit(commit: string): boolean {
  return COMMIT_HEX.test(commit);
}

/** Structural validation; ids are normalized to `namespace/name`. */
export function validateCatalogEntry(raw: unknown): CpResult<CatalogEntry> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { code: 'invalid_plan', message: 'entry is not an object' } };
  }
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' ? normalizePluginId(e.id) : null;
  if (!id || !id.ok) {
    return { ok: false, error: { code: 'invalid_plan', message: 'entry id missing or malformed' } };
  }
  const source = e.source;
  if (source !== 'github' && source !== 'npm') {
    return { ok: false, error: { code: 'invalid_plan', message: `unknown source: ${String(source)}` } };
  }
  if (source === 'github') {
    const commit = e.pinnedCommit;
    if (typeof commit !== 'string' || !isValidCommit(commit)) {
      return {
        ok: false,
        error: { code: 'untrusted_source', message: 'github entry requires a pinned 40-hex commit' },
      };
    }
    if (typeof e.owner !== 'string' || typeof e.repo !== 'string' || !e.owner || !e.repo) {
      return { ok: false, error: { code: 'invalid_plan', message: 'github entry requires owner/repo' } };
    }
  }
  if (source === 'npm') {
    if (typeof e.packageName !== 'string' || !e.packageName) {
      return { ok: false, error: { code: 'invalid_plan', message: 'npm entry requires packageName' } };
    }
    if (typeof e.version !== 'string' || !e.version) {
      return { ok: false, error: { code: 'invalid_plan', message: 'npm entry requires version' } };
    }
  }
  for (const key of ['title', 'summary'] as const) {
    const text = e[key] as BilingualText | undefined;
    if (!text || typeof text.zh !== 'string' || typeof text.en !== 'string') {
      return { ok: false, error: { code: 'invalid_plan', message: `${key} must be bilingual` } };
    }
  }
  const evidence = e.evidence;
  if (evidence !== 'discovered' && evidence !== 'installable' && evidence !== 'verified' && evidence !== 'recommended') {
    return { ok: false, error: { code: 'invalid_plan', message: `bad evidence level` } };
  }
  const compat = e.compat;
  if (compat !== 'exact' && compat !== 'range-supported' && compat !== 'unknown') {
    return { ok: false, error: { code: 'invalid_plan', message: `bad compat level` } };
  }
  const scriptsPolicy = e.scriptsPolicy;
  if (scriptsPolicy !== 'none' && scriptsPolicy !== 'allowlisted') {
    return { ok: false, error: { code: 'invalid_plan', message: `bad scripts policy` } };
  }
  const updatedAt = e.updatedAt;
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    return { ok: false, error: { code: 'invalid_plan', message: 'updatedAt missing or invalid' } };
  }
  return {
    ok: true,
    data: {
      ...(e as unknown as CatalogEntry),
      id: id.data,
      category: typeof e.category === 'string' && e.category ? e.category : 'misc',
    },
  };
}

/**
 * Candidate entries live in a physically separate discovery pool and are
 * type-forbidden from carrying anything installable.
 */
export interface CandidateEntry {
  id: string;
  originUrl: string;
  noteZh: string;
  noteEn: string;
  discoveredAt: string;
}

// Compile-time guarantee: a candidate can never be smuggled in as installable.
type NoInstallFieldsOnCandidates = keyof CatalogEntry &
  ('pinnedCommit' | 'integritySha256' | 'evidence');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const neverInstallField: NoInstallFieldsOnCandidates[] = [];

const EVIDENCE_RANK: Record<EvidenceLevel, number> = {
  recommended: 3,
  verified: 2,
  installable: 1,
  discovered: 0,
};
const COMPAT_RANK: Record<CompatLevel, number> = {
  exact: 2,
  'range-supported': 1,
  unknown: 0,
};

/** Default ordering: recommendation first, then evidence, exact compat, recency. */
export function sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => {
    const ev = EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence];
    if (ev !== 0) return ev;
    const co = COMPAT_RANK[b.compat] - COMPAT_RANK[a.compat];
    if (co !== 0) return co;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Bounded pagination; out-of-range pages clamp to the last non-empty page. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
  };
}

export interface SearchQuery {
  text?: string;
  category?: string;
  evidenceOnlyRecommended?: boolean;
}

export function searchEntries(entries: CatalogEntry[], query: SearchQuery): CatalogEntry[] {
  let result = entries;
  if (query.category) {
    result = result.filter((e) => e.category === query.category);
  }
  if (query.evidenceOnlyRecommended) {
    result = result.filter((e) => e.evidence === 'recommended');
  }
  const text = query.text?.trim().toLowerCase();
  if (text) {
    result = result.filter((e) =>
      [e.id, e.title.zh, e.title.en, e.summary.zh, e.summary.en, e.packageName ?? '', e.repo ?? '']
        .join(' ')
        .toLowerCase()
        .includes(text),
    );
  }
  return result;
}
