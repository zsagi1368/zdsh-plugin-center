import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LifecycleEngine, type EngineDeps } from './lifecycle-engine.js';
import { nodePorts } from './ports.js';
import { startGuardian, stopGuardian, statusPath, type GuardianStatus } from './guardian.js';
import type { PlanAction } from './plans.js';
import { loadCatalog, type LoadedCatalog } from './snapshot.js';
import {
  paginate,
  searchEntries,
  sortEntries,
  type CatalogEntry,
  type Page,
} from '../shared/catalog.js';
import { cpErr, cpOk, type CpResult, type PlanState } from '../shared/types.js';

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
  /** Loopback port of the DSH web host the guardian watches. */
  webPort?: number;
  /** Command that boots the host again (guardian relaunch). */
  launchCommand?: { cmd: string; args: string[] };
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
    webPort: typeof cfg.webPort === 'number' && Number.isFinite(cfg.webPort) ? cfg.webPort : 3080,
    launchCommand:
      cfg.launchCommand && typeof cfg.launchCommand === 'object'
        ? {
            cmd: String((cfg.launchCommand as { cmd?: unknown }).cmd ?? 'dsh'),
            args: Array.isArray((cfg.launchCommand as { args?: unknown }).args)
              ? ((cfg.launchCommand as { args: unknown[] }).args as unknown[]).map(String)
              : ['web'],
          }
        : undefined,
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

  // ------------------------------------------------------- operations surface

  /** Last known watchdog state from disk; idle when never started. */
  guardianStatus(): {
    running: boolean;
    state: string;
    port: number;
    checkedAtMs?: number;
    restartsUsed?: number;
  } {
    const port = this.config.webPort ?? 3080;
    try {
      const parsed = JSON.parse(readFileSync(statusPath(resolveDataRoot(this.config)), 'utf8')) as GuardianStatus;
      return {
        running: parsed.state !== 'give-up',
        state: parsed.state,
        port,
        checkedAtMs: parsed.checkedAtMs,
        restartsUsed: parsed.restartsUsed,
      };
    } catch {
      return { running: false, state: 'idle', port };
    }
  }

  /** Start or stop the detached watchdog. */
  async guardianToggle(
    action: 'start' | 'stop',
  ): Promise<CpResult<{ ok: boolean; pid?: number; reason?: string }>> {
    if (action === 'stop') {
      const stopped = stopGuardian(resolveDataRoot(this.config));
      return cpOk({ ok: true, reason: stopped.stopped ? 'stopped' : 'not-running' });
    }
    const started = await startGuardian({
      dataRoot: resolveDataRoot(this.config),
      port: this.config.webPort ?? 3080,
      launch: this.config.launchCommand ?? { cmd: 'dsh', args: ['web'] },
    });
    return cpOk(started);
  }

  /** Backup snapshots under the data root, newest first. */
  backupsList(): Array<{ name: string; createdAtMs: number }> {
    const dir = join(resolveDataRoot(this.config), 'backups');
    let names: string[];
    try {
      names = readdirSync(dir).map((n) => n.toString());
    } catch {
      return [];
    }
    const rows: Array<{ name: string; createdAtMs: number }> = [];
    for (const name of names) {
      try {
        rows.push({ name, createdAtMs: Number.parseInt(name.split('-')[0] ?? '0', 10) || 0 });
      } catch {
        // skip malformed directory names
      }
    }
    return rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  /** Restore a named backup into the profile with per-file verification. */
  restoreBackup(name: string): CpResult<{ restored: string[] }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      return cpErr('backup_failed', 'malformed backup name');
    }
    const root = resolve(join(resolveDataRoot(this.config), 'backups'));
    const target = resolve(join(root, name));
    if (!isAbsolute(target) || !target.startsWith(root + sep) || target === root) {
      return cpErr('backup_failed', 'backup path escaped the data root');
    }
    return this.engine.restoreBackupInto(this.profileDir, target, name);
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
