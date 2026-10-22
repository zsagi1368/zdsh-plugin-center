/**
 * 出厂区 (factory-preinstall section) data layer — TC-B3-32C commit #3,
 * implementing DESIGN-intake-tech.md §8-ADJ-1 case B (standalone read-only
 * section, seedId as the join primary key, zero changes to the hub catalog
 * pool schema and zero changes to the mainline seed schema) and §8-ADJ-2
 * case C (the hub client talks to `remote.pluginGovernance` directly; the
 * main repo is not touched at all).
 *
 * The view is SYNTHESIZED from two existing Remote faces:
 * - `list()` → the governance roster; rows carrying `origin==='preinstall'`
 *   are the admitted factory artifacts (source stays 'native' by design);
 * - `preinstallReport()` → the durable preinstall ledger (§1.4), keyed by the
 *   same canonical seedId, carrying the executor verdict plus the `mount`
 *   sub-structure (§9.4) and the `userUninstalled` tombstone.
 *
 * Mandatory fail-safe (ADJ-2 附加强制条款): ANY fetch failure — an older host
 * without `preinstallReport`, a service-not-found transport rejection while
 * the governance gateway is inactive, or a thrown call — collapses the whole
 * section to `null` (hidden) with a silent `console.warn`. The market page
 * lives in its own slot and never reads this module, so no failure here can
 * ever red-screen it.
 */

/** One governance roster row, structurally (the hub carries no main-repo types). */
export interface RosterRowLike {
  pluginId?: unknown
  displayName?: unknown
  version?: unknown
  status?: unknown
  /**
   * Only `'preinstall'` participates in the factory view; any other value is
   * skipped. The host's wire field is `origin` — the roster summary declares
   * `readonly origin?: 'preinstall'` — and `provenance` is accepted as the
   * older spelling so a host that still sends it keeps working.
   */
  origin?: unknown
  provenance?: unknown
}

/**
 * Whether one roster row is a factory-preinstalled artifact.
 *
 * The host names the field `origin`; `provenance` is the older spelling this
 * module was written against. Reading only the old name dropped every row the
 * host actually sends, which is why the factory view showed nothing admitted.
 * @param row - one roster row.
 * @returns whether the row carries the factory marker.
 */
function isPreinstallRow(row: RosterRowLike): boolean {
  return row.origin === 'preinstall' || row.provenance === 'preinstall'
}

/** One ledger row of the preinstall report (§1.4 wire shape). */
export interface ReportRowLike {
  status?: unknown
  reason?: unknown
  at?: unknown
  userUninstalled?: unknown
  mount?: unknown
}

/** The preinstall report wire shape. */
export interface ReportLike {
  ranAt?: unknown
  entries?: unknown
}

/** The minimal governance-remote surface this module consumes. */
export interface GovernanceRemoteLike {
  list(): Promise<unknown>
  preinstallReport(): Promise<unknown>
}

/** Holder as delivered by the cordis client context (`remote.pluginGovernance`). */
export interface RemoteHolderLike {
  /**
   * Partial on purpose: an OLD host exposes no `preinstallReport` at all, and
   * the fail-safe runtime guards below are what turn that into a hidden
   * section — the type must not pretend the face is always complete.
   */
  pluginGovernance?: Partial<GovernanceRemoteLike>
}

export type PreinstallAdmission = 'installed' | 'skipped' | 'failed' | 'unknown'
export type PreinstallMountState = 'mounted' | 'failed' | 'skipped' | 'unknown'

/** The three-state badge of ADJ-1: installed / failed / uninstalled-no-resurrect. */
export type PreinstallBadge = 'preinstalled' | 'failed' | 'userUninstalled'

export interface PreinstallViewRow {
  /** Canonical seedId — the join primary key (list pluginId === report entry key). */
  seedId: string
  displayName: string
  /** Present in the governed roster with provenance 'preinstall'. */
  admitted: boolean
  /** Executor verdict from the ledger; 'unknown' when the row has no ledger entry. */
  status: PreinstallAdmission
  /** Correction-oriented failure reason when status === 'failed'. */
  reason: string | null
  /** Tombstone: the operator uninstalled it and later passes will not resurrect it. */
  userUninstalled: boolean
  /** Mount-channel dimension (§9.4); 'unknown' on rows a pass never mounted. */
  mount: PreinstallMountState
  mountReason: string | null
  /** The three-state badge this row renders. */
  badge: PreinstallBadge
}

