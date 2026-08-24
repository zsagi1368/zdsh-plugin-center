import { IncomingMessage, ServerResponse } from "node:http";
//#region src/shared/types.d.ts
/** Stable error codes for every failure surface of the plugin center. */
declare const CpErrorCode: {
  readonly invalidPlan: "invalid_plan";
  readonly untrustedSource: "untrusted_source";
  readonly hashMismatch: "hash_mismatch";
  readonly backupFailed: "backup_failed";
  readonly installFailed: "install_failed";
  readonly healthCheckFailed: "health_check_failed";
  readonly rollbackFailed: "rollback_failed";
  readonly planConsumed: "plan_consumed";
  readonly planNotFound: "plan_not_found";
  readonly confirmationMismatch: "confirmation_mismatch";
  readonly scriptBlocked: "script_blocked";
  readonly sourceUnreachable: "source_unreachable";
  readonly offlineDegraded: "offline_degraded";
  readonly unsafeUrl: "unsafe_url";
  readonly internal: "internal";
};
type CpErrorCode = (typeof CpErrorCode)[keyof typeof CpErrorCode];
/** Closed result envelope used across every public surface. */
type CpResult<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: {
    code: CpErrorCode;
    message: string;
  };
};
declare function cpOk<T>(data: T): CpResult<T>;
declare function cpErr<T = never>(code: CpErrorCode, message: string): CpResult<T>;
/**
 * Normalize a plugin id to the canonical `namespace/name` form.
 * Accepts `@scope/pkg`, `owner/repo` and bare names; rejects empties and any
 * character outside the safe identifier set (ids flow into command argv).
 */
declare function normalizePluginId(raw: string): CpResult<string>;
/** Lifecycle states of a plan as it moves through the engine. */
type PlanState = 'draft' | 'planned' | 'confirmed' | 'executing' | 'applied' | 'rolled-back' | 'restart-pending';
type AuditOutcome = 'ok' | 'error' | 'rolled-back';
interface AuditEvent {
  ts: string;
  action: string;
  planId?: string;
  step?: string;
  outcome: AuditOutcome;
  errorCode?: string;
  detail?: Record<string, string | number | boolean>;
}
//#endregion
//#region src/host/ports.d.ts
interface CommandSpec {
  cmd: string;
  args: string[];
}
interface CommandOutcome {
  code: number;
  stdout: string;
  stderr: string;
}
/** Ports the engine depends on; every one is fake-able in tests. */
interface EnginePorts {
  fs: FileSystemPort;
  commands: CommandPort;
  clock: ClockPort;
  http: HttpPort;
}
interface FileSystemPort {
  readFile(path: string): string | null;
  writeFileAtomic(path: string, contents: string): void;
  copyFile(from: string, to: string): void;
  mkdirDeep(path: string): void;
  hashFile(path: string): string | null;
  fileExists(path: string): boolean;
  /** Delete a path; symlink/junction links are unlinked, never followed. */
  removePath(path: string): void;
}
interface CommandPort {
  run(spec: CommandSpec): Promise<CommandOutcome>;
}
interface ClockPort {
  now(): Date;
}
interface HttpPort {
  fetchText(url: string, timeoutMs?: number): Promise<CpResult<string>>;
}
/**
 * Containment check that survives Windows cross-drive paths: a cross-drive
 * `path.relative` degenerates into an absolute path, so an absolute result can
 * never count as "inside".
 */
declare function isInsideRoot(root: string, target: string): boolean;
declare function nodePorts(): EnginePorts;
//#endregion
//#region src/shared/catalog.d.ts
type EvidenceLevel = 'discovered' | 'installable' | 'verified' | 'recommended';
type CompatLevel = 'exact' | 'range-supported' | 'unknown';
type ScriptsPolicy = 'none' | 'allowlisted';
type CatalogSource = 'github' | 'npm';
interface BilingualText {
  zh: string;
  en: string;
}
/**
 * A trusted-catalog entry. GitHub entries must pin an exact 40-hex commit;
 * npm entries carry a version plus integrity digest instead.
 */
