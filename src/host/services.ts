import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LifecycleEngine, type EngineDeps } from './lifecycle-engine.js';
import { nodePorts } from './ports.js';
import type { PlanAction } from './plans.js';
import { loadCatalog, type LoadedCatalog } from './snapshot.js';
import {
  paginate,
  searchEntries,
  sortEntries,
  type CatalogEntry,
  type Page,
} from '../shared/catalog.js';
import { cpOk, type CpResult, type PlanState } from '../shared/types.js';

export const PLUGIN_NAME = 'zdsh-plugin-center';

export interface PluginCenterConfig {
  defaultProfile: string;
  /** Explicit profile directory override; resolved from dshHome when absent. */
  profileDir?: string;
  /** DSH storage home; resolution order: config → env → zDSH dir → upstream dir. */
  dshHome?: string;
  /** Data root for backups/audit/cache; defaults to ~/.zdsh-plugin-center. */
  dataRoot?: string;
  remoteCatalogUrl?: string | null;
  /** Seed catalog override (tests / custom distributions). */
  catalogSeedPath?: string;
  mutationsEnabled: boolean;
}

export function resolveDataRoot(config?: PluginCenterConfig): string {
  if (!config?.dataRoot) return join(homedir(), '.zdsh-plugin-center');
  return isAbsolute(config.dataRoot) ? config.dataRoot : resolve(config.dataRoot);
}

/** Profile directory layout follows the host convention `$DSH_HOME/profiles/<name>`. */
export function resolveProfileDir(config: PluginCenterConfig): string {
  if (config.profileDir) return config.profileDir;
  const home =
    config.dshHome ?? process.env.DSH_BRANCH_HOME ?? process.env.DSH_HOME ?? defaultDshHome();
  return join(home, 'profiles', config.defaultProfile);
}

function defaultDshHome(): string {
  // The zDSH branch stores its home under .dsh-zdsh; upstream uses .dsh.
  const zdsh = join(homedir(), '.dsh-zdsh');
  if (existsSync(zdsh)) return zdsh;
  return join(homedir(), '.dsh');
}

export function normalizeConfig(raw: Record<string, unknown> = {}): PluginCenterConfig {
  const cfg = raw as Partial<PluginCenterConfig>;
  return {
    defaultProfile:
      typeof cfg.defaultProfile === 'string' && cfg.defaultProfile ? cfg.defaultProfile : 'web',
    profileDir: typeof cfg.profileDir === 'string' ? cfg.profileDir : undefined,
    dshHome: typeof cfg.dshHome === 'string' ? cfg.dshHome : undefined,
    dataRoot: typeof cfg.dataRoot === 'string' ? cfg.dataRoot : undefined,
    remoteCatalogUrl:
      cfg.remoteCatalogUrl === undefined
        ? null
        : typeof cfg.remoteCatalogUrl === 'string'
          ? cfg.remoteCatalogUrl
          : null,
    catalogSeedPath: typeof cfg.catalogSeedPath === 'string' ? cfg.catalogSeedPath : undefined,
    mutationsEnabled: cfg.mutationsEnabled !== false,
  };
}

/** Locate the catalog seed shipped inside this package (src or built lib). */
export function bundledSeedPath(): string {
  for (const candidate of ['../catalog/seed.json', '../../catalog/seed.json']) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  return join(process.cwd(), 'catalog', 'seed.json');
}

/** Per-boot runtime identity so clients can detect host reloads. */
export interface RuntimeIdentity {
  schemaVersion: 1;
  pluginName: string;
  bootId: string;
  startedAt: string;
  restartMode: 'self-guardian';
}

export function createRuntimeIdentity(): RuntimeIdentity {
  return Object.freeze({
    schemaVersion: 1 as const,
    pluginName: PLUGIN_NAME,
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    restartMode: 'self-guardian' as const,
  });
}

export interface MarketPage extends Page<CatalogEntry> {
  mode: LoadedCatalog['mode'];
  fetchedAt?: string;
}

export class PluginCenterServices {
  readonly config: PluginCenterConfig;
  readonly engine: LifecycleEngine;
  private readonly identity = createRuntimeIdentity();
  private catalogCache: { atMs: number; value: Promise<CpResult<LoadedCatalog>> } | null = null;

  constructor(
    configRaw: Record<string, unknown>,
    private readonly ports = nodePorts(),
    private readonly catalogTtlMs = 60_000,
    depsOverride?: Partial<EngineDeps>,
  ) {
    this.config = normalizeConfig(configRaw);
    this.engine = new LifecycleEngine({
      ports,
      config: { dataRoot: resolveDataRoot(this.config) },
      ...(depsOverride ?? {}),
    });
  }

  /** Stage a plan for a catalog entry; returns the plan id and its phrase. */
  async stagePlan(
    action: PlanAction,
    entryId: string,
  ): Promise<CpResult<{ planId: string; phrase: string }>> {
    const entry = await this.entryById(entryId);
    if (!entry.ok) return entry;
    const built = this.engine.buildPlan(entry.data, action, this.profileDir);
    if (!built.ok) return built;
    return cpOk({ planId: built.data.plan.planId, phrase: built.data.phrase });
  }

  /** Confirm with the exact phrase, then carry the plan through. */
  async confirmAndRun(planId: string, phrase: string): Promise<CpResult<{ state: PlanState }>> {
    const confirmed = this.engine.confirmPlan(planId, phrase);
    if (!confirmed.ok) return confirmed;
    return this.engine.applyPlan(planId);
  }

  get runtime(): RuntimeIdentity {
    return this.identity;
  }

  get profileDir(): string {
    return resolveProfileDir(this.config);
  }

  catalog(forceRefresh = false): Promise<CpResult<LoadedCatalog>> {
    const now = Date.now();
    if (!forceRefresh && this.catalogCache && now - this.catalogCache.atMs < this.catalogTtlMs) {
      return this.catalogCache.value;
    }
    const value = loadCatalog(
      {
        seedPath: this.config.catalogSeedPath ?? bundledSeedPath(),
        cachePath: join(resolveDataRoot(this.config), 'cache', 'catalog.json'),
        remoteUrl: this.config.remoteCatalogUrl ?? undefined,
      },
      this.ports,
    );
    this.catalogCache = { atMs: now, value };
    return value;
  }

  /** Bounded, sorted, filtered market page. */
  async marketPage(params: {
    page?: number;
    pageSize?: number;
    q?: string;
    category?: string;
    onlyRecommended?: boolean;
    forceRefresh?: boolean;
  }): Promise<CpResult<MarketPage>> {
    const loaded = await this.catalog(params.forceRefresh ?? false);
    if (!loaded.ok) return loaded;
    const filtered = searchEntries(loaded.data.entries, {
      text: params.q,
      category: params.category,
      evidenceOnlyRecommended: params.onlyRecommended,
    });
    const sorted = sortEntries(filtered);
    const page = paginate(sorted, params.page ?? 1, Math.min(Math.max(params.pageSize ?? 24, 1), 48));
    return cpOk({ ...page, mode: loaded.data.mode, fetchedAt: loaded.data.fetchedAt });
  }

  async entryById(entryId: string): Promise<CpResult<CatalogEntry>> {
    const loaded = await this.catalog();
    if (!loaded.ok) return loaded;
    const found = loaded.data.entries.find((entry) => entry.id === entryId);
    if (!found) {
      return { ok: false, error: { code: 'invalid_plan', message: `unknown entry ${entryId}` } };
    }
    return cpOk(found);
  }
}