export interface PreinstallView {
  /** Epoch of the most recent recorded pass; null when the ledger never ran. */
  ranAt: number | null
  rows: PreinstallViewRow[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Unwrap the typert transport envelope (`{ok:true,value} | {ok:false,error}`) to a value or a throw. */
function unwrapEnvelope(envelope: unknown): unknown {
  if (envelope === null || typeof envelope !== 'object' || !('ok' in envelope)) {
    // A face that answers with a bare payload is accepted structurally.
    return envelope
  }
  const boxed = envelope as { ok?: unknown; value?: unknown; error?: unknown }
  if (boxed.ok === true) return boxed.value
  const error = boxed.error as { code?: unknown; message?: unknown } | undefined
  throw new Error(
    `remote call failed: ${asString(error?.code) ?? 'unknown'} ${asString(error?.message) ?? ''}`.trim(),
  )
}

function normalizeAdmission(value: unknown): PreinstallAdmission {
  return value === 'installed' || value === 'skipped' || value === 'failed' ? value : 'unknown'
}

function normalizeMount(value: unknown): { state: PreinstallMountState; reason: string | null } {
  if (value === null || typeof value !== 'object') return { state: 'unknown', reason: null }
  const mount = value as { status?: unknown; reason?: unknown }
  const state = mount.status === 'mounted' || mount.status === 'failed' || mount.status === 'skipped'
    ? mount.status
    : 'unknown'
  return { state, reason: asString(mount.reason) }
}

function badgeOf(userUninstalled: boolean, status: PreinstallAdmission): PreinstallBadge {
  // The tombstone wins over everything (never-resurrect is the user's verdict).
  if (userUninstalled) return 'userUninstalled'
  // Only the executor's explicit 'failed' verdict renders red; 'skipped' means
  // the artifact was already there (isRegistered fast-path) or the pass chose
  // not to act — functionally present, so it renders in the installed state.
  if (status === 'failed') return 'failed'
  return 'preinstalled'
}

/**
 * Join the two Remote surfaces by seedId. Roster rows WITHOUT the factory
 * marker (operator npm installs, loader mirrors, project entries) never enter
 * the factory view; ledger rows without a roster counterpart (failed
 * installs, tombstones) do. Malformed entries are coerced to 'unknown'
 * verdicts rather than dropped, so a corrupt row still surfaces for the
 * operator to investigate.
 */
export function buildPreinstallView(
  rosterRows: readonly RosterRowLike[],
  report: ReportLike | null,
): PreinstallView {
  const merged = new Map<string, PreinstallViewRow>()
  for (const row of rosterRows) {
    if (!isPreinstallRow(row)) continue
    const seedId = asString(row.pluginId)
    if (seedId === null) continue
    merged.set(seedId, {
      seedId,
      displayName: asString(row.displayName) ?? seedId,
      admitted: true,
      status: 'unknown',
      reason: null,
      userUninstalled: false,
      mount: 'unknown',
      mountReason: null,
      badge: 'preinstalled',
    })
  }
  const entries = report?.entries
  if (entries !== null && typeof entries === 'object') {
    for (const [seedId, raw] of Object.entries(entries as Record<string, ReportRowLike>)) {
      const row = raw as ReportRowLike
      const mount = normalizeMount(row?.mount)
      const status = normalizeAdmission(row?.status)
      const userUninstalled = row?.userUninstalled === true
      const admitted = merged.get(seedId)?.admitted === true
      const displayName = merged.get(seedId)?.displayName ?? seedId
      const reason = asString(row?.reason)
      merged.set(seedId, {
        seedId,
        displayName,
        admitted,
        status,
        reason,
        userUninstalled,
        mount: mount.state,
        mountReason: mount.reason,
        badge: badgeOf(userUninstalled, status),
      })
    }
  }
  const rows = [...merged.values()].sort((a, b) => (a.seedId < b.seedId ? -1 : a.seedId > b.seedId ? 1 : 0))
  return { ranAt: asFiniteNumber(report?.ranAt), rows }
}

/**
 * Fetch both faces and build the view — under the MANDATORY fail-safe:
 * any missing face, rejected call, transport error or shape surprise
 * collapses to `null` (the section hides itself) plus a silent warn. It
 * never throws to the caller and never reports a partial view.
 */
export async function loadPreinstallView(
  remote: RemoteHolderLike | undefined,
  warn: (message: string) => void = (message) => {
    console.warn(`[zdsh-plugin-center] ${message}`)
  },
): Promise<PreinstallView | null> {
  try {
    const governance = remote?.pluginGovernance
    if (
      governance === undefined
      || typeof governance.list !== 'function'
      || typeof governance.preinstallReport !== 'function'
    ) {
      warn('factory-preinstall section hidden: this host exposes no pluginGovernance list/preinstallReport face')
      return null
    }
    const [roster, report] = await Promise.all([
      Promise.resolve(governance.list!()),
      Promise.resolve(governance.preinstallReport!()),
    ]).then(([rawRoster, rawReport]) => [unwrapEnvelope(rawRoster), unwrapEnvelope(rawReport)])
    const plugins = (roster as { plugins?: unknown } | null)?.plugins
    return buildPreinstallView(
      Array.isArray(plugins) ? (plugins as RosterRowLike[]) : [],
      (report ?? null) as ReportLike | null,
    )
  } catch (cause) {
    warn(`factory-preinstall section hidden: ${cause instanceof Error ? cause.message : String(cause)}`)
    return null
  }
}

/**
 * The governance ids of every plugin this host has registered.
 *
 * The market catalog and the governance registry live in two id spaces: a
 * catalog entry is `owner/repo` (a GitHub repository), while a registered
 * plugin is `core/name` (a package name folded into the `core/` space). The
 * fold is the same one the governance host applies to a package name, so the
 * market can answer "is this catalog entry already installed?" — which it
 * could not before, and so every factory plugin read as installable.
 */
export interface InstalledPlugins {
  /** Governance ids known to be registered. */
  readonly ids: ReadonlySet<string>
  /** The plugin names, as the manifest spells them. */
  readonly names: ReadonlySet<string>
}

/**
 * Fold a package or repository name into the governance id space.
 *
 * The `dsh-` and `zdsh-` prefixes are the two package-name generations the
 * governance host folds into `core/`; anything else keeps its own name.
 * @param name - a package or repository name.
 * @returns the governance id the name folds into.
 */
export function governanceIdOf(name: string): string {
  if (name.startsWith('dsh-')) {
    const rest = name.slice(4)
    return rest === '' ? name : `core/${rest}`
  }
  if (name.startsWith('zdsh-')) {
    const rest = name.slice(5)
    return rest === '' ? name : `core/${rest}`
  }
  return name
}

/**
 * Whether a catalog entry's plugin is already registered on this host.
 *
 * The two id spaces differ: a catalog entry is `owner/repo` (a GitHub
 * repository) and a registered plugin is `core/name` (a package name folded
 * into the `core/` space). A repository named `zdsh-autopilot` is the
 * package `zdsh-autopilot`, which folds to `core/autopilot` — the same fold
 * the governance host applies when it admits a local package. The package
 * name is also matched directly, which covers an entry whose repository name
 * and package name differ.
 * @param entry - the catalog entry.
 * @param installed - the registered ids and names.
 * @returns whether the plugin is registered.
 */
export function isEntryInstalled(
  entry: { id: string; repo?: string },
  installed: InstalledPlugins,
): boolean {
  const repo = entry.repo ?? entry.id.split('/')[1] ?? ''
  if (repo === '') return false
  if (installed.ids.has(entry.id)) return true
  if (installed.ids.has(governanceIdOf(repo))) return true
  if (installed.ids.has(governanceIdOf(repo.toLowerCase()))) return true
  return installed.names.has(repo)
}

/**
 * Read the registered plugin ids and names off the governance roster.
 *
 * @param remote - the client context holder carrying `remote.pluginGovernance`.
 * @param warn - the fail-safe reporter.
 * @returns the registered ids and names, or undefined when the roster is
 *   unreachable — a caller then renders what it knows, which is what a host
 *   without the governance face can honestly claim.
 */
export async function loadInstalledPlugins(
  remote: RemoteHolderLike | undefined,
  warn: (message: string) => void = (message) => {
    console.warn(`[zdsh-plugin-center] ${message}`)
  },
): Promise<InstalledPlugins | undefined> {
  try {
    const governance = remote?.pluginGovernance
    if (governance === undefined || typeof governance.list !== 'function') {
      warn('installed-state lookup unavailable: this host exposes no pluginGovernance list face')
      return undefined
    }
    const raw = await Promise.resolve(governance.list())
    const roster = unwrapEnvelope(raw) as { plugins?: unknown } | null
    const plugins = Array.isArray(roster?.plugins) ? (roster.plugins as RosterRowLike[]) : []
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const row of plugins) {
      const pluginId = asString(row.pluginId)
      if (pluginId !== null) ids.add(pluginId)
      const displayName = asString(row.displayName)
      if (displayName !== null) names.add(displayName)
    }
    return { ids, names }
  } catch (cause) {
    warn(`installed-state lookup unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
    return undefined
  }
}