interface CatalogEntry {
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
declare function isValidCommit(commit: string): boolean;
/** Structural validation; ids are normalized and every argv-bound field is
 * pinned to a strict charset (these values reach command construction). */
declare function validateCatalogEntry(raw: unknown): CpResult<CatalogEntry>;
/**
 * Candidate entries live in a physically separate discovery pool and are
 * type-forbidden from carrying anything installable.
 */
interface CandidateEntry {
  id: string;
  originUrl: string;
  noteZh: string;
  noteEn: string;
  discoveredAt: string;
}
/** Default ordering: recommendation first, then evidence, exact compat, recency. */
declare function sortEntries(entries: CatalogEntry[]): CatalogEntry[];
interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
/** Bounded pagination; out-of-range pages clamp to the last non-empty page. */
declare function paginate<T>(items: T[], page: number, pageSize: number): Page<T>;
interface SearchQuery {
  text?: string;
  category?: string;
  evidenceOnlyRecommended?: boolean;
}
declare function searchEntries(entries: CatalogEntry[], query: SearchQuery): CatalogEntry[];
//#endregion
//#region src/host/plans.d.ts
type PlanAction = 'install' | 'uninstall' | 'update';
interface InstallPlan {
  planId: string;
  action: PlanAction;
  profile: string;
  entry: CatalogEntry;
  confirmCode: string;
  createdAt: string;
}
declare class CpError extends Error {
  readonly code: CpErrorCode;
  constructor(code: CpErrorCode, message: string);
}
/**
 * Build an install plan from a catalog entry. GitHub entries must pin a full
 * commit; anything else is rejected as untrusted before a plan can exist.
 */
declare function createPlan(entry: CatalogEntry, action: PlanAction, profile: string): InstallPlan;
/**
 * Bilingual confirmation phrase wrapping the one-shot random code. The code
 * is returned exactly once in the staging response and never derivable from
 * public data.
 */
declare function confirmationPhrase(plan: InstallPlan): string;
/** One-shot plan store: confirmation consumes the plan exactly once. */
declare class PlanStore {
  private readonly ttlMs;
  private readonly pending;
  constructor(ttlMs?: number);
  add(plan: InstallPlan): void;
  get(planId: string): {
    plan: InstallPlan;
    state: PlanState;
  } | null;
  markState(planId: string, state: PlanState): void;
  /** Consume the plan: only the exact code, only once, only unexpired. */
  confirm(planId: string, phrase: string): InstallPlan;
  /** Drop expired plans; returns the number removed. */
  sweepExpired(nowMs?: number): number;
}
//#endregion
//#region src/host/lifecycle-engine.d.ts
/** The three profile files an install touches; the truth lives here. */
declare const PROFILE_FILES: readonly ["package.json", "pnpm-workspace.yaml", "cordis.patch.yml"];
interface LifecycleConfig {
  /** Root for backups / audit log / snapshot cache. */
  dataRoot: string;
  /** Entries like `pkg:postinstall` whose lifecycle scripts may run. Empty by default. */
  scriptAllowlist?: string[];
}
/** Optional post-install probe; throwing or rejecting fails the plan. */
type HealthProbe = () => Promise<void>;
interface EngineDeps {
  ports: EnginePorts;
  config: LifecycleConfig;
  healthProbe?: HealthProbe;
  auditSink?: (line: string) => void;
}
/** Pure command builders so tests can pin exact shapes without spawning. */
declare function buildInstallCmd(profile: string, owner: string, repo: string, commit: string): {
  cmd: string;
  args: string[];
};
declare function buildNpmAddCmd(profile: string, pkgName: string, version: string): {
  cmd: string;
  args: string[];
};
declare function buildRemoveCmd(profile: string, pkgName: string): {
  cmd: string;
  args: string[];
};
/** List lifecycle scripts a package manifest would run on install. */
declare function detectLifecycleScripts(manifest: Record<string, unknown>): string[];
declare class LifecycleEngine {
  private readonly deps;
  private readonly plans;
  private readonly states;
  private queue;
  constructor(deps: EngineDeps);
  private get fs();
  stateOf(planId: string): PlanState;
  /**
   * Build and register a plan. `targetManifest` (when the registry supplied
   * the package manifest) runs the lifecycle-script gate before staging.
   */
  buildPlan(entry: CatalogEntry, action: PlanAction, profile: string, targetManifest?: Record<string, unknown>): CpResult<{
    plan: InstallPlan;
    phrase: string;
  }>;
  /** One-shot confirmation bound to the deterministic phrase. */
  confirmPlan(planId: string, phrase: string): CpResult<InstallPlan>;
  /**
   * Apply a confirmed plan: pre-hash the profile, back it up, run the pinned
   * official CLI, compare post-state, probe health, audit everything — with
   * byte-exact rollback on any failure after the backup succeeded.
   *
   * Plans serialize through a per-engine queue so two concurrent applies can
   * never interleave snapshots and rollbacks against one profile.
   */
  applyPlan(planId: string): Promise<CpResult<{
    state: PlanState;
  }>>;
  private applyPlanLocked;
  /** Package name a remove command targets: explicit name, else repo, else id. */
  private targetPackageName;
  private commandFor;
  /** Restore each backed-up file to its original path and verify bytes. */
  private rollbackFromBackup;
  /**
   * Operator-facing restore: copy a backup directory (base-named profile
   * files) back into the profile, byte-verified per file.
   */
  restoreBackupInto(profileDir: string, backupDir: string, backupName: string): CpResult<{
    restored: string[];
  }>;
  private snapshotProfile;
  private now;
  private audit;
}
declare function toCpResult<T>(error: unknown): CpResult<T>;
//#endregion
//#region src/host/snapshot.d.ts
interface CatalogLoadInput {
  seedPath: string;
  cachePath: string;
  remoteUrl?: string;
}
interface LoadedCatalog {
  entries: CatalogEntry[];
  mode: 'fresh' | 'cached' | 'seed';
  fetchedAt?: string;
}
/**
 * Three-tier catalog loading with graceful degradation:
 * verified remote success → fresh (cache rewritten); anything else falls back
 * to the digest-checked local cache (`cached`), then the bundled seed.
 */
declare function loadCatalog(input: CatalogLoadInput, ports: {
  fs: FileSystemPortLike;
  http: HttpPort;
}): Promise<CpResult<LoadedCatalog>>;
interface FileSystemPortLike {
  readFile(path: string): string | null;
  writeFileAtomic(path: string, contents: string): void;
}
//#endregion
//#region src/host/services.d.ts
declare const PLUGIN_NAME = "zdsh-plugin-center";
interface PluginCenterConfig {
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
  launchCommand?: {
    cmd: string;
    args: string[];
  };
  mutationsEnabled: boolean;
}
declare function resolveDataRoot(config?: PluginCenterConfig): string;
/** Profile directory layout follows the host convention `$DSH_HOME/profiles/<name>`. */
declare function resolveProfileDir(config: PluginCenterConfig): string;
declare function normalizeConfig(raw?: Record<string, unknown>): PluginCenterConfig;
/** Locate the catalog seed shipped inside this package (src or built lib). */
declare function bundledSeedPath(): string;
/** Per-boot runtime identity so clients can detect host reloads. */
interface RuntimeIdentity {
  schemaVersion: 1;
  pluginName: string;
  bootId: string;
  startedAt: string;
  restartMode: 'self-guardian';
}
declare function createRuntimeIdentity(): RuntimeIdentity;
interface MarketPage extends Page<CatalogEntry> {
  mode: LoadedCatalog['mode'];
  fetchedAt?: string;
}
declare class PluginCenterServices {
  private readonly ports;
  private readonly catalogTtlMs;
  readonly config: PluginCenterConfig;
  readonly engine: LifecycleEngine;
  private readonly identity;
  private catalogCache;
  constructor(configRaw: Record<string, unknown>, ports?: EnginePorts, catalogTtlMs?: number, depsOverride?: Partial<EngineDeps>);
  /** Stage a plan for a catalog entry; returns the plan id and its phrase. */
  stagePlan(action: PlanAction, entryId: string): Promise<CpResult<{
    planId: string;
    phrase: string;
  }>>;
  /** Confirm with the exact phrase, then carry the plan through. */
  confirmAndRun(planId: string, phrase: string): Promise<CpResult<{
    state: PlanState;
  }>>;
  /** Last known watchdog state from disk; idle when never started. */
  guardianStatus(): {
    running: boolean;
    state: string;
    port: number;
    checkedAtMs?: number;
    restartsUsed?: number;
  };
  /** Start or stop the detached watchdog. */
  guardianToggle(action: 'start' | 'stop'): Promise<CpResult<{
    ok: boolean;
    pid?: number;
    reason?: string;
  }>>;
  /** Backup snapshots under the data root, newest first. */
  backupsList(): Array<{
    name: string;
    createdAtMs: number;
  }>;
  /** Resolve a backup name to its contained directory, or fail. */
  private resolveBackupDir;
  private readonly restores;
  /** Stage a restore: returns a one-shot id/code pair for the confirm step. */
  stageRestore(name: string): CpResult<{
    restoreId: string;
    code: string;
  }>;
  /** Consume a staged restore and run the byte-verified copy back. */
  applyRestore(restoreId: string, code: string): CpResult<{
    restored: string[];
  }>;
  get runtime(): RuntimeIdentity;
  get profileDir(): string;
  catalog(forceRefresh?: boolean): Promise<CpResult<LoadedCatalog>>;
  /** Bounded, sorted, filtered market page. */
  marketPage(params: {
    page?: number;
    pageSize?: number;
    q?: string;
    category?: string;
    onlyRecommended?: boolean;
    forceRefresh?: boolean;
  }): Promise<CpResult<MarketPage>>;
  entryById(entryId: string): Promise<CpResult<CatalogEntry>>;
}
//#endregion
//#region src/host/plugin.d.ts
interface RouteRegistrar {
  register(route: {
    kind: string;
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}
interface WebContextLike {
  webServer: RouteRegistrar;
  effect?(teardown: () => unknown, label?: string): void;
  logger?: {
    info?(message: string): void;
  };
}
interface HostContextLike {
  inject(dependencies: readonly string[], ready: (webCtx: WebContextLike) => void): void;
  logger?: {
    info?(message: string): void;
  };
}
declare const name = "zdsh-plugin-center";
declare const inject: readonly string[];
/** Adapt one raw node request into a router request and answer it. */
declare function serveRequest(services: PluginCenterServices, req: IncomingMessage, res: ServerResponse): Promise<void>;
/** Cordis apply: wire the plugin center onto a running host. */
declare function apply(ctx: HostContextLike, config?: Record<string, unknown>): void;
//#endregion
//#region src/shared/ssrc-guard.d.ts
/**
 * Decide whether a host (already lower-cased, brackets stripped) is safe for
 * outbound requests. Rejects loopback, private, link-local, CGNAT, multicast,
 * reserved and IPv4-mapped IPv6 forms.
 */
declare function isHostAllowed(hostname: string): boolean;
/** Validate an outbound URL; returns the parsed URL or a closed error. */
declare function assertSafeUrl(raw: string | URL): CpResult<URL>;
interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}
/**
 * fetch wrapper that re-validates every hop (redirects are followed manually)
 * so a redirect cannot smuggle us onto a private address, and credential
 * headers are stripped the moment we leave the original origin.
 */
declare function safeFetch(rawUrl: string | URL, options?: SafeFetchOptions): Promise<CpResult<{
  status: number;
  text: string;
}>>;
//#endregion
//#region src/shared/redact.d.ts
declare function isSensitiveValue(value: string): boolean;
declare function redactValue(key: string, value: string): string;
/** Shallow record redaction used by the audit trail before anything hits disk. */
declare function redactRecord(record: Record<string, unknown>): Record<string, unknown>;
//#endregion
//#region src/host/api.d.ts
declare const API_PREFIX: string;
declare const ROUTES: {
  readonly market: string;
  readonly entry: string;
  readonly stagePlan: string;
  readonly applyPlan: string;
  readonly audit: string;
  readonly runtime: string;
  readonly guardianStatus: string;
  readonly guardianToggle: string;
  readonly backups: string;
  readonly backupRestore: string;
  readonly backupRestoreApply: string;
  readonly restartRequest: string;
};
declare const INTENT_HEADER = "x-zdsh-pc-intent";
interface RouterRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}
interface RouterResponse {
  status: number;
  payload: unknown;
}
/** Handle one API request. Never throws — every outcome is a JSON response. */
declare function handleApiRequest(services: PluginCenterServices, request: RouterRequest): Promise<RouterResponse>;
//#endregion
//#region src/host/guardian.d.ts
interface GuardianConfig {
  dataRoot: string;
  /** TCP port of the DSH web host on 127.0.0.1. */
  port: number;
  /** Command that boots the DSH web host again after a crash. */
  launch: {
    cmd: string;
    args: string[];
  };
  intervalMs?: number;
}
interface GuardianStatus {
  state: 'probing' | 'restarting' | 'healthy' | 'give-up';
  bootId: string;
  startedAtMs: number;
  checkedAtMs: number;
  healthyTicks: number;
  restartsUsed: number;
}
declare function guardianDir(dataRoot: string): string;
declare function statusPath(dataRoot: string): string;
declare function pidPath(dataRoot: string): string;
interface PidResult {
  ok: boolean;
  pid?: number;
  reason?: string;
}
/** Spawn the detached watchdog; resolves with its pid. Idempotent per pidfile. */
declare function startGuardian(config: GuardianConfig): Promise<PidResult>;
/** Stop a running watchdog; safe when none is running. */
declare function stopGuardian(dataRoot: string): {
  stopped: boolean;
};
//#endregion
//#region src/host/restart-budget.d.ts
/**
 * Bounded-restart accounting shared by the guardian entry and the runtime
 * surface: at most `max` restarts inside any `windowMs`, then the circuit
 * stays open (give-up) until an operator intervenes.
 */
declare class RestartBudget {
  private readonly windowMs;
  private readonly max;
  private attempts;
  constructor(windowMs?: number, max?: number);
  /** Would another restart right now still be within budget? */
  canRestart(nowMs: number): boolean;
  record(nowMs: number): void;
  /** Number of restarts already spent in the current window. */
  used(nowMs: number): number;
  reset(): void;
  private prune;
}
type ProbeVerdict = {
  kind: 'healthy';
} | {
  kind: 'unhealthy';
};
type GuardianAction = 'none' | 'restart' | 'give-up';
/** Pure decision step used by the guardian loop on every probe tick. */
declare function decideAction(input: {
  verdict: ProbeVerdict;
  budget: RestartBudget;
  nowMs: number;
}): GuardianAction;
//#endregion
export { API_PREFIX, type AuditEvent, type AuditOutcome, type CandidateEntry, type CatalogEntry, type CatalogLoadInput, type CompatLevel, CpError, CpErrorCode, type CpResult, type EngineDeps, type EnginePorts, type EvidenceLevel, type GuardianAction, type GuardianConfig, type GuardianStatus, INTENT_HEADER, type InstallPlan, type LifecycleConfig, LifecycleEngine, type LoadedCatalog, PLUGIN_NAME, PROFILE_FILES, type PlanAction, type PlanState, PlanStore, type PluginCenterConfig, PluginCenterServices, type ProbeVerdict, ROUTES, RestartBudget, type RouterRequest, type RouterResponse, type RuntimeIdentity, apply, apply as cordisApply, apply as default, assertSafeUrl, buildInstallCmd, buildNpmAddCmd, buildRemoveCmd, bundledSeedPath, confirmationPhrase, name as cordisName, name, cpErr, cpOk, createPlan, createRuntimeIdentity, decideAction, detectLifecycleScripts, guardianDir, handleApiRequest, inject, isHostAllowed, isInsideRoot, isSensitiveValue, isValidCommit, loadCatalog, nodePorts, normalizeConfig, normalizePluginId, paginate, pidPath, redactRecord, redactValue, resolveDataRoot, resolveProfileDir, safeFetch, searchEntries, serveRequest, sortEntries, startGuardian, statusPath, stopGuardian, toCpResult, validateCatalogEntry };
//# sourceMappingURL=index.d.ts.map