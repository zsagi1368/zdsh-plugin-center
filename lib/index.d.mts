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
 * Accepts `@scope/pkg`, `owner/repo` and bare names; rejects empties.
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
 * so a redirect cannot smuggle us onto a private address.
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
/** Structural validation; ids are normalized to `namespace/name`. */
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
//#region src/host/plans.d.ts
type PlanAction = 'install' | 'uninstall' | 'update';
interface InstallPlan {
  planId: string;
  action: PlanAction;
  profile: string;
  entry: CatalogEntry;
  phraseSha8: string;
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
 * Deterministic bilingual confirmation phrase bound to the plan content.
 * Same plan always yields the same phrase; different plans never collide in
 * practice (8 hex chars of the canonical-content digest).
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
  /** Consume the plan: only the exact phrase, only once, only unexpired. */
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
   * Pre-hash the profile, back it up, run the pinned official CLI, compare
   * post-state, probe health, audit everything — byte-exact rollback on any
   * failure after the backup succeeded.
   */
  execute(planId: string): Promise<CpResult<{
    state: PlanState;
  }>>;
  private commandFor;
  /** Restore each backed-up file to its original path and verify bytes. */
  private rollbackFromBackup;
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
 * remote success → fresh (cache rewritten); remote failure → cached snapshot
 * (degraded); nothing cached → bundled seed.
 */
declare function loadCatalog(input: CatalogLoadInput, ports: Pick<EnginePortsLike, 'fs' | 'http'>): Promise<CpResult<LoadedCatalog>>;
interface EnginePortsLike {
  fs: FileSystemPort;
  http: HttpPort;
}
//#endregion
export { type AuditEvent, type AuditOutcome, type CandidateEntry, type CatalogEntry, type CatalogLoadInput, type CompatLevel, CpError, CpErrorCode, type CpResult, type EngineDeps, type EnginePorts, type EvidenceLevel, type InstallPlan, type LifecycleConfig, LifecycleEngine, type LoadedCatalog, PROFILE_FILES, type PlanAction, type PlanState, PlanStore, assertSafeUrl, buildInstallCmd, buildNpmAddCmd, buildRemoveCmd, confirmationPhrase, cpErr, cpOk, createPlan, detectLifecycleScripts, isHostAllowed, isInsideRoot, isSensitiveValue, isValidCommit, loadCatalog, nodePorts, normalizePluginId, paginate, redactRecord, redactValue, safeFetch, searchEntries, sortEntries, toCpResult, validateCatalogEntry };
//# sourceMappingURL=index.d.mts.map