/**
 * zdsh-plugin-center — web client surface.
 *
 * Loaded by the host module loader as a CJS block exposing {inject, apply}
 * (react arrives through the loader's require, exactly like any peer).
 * Registers a settings section (order 30, after inventory/governance) and
 * talks to the plugin's own /api2 routes on the same origin.
 */
import { useCallback, useEffect, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { pluginCenterStyles } from './styles.js'
import {
  isEntryInstalled,
  loadInstalledPlugins,
  loadPreinstallView,
  type PreinstallView,
  type PreinstallViewRow,
  type RemoteHolderLike,
} from './preinstall.js'

export const PLUGIN_CENTER_SLOT_ID = 'zdsh-plugin-center'
export const PLUGIN_CENTER_SLOT_ORDER = 30
/** Factory-preinstall section (DESIGN §8-ADJ-1 case B): standalone and read-only. */
export const PREINSTALL_SLOT_ID = 'zdsh-plugin-center-preinstall'
export const PREINSTALL_SLOT_ORDER = 31
export const INTENT_HEADER = 'x-zdsh-pc-intent'
const API = '/api2/zdsh-plugin-center'

/** ADJ-2 case C: the client reaches remote.pluginGovernance directly. */
export const inject = ['slots', 'remote', 'remote.pluginGovernance']

interface SlotsLike {
  inject(name: string, mount: () => (() => void)): void
  register(
    options: { name: string; id: string; order: number; label: string },
    component: () => ReactNode,
  ): () => void
}

export interface ClientContext {
  effect(mount: () => (() => void), description?: string): void
  slots: SlotsLike
  /** Present when the host provides the generated remotes client; the factory section hides without it. */
  remote?: RemoteHolderLike
}

// ------------------------------------------------------------------ data types

export interface EntryView {
  id: string
  /** The repository or package name, without its owner. */
  repo?: string
  source: 'github' | 'npm'
  title: { zh: string; en: string }
  summary: { zh: string; en: string }
  category: string
  evidence: 'discovered' | 'installable' | 'verified' | 'recommended'
  compat: 'exact' | 'range-supported' | 'unknown'
  scriptsPolicy: 'none' | 'allowlisted'
  /**
   * Whether this host already has the plugin registered.
   *
   * Absent when the roster could not be read — the market then renders what
   * the catalog says, which is what a host without the governance face can
   * honestly claim. Present and false means the plugin is genuinely absent.
   */
  installed?: boolean
}

export interface MarketPageView {
  items: EntryView[]
  page: number
  pageSize: number
  total: number
  mode: 'fresh' | 'cached' | 'seed'
}

interface RuntimeView {
  bootId: string
}

interface AuditRow {
  ts?: string
  action?: string
  step?: string
  outcome?: string
}

type Locale = 'zh' | 'en'

// ------------------------------------------------------------------ i18n

const messages = {
  zh: {
    brand: 'ZDSH 插件中心',
    sub: '发现 · 信任 · 安全安装 · 审计',
    search: '搜索名称、仓库或包名，回车确认…',
    allCategories: '分类过滤…',
    recommendedOnly: '只看推荐',
    install: '安装',
    evidenceRecommended: '推荐',
    evidenceVerified: '已验证',
    evidenceInstallable: '可安装',
    evidenceDiscovered: '仅发现',
    /** The catalog entry's plugin is already registered on this host. */
    evidenceInstalled: '已安装',
    /** The install action, for an entry that is already installed. */
    reinstall: '重新安装',
    compatExact: '兼容',
    compatRange: '范围支持·待验证',
    compatUnknown: '兼容性未知',
    sourceGithub: 'GitHub 固定 commit',
    sourceNpm: 'npm 固定版本',
    offlineHint: '当前为离线快照目录，数据可能不是最新。',
    confirmTitle: '确认安装',
    confirmHint: '请输入下方确认码后执行（一次性计划，防误触）：',
    cancelButton: '取消',
    confirmButton: '执行',
    appliedTitle: '已应用，等待重启生效',
    appliedBody: '依赖变更将在宿主重启后生效。',
    failedTitle: '操作失败',
    auditHeading: '审计记录（最近）',
    loading: '加载中…',
    empty: '没有匹配的插件。',
    prevPage: '上一页',
    nextPage: '下一页',
    opsHeading: '运维',
    guardianLabel: '看门狗',
    start: '启动',
    stop: '停止',
    backupsLabel: '备份快照',
    restoreBtn: '恢复',
    confirmRestore: (name: string): string =>
      `恢复备份 ${name}？请输入确认码继续：`,
    deleteBtn: '删除',
    restoredTitle: '已恢复',
    deletedTitle: '已删除快照',
    uninstall: '卸载',
    preinstallHeading: '出厂组件',
    preinstallBadgeInstalled: '出厂已装',
    preinstallBadgeFailed: '出厂失败',
    preinstallBadgeUninstalled: '已被卸载（不会重装）',
    preinstallMountMounted: '已装载',
    preinstallMountFailed: '装载失败',
    preinstallMountSkipped: '出厂未激活',
    preinstallMountUnknown: '装载状态未知',
    preinstallEnable: '启用',
    preinstallDisable: '停用',
    preinstallUninstall: '卸载',
    preinstallWorking: '处理中…',
    preinstallEmpty: '当前宿主没有出厂预装组件。',
    pageInfo: (a: number, b: number, c: number): string =>
      `第 ${String(a)} / ${String(b)} 页 · 共 ${String(c)} 条`,
    sourceOf: (entry: EntryView): string =>
      entry.source === 'github' ? messages.zh.sourceGithub : messages.zh.sourceNpm,
  },
  en: {
    brand: 'ZDSH Plugin Center',
    sub: 'Discover · Trust · Safe installs · Audit',
    search: 'Search names, repos or packages, press Enter…',
    allCategories: 'Filter by category…',
    recommendedOnly: 'Recommended only',
    install: 'Install',
    evidenceRecommended: 'Recommended',
    evidenceVerified: 'Verified',
    evidenceInstallable: 'Installable',
    evidenceDiscovered: 'Discovered',
    /** The catalog entry's plugin is already registered on this host. */
    evidenceInstalled: 'Installed',
    /** The install action, for an entry that is already installed. */
    reinstall: 'Reinstall',
    compatExact: 'Compatible',
    compatRange: 'Range supported · unverified',
    compatUnknown: 'Compatibility unknown',
    sourceGithub: 'GitHub pinned commit',
    sourceNpm: 'npm pinned version',
    offlineHint: 'Showing an offline snapshot catalog; data may be stale.',
    confirmTitle: 'Confirm install',
    confirmHint: 'Type the confirmation code to apply this one-shot plan:',
    cancelButton: 'Cancel',
    confirmButton: 'Apply',
    appliedTitle: 'Applied — restart required',
    appliedBody: 'Dependency changes take effect after the host restarts.',
    failedTitle: 'Operation failed',
    auditHeading: 'Recent audit trail',
    loading: 'Loading…',
    empty: 'No matching plugins.',
    prevPage: 'Prev',
    nextPage: 'Next',
    opsHeading: 'Operations',
    guardianLabel: 'Watchdog',
    start: 'Start',
    stop: 'Stop',
    backupsLabel: 'Backup snapshots',
    restoreBtn: 'Restore',
    confirmRestore: (name: string): string =>
      `Restore backup ${name}? Type the confirmation code to continue:`,
    deleteBtn: 'Delete',
    restoredTitle: 'Restored',
    deletedTitle: 'Snapshot deleted',
    uninstall: 'Uninstall',
    preinstallHeading: 'Factory components',
    preinstallBadgeInstalled: 'Preinstalled',
    preinstallBadgeFailed: 'Install failed',
    preinstallBadgeUninstalled: 'Uninstalled (will not return)',
    preinstallMountMounted: 'Mounted',
    preinstallMountFailed: 'Mount failed',
    preinstallMountSkipped: 'Off at factory',
    preinstallMountUnknown: 'Mount state unknown',
    preinstallEnable: 'Enable',
    preinstallDisable: 'Disable',
    preinstallUninstall: 'Uninstall',
    preinstallWorking: 'Working…',
    preinstallEmpty: 'This host has no factory-preinstalled components.',
    pageInfo: (a: number, b: number, c: number): string =>
      `Page ${String(a)} / ${String(b)} · ${String(c)} entries`,
    sourceOf: (entry: EntryView): string =>
      entry.source === 'github' ? messages.en.sourceGithub : messages.en.sourceNpm,
  },
} as const

/**
 * The badge a catalog entry carries.
 *
 * An entry whose plugin is already registered reads as installed whatever the
 * catalog's own evidence says: the catalog describes the REPOSITORY (it is a
 * static, signed, remote file with no notion of what this host has), while
 * the registry knows what is actually here. Offering "可安装" for a plugin
 * that is installed is what made the factory plugins look uninstallable.
 * @param entry - the catalog entry.
 * @param locale - the display locale.
 * @returns the badge text.
 */
export function entryBadge(entry: EntryView, locale: Locale): string {
  const t = messages[locale]
  if (entry.installed === true) return t.evidenceInstalled
  return evidenceLabel(entry.evidence, locale)
}

export function evidenceLabel(evidence: EntryView['evidence'], locale: Locale): string {
  const t = messages[locale]
  if (evidence === 'recommended') return t.evidenceRecommended
  if (evidence === 'verified') return t.evidenceVerified
  if (evidence === 'installable') return t.evidenceInstallable
  return t.evidenceDiscovered
}

export function compatLabel(compat: EntryView['compat'], locale: Locale): string {
  const key = compat === 'exact' ? 'compatExact' : compat === 'range-supported' ? 'compatRange' : 'compatUnknown'
  return (locale === 'zh' ? messages.zh : messages.en)[key]
}

// ------------------------------------------------------------------ api helpers

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`GET ${path} → ${String(response.status)}`)
  return (await response.json()) as T
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [INTENT_HEADER]: PLUGIN_CENTER_SLOT_ID },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `POST ${path} failed`)
  return payload
}

export function marketUrl(params: {
  page: number
  q: string
  category: string
  onlyRecommended: boolean
}): string {
  const search = new URLSearchParams()
  search.set('page', String(Math.max(1, params.page)))
  search.set('pageSize', '24')
  if (params.q.trim() !== '') search.set('q', params.q.trim())
  if (params.category !== '') search.set('category', params.category)
  if (params.onlyRecommended) search.set('onlyRecommended', '1')
  return `${API}/market?${search.toString()}`
}

// ------------------------------------------------------------------ state model

/**
 * One typed-code confirmation. The same dialog serves every two-phase
 * operation, so the code is what authorizes the action and `kind` decides what
 * runs on confirm — the three operations share a shape but not a payload.
 */
interface DialogState {
  kind: 'plan' | 'restore' | 'delete'
  /** Line under the title, already localized by whoever opened the dialog. */
  label: string
  confirmCode: string
  /** `plan` only: the staged plan and the phrase it must be confirmed with. */
  planId?: string
  phraseFull?: string
  /** `restore` / `delete` only: the snapshot the code belongs to. */
  backupName?: string
  /** `restore` / `delete` only: the one-shot ticket the host issued at staging. */
  ticketId?: string
}

interface GuardianView {
  running: boolean
  state: string
  port: number
}

interface BackupRow {
  name: string
  createdAtMs: number
}

export function extractSha8(phrase: string): string {
  const match = phrase.match(/@([0-9a-f]{12})\b/)
  return match?.[1] ?? ''
}

/** Headline component: catalog browsing plus the one-shot confirm flow. */
export function PluginCenterApp(props: { locale?: Locale; remote?: RemoteHolderLike }): ReactNode {
  const locale: Locale = props.locale ?? 'zh'
  const t = messages[locale]
  const [data, setData] = useState<MarketPageView | null>(null)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [category, setCategory] = useState('')
  const [onlyRec, setOnlyRec] = useState(false)
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [applied, setApplied] = useState(false)
  /** A submission is in flight; the confirm action must not send a second. */
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [auditTail, setAuditTail] = useState<AuditRow[]>([])
  const [guardian, setGuardian] = useState<GuardianView | null>(null)
  const [backups, setBackups] = useState<BackupRow[]>([])
  /** Outcome of the last snapshot operation; the operations used to end silently. */
  const [notice, setNotice] = useState<{ kind: 'restored' | 'deleted'; name: string } | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<MarketPageView>(marketUrl({ page, q: submitted, category, onlyRecommended: onlyRec }))
      .then((next) => {
        if (!alive) return
        // The catalog says what EXISTS; the registry says what is HERE. A
        // catalog entry whose plugin this host already has is installed, and
        // offering it as "可安装" is what made the factory plugins read as
        // uninstallable. The roster is read separately so a governance face
        // that cannot answer leaves the catalog's own verdict in place.
        void loadInstalledPlugins(props.remote).then((installed) => {
          if (!alive || installed === undefined) return
          setData({
            ...next,
            items: next.items.map(item => ({ ...item, installed: isEntryInstalled(item, installed) })),
          })
        })
        setData(next)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [page, submitted, category, onlyRec, props.remote])

  // Boot guard: when the host reloads under a new boot id, refresh once.
  useEffect(() => {
    let lastBoot = ''
    const timer = window.setInterval(() => {
      apiGet<RuntimeView>(`${API}/runtime`)
        .then((runtime) => {
          if (lastBoot === '') {
            lastBoot = runtime.bootId
            return
          }
          if (runtime.bootId !== lastBoot) {
            lastBoot = runtime.bootId
            apiGet<MarketPageView>(marketUrl({ page: 1, q: '', category: '', onlyRecommended: false }))
              .then(setData)
              .catch(() => undefined)
          }
        })
        .catch(() => undefined)
      apiGet<GuardianView>(`${API}/guardian/status`).then(setGuardian).catch(() => undefined)
    }, 5000)
    apiGet<GuardianView>(`${API}/guardian/status`).then(setGuardian).catch(() => undefined)
    apiGet<BackupRow[]>(`${API}/backups`).then(setBackups).catch(() => undefined)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const refreshOps = (): void => {
    apiGet<GuardianView>(`${API}/guardian/status`).then(setGuardian).catch(() => undefined)
    apiGet<BackupRow[]>(`${API}/backups`).then(setBackups).catch(() => undefined)
    apiGet<AuditRow[]>(`${API}/audit`).then(setAuditTail).catch(() => undefined)
  }

  const stagePlanFor = async (
    entryId: string,
    action: 'install' | 'update' | 'uninstall',
  ): Promise<void> => {
    setError('')
    try {
      const result = await apiPost<{ planId: string; phrase: string }>(`${API}/plan/stage`, {
        action,
        entryId,
      })
      setDialog({
        kind: 'plan',
        label: `${action} · ${entryId}`,
        planId: result.planId,
        phraseFull: result.phrase,
        confirmCode: extractSha8(result.phrase),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Run whatever the typed code authorized, then report what happened. */
  const confirmDialog = async (): Promise<void> => {
    if (!dialog) return
    // One submission per plan. The plan is one-shot: the second POST would
    // arrive while the first is still applying, find the plan already
    // confirmed, and refuse with "was already confirmed" — an error the
    // operator could do nothing about, on an operation that had already
    // been sent. The guard is the client's; the plan store's one-shot
    // contract stays one-shot.
    if (applying) return
    setApplying(true)
    const current = dialog
    setError('')
    try {
      if (current.kind === 'plan') {
        await apiPost(`${API}/plan/apply`, { planId: current.planId, phrase: current.phraseFull })
        setDialog(null)
        setApplied(true)
      } else if (current.kind === 'restore') {
        await apiPost(`${API}/backups/restore/apply`, {
          restoreId: current.ticketId,
          code: current.confirmCode,
        })
        setDialog(null)
        // The restore used to end here with only a list refresh, so a
        // successful restore and a silently-ignored one looked identical.
        setNotice({ kind: 'restored', name: current.backupName ?? '' })
      } else {
        await apiPost(`${API}/backups/delete/apply`, {
          deleteId: current.ticketId,
          code: current.confirmCode,
        })
        setDialog(null)
        setNotice({ kind: 'deleted', name: current.backupName ?? '' })
      }
      refreshOps()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDialog(null)
    } finally {
      setApplying(false)
    }
  }

  /**
   * Stage a restore and open the confirmation. The host issues a one-shot code
   * at staging; the dialog requires it to be typed rather than prefilled, which
   * is what makes it a confirmation instead of a click-through.
   */
  const restoreOne = async (name: string): Promise<void> => {
    setError('')
    setNotice(null)
    try {
      const staged = await apiPost<{ restoreId: string; code: string }>(
        `${API}/backups/restore`,
        { name },
      )
      setDialog({
        kind: 'restore',
        label: `${t.restoreBtn} · ${name}`,
        backupName: name,
        ticketId: staged.restoreId,
        confirmCode: staged.code,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Deleting a snapshot is destructive and irreversible, so it takes a code too. */
  const deleteOne = async (name: string): Promise<void> => {
    setError('')
    setNotice(null)
    try {
      const staged = await apiPost<{ deleteId: string; code: string }>(
        `${API}/backups/delete/stage`,
        { name },
      )
      setDialog({
        kind: 'delete',
        label: `${t.deleteBtn} · ${name}`,
        backupName: name,
        ticketId: staged.deleteId,
        confirmCode: staged.code,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleGuardian = async (action: 'start' | 'stop'): Promise<void> => {
    setError('')
    try {
      await apiPost(`${API}/guardian/toggle`, { action })
      refreshOps()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / (data?.pageSize ?? 24)))

  return (
    <div className="zdsh-pc">
      <style>{pluginCenterStyles}</style>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{t.brand}</div>
        <div className="zdsh-pc-note">{t.sub}</div>
      </div>
      {applied ? (
        <div className="zdsh-pc-banner" role="status">
          <strong>{t.appliedTitle}</strong> — {t.appliedBody}
        </div>
      ) : null}
      {notice !== null ? (
        <div className="zdsh-pc-banner" role="status">
          <strong>{notice.kind === 'restored' ? t.restoredTitle : t.deletedTitle}</strong>
          {` — ${notice.name}`}
        </div>
      ) : null}
      {error !== '' ? <div className="zdsh-pc-banner" role="alert">{`${t.failedTitle}: ${error}`}</div> : null}
      {data !== null && data.mode !== 'fresh' ? <div className="zdsh-pc-note">{t.offlineHint}</div> : null}
      <div className="zdsh-pc-toolbar">
        <input
          className="zdsh-pc-input"
          type="search"
          placeholder={t.search}
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value)
            if (e.target.value === '') setSubmitted('')
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              setPage(1)
              setSubmitted(query)
            }
          }}
        />
        <input
          className="zdsh-pc-input"
          type="search"
          style={{ maxWidth: '130px' }}
          placeholder={t.allCategories}
          value={category}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setPage(1)
            setCategory(e.target.value)
          }}
        />
        <label className="zdsh-pc-toggle">
          <input
            type="checkbox"
            checked={onlyRec}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPage(1)
              setOnlyRec(e.target.checked)
            }}
          />
          {t.recommendedOnly}
        </label>
      </div>
      <EntryList
        data={data}
        locale={locale}
        onInstall={(id) => {
          void stagePlanFor(id, 'install')
        }}
        onUninstall={(id) => {
          void stagePlanFor(id, 'uninstall')
        }}
      />
      <div className="zdsh-pc-pager">
        <button
          className="zdsh-pc-btn"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1)
          }}
        >
          {t.prevPage}
        </button>
        <span className="zdsh-pc-note">{t.pageInfo(page, pageCount, total)}</span>
        <button
          className="zdsh-pc-btn"
          disabled={page >= pageCount}
          onClick={() => {
            setPage(page + 1)
          }}
        >
          {t.nextPage}
        </button>
      </div>
      <div>
        <div className="zdsh-pc-note">{`${t.opsHeading} · ${t.guardianLabel}${guardian ? ` [${guardian.state}]` : ''}`}</div>
        <div className="zdsh-pc-toolbar">
          <button
            className="zdsh-pc-btn"
            onClick={() => {
              void toggleGuardian('start')
            }}
          >
            {t.start}
          </button>
          <button
            className="zdsh-pc-btn"
            onClick={() => {
              void toggleGuardian('stop')
            }}
          >
            {t.stop}
          </button>
        </div>
      </div>
      <div>
        <div className="zdsh-pc-note">{`${t.opsHeading} · ${t.backupsLabel}`}</div>
        {backups.length === 0 ? (
          <div className="zdsh-pc-note">—</div>
        ) : (
          backups.slice(0, 5).map(row => (
            <div className="zdsh-pc-audit-row" key={row.name}>
              <span>{new Date(row.createdAtMs).toISOString()}</span>
              <span>{row.name}</span>
              <button
                className="zdsh-pc-btn"
                onClick={() => {
                  void restoreOne(row.name)
                }}
              >
                {t.restoreBtn}
              </button>
              <button
                className="zdsh-pc-btn"
                onClick={() => {
                  void deleteOne(row.name)
                }}
              >
                {t.deleteBtn}
              </button>
            </div>
          ))
        )}
      </div>
      {auditTail.length > 0 ? (
        <div>
          <div className="zdsh-pc-note">{t.auditHeading}</div>
          {auditTail.slice(-8).map((row, index) => (
            <div className="zdsh-pc-audit-row" key={`${row.ts ?? ''}-${String(index)}`}>
              <span>{row.ts ?? ''}</span>
              <span>{`${row.action ?? ''}:${row.step ?? ''}`}</span>
              <span>{row.outcome ?? ''}</span>
            </div>
          ))}
        </div>
      ) : null}
      {dialog !== null ? (
        <ConfirmDialog
          dialog={dialog}
          locale={locale}
          applying={applying}
          onCancel={() => {
            // A cancelled plan is released, so it stops holding the target's
            // id. The plan id is derived from the target, so an abandoned
            // plan is what the NEXT attempt at the same plugin collides with
            // — and the operator was told the plan already existed with no
            // way through.
            if (dialog.kind === 'plan') {
              void apiPost(`${API}/plan/release`, { planId: dialog.planId }).catch(() => undefined)
            }
            setDialog(null)
          }}
          onConfirm={() => {
            void confirmDialog()
          }}
        />
      ) : null}
    </div>
  )
}

function EntryList(props: {
  data: MarketPageView | null
  locale: Locale
  onInstall: (entryId: string) => void
  onUninstall: (entryId: string) => void
}): ReactNode {
  const t = messages[props.locale]
  if (props.data === null) return <div className="zdsh-pc-note">{t.loading}</div>
  if (props.data.items.length === 0) return <div className="zdsh-pc-note">{t.empty}</div>
  return (
    <div className="zdsh-pc-list">
      {props.data.items.map(item => (
        <EntryCard
          key={item.id}
          entry={item}
          locale={props.locale}
          onInstall={() => {
            props.onInstall(item.id)
          }}
          onUninstall={() => {
            props.onUninstall(item.id)
          }}
        />
      ))}
    </div>
  )
}

function EntryCard(props: {
  entry: EntryView
  locale: Locale
  onInstall: () => void
  onUninstall: () => void
}): ReactNode {
  const t = messages[props.locale]
  const item = props.entry
  const installed = item.installed === true
  const evidenceClass =
    installed
      ? 'zdsh-pc-badge zdsh-pc-badge-good'
      : item.evidence === 'recommended' || item.evidence === 'verified'
        ? 'zdsh-pc-badge zdsh-pc-badge-good'
        : 'zdsh-pc-badge'
  const compatClass =
    item.compat === 'exact'
      ? 'zdsh-pc-badge zdsh-pc-badge-good'
      : item.compat === 'range-supported'
        ? 'zdsh-pc-badge zdsh-pc-badge-warn'
        : 'zdsh-pc-badge zdsh-pc-badge-dim'
  return (
    <div className="zdsh-pc-card">
      <div className="zdsh-pc-card-main">
        <div className="zdsh-pc-title">{item.title[props.locale]}</div>
        <div className="zdsh-pc-desc">{item.summary[props.locale]}</div>
        <div className="zdsh-pc-badges">
          <span className={evidenceClass}>{entryBadge(item, props.locale)}</span>
          <span className={compatClass}>{compatLabel(item.compat, props.locale)}</span>
          <span className="zdsh-pc-badge zdsh-pc-badge-dim">{t.sourceOf(item)}</span>
        </div>
      </div>
      <div className="zdsh-pc-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
        <button className="zdsh-pc-btn" disabled={item.evidence === 'discovered'} onClick={props.onInstall}>
          {installed ? t.reinstall : t.install}
        </button>
        <button className="zdsh-pc-btn" disabled={item.evidence === 'discovered'} onClick={props.onUninstall}>
          {t.uninstall}
        </button>
      </div>
    </div>
  )
}

function ConfirmDialog(props: {
  dialog: DialogState
  locale: Locale
  /** A submission is already in flight; the action must not fire again. */
  applying?: boolean
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const t = messages[props.locale]
  const [typed, setTyped] = useState('')
  const ready = typed === props.dialog.confirmCode && props.applying !== true
  return (
    <div className="zdsh-pc-dialog-backdrop" role="presentation">
      <div className="zdsh-pc-dialog" role="dialog" aria-modal="true">
        <strong>{t.confirmTitle}</strong>
        <div className="zdsh-pc-note">{props.dialog.label}</div>
        <div className="zdsh-pc-code">{props.dialog.confirmCode}</div>
        <label className="zdsh-pc-note">{t.confirmHint}</label>
        <input
          className="zdsh-pc-input"
          value={typed}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setTyped(e.target.value)
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && ready) props.onConfirm()
          }}
        />
        <div className="zdsh-pc-actions">
          <button className="zdsh-pc-btn" onClick={props.onCancel}>
            {t.cancelButton}
          </button>
          <button className="zdsh-pc-btn" disabled={!ready} onClick={props.onConfirm}>
            {t.confirmButton}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Badge copy for one factory-view row, per locale (exported for the spec). */
export function preinstallBadgeLabel(
  row: PreinstallViewRow,
  locale: Locale,
): string {
  const t = locale === 'zh' ? messages.zh : messages.en
  if (row.badge === 'userUninstalled') return t.preinstallBadgeUninstalled
  if (row.badge === 'failed') return t.preinstallBadgeFailed
  return t.preinstallBadgeInstalled
}

/** Mount-dimension label (§9.4): an admitted artifact can still have failed to load. */
export function preinstallMountLabel(
  row: PreinstallViewRow,
  locale: Locale,
): string {
  const t = locale === 'zh' ? messages.zh : messages.en
  if (row.mount === 'mounted') return t.preinstallMountMounted
  if (row.mount === 'failed') return t.preinstallMountFailed
  if (row.mount === 'skipped') return t.preinstallMountSkipped
  return t.preinstallMountUnknown
}

/**
 * The factory-preinstall section (ADJ-1 case B). Read-only, standalone;
 * under the ADJ-2 fail-safe it renders NOTHING while data is loading or on
 * any fetch failure — it can never red-screen, and the market section is a
 * separate slot that never reads this one.
 */
export function PreinstallSection(props: {
  locale?: Locale
  remote?: RemoteHolderLike
}): ReactNode {
  const locale: Locale = props.locale ?? 'zh'
  const t = messages[locale]
  const [view, setView] = useState<PreinstallView | null>(null)
  // The plugin id an action is running for, so only that row shows progress.
  const [working, setWorking] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const next = await loadPreinstallView(props.remote)
    setView(next)
  }, [props.remote])
  useEffect(() => {
    let alive = true
    loadPreinstallView(props.remote)
      .then((next) => {
        if (alive) setView(next)
      })
      .catch(() => {
        // loadPreinstallView never throws; belt against future edits.
        if (alive) setView(null)
      })
    return () => {
      alive = false
    }
  }, [props.remote])
  /**
   * Run one governance action on a factory component and reload the view.
   *
   * The section used to be a read-only list, so an operator could see which
   * components the factory installed but could not stop or remove one — the
   * request was for exactly that.
   */
  const act = useCallback(async (
    seedId: string,
    action: 'enable' | 'disable' | 'uninstall',
  ) => {
    const governance = props.remote?.pluginGovernance
    const call = governance?.[action]
    if (typeof call !== 'function') {
      setFailure('this host exposes no plugin governance action')
      return
    }
    setWorking(seedId)
    setFailure(null)
    try {
      const result = await call({ pluginId: seedId })
      // The governance face answers with a result envelope; a refusal carries
      // its own reason, which is the operator's next clue.
      const envelope = result as { ok?: boolean; error?: { message?: unknown } } | null
      if (envelope !== null && typeof envelope === 'object' && envelope.ok === false) {
        setFailure(typeof envelope.error?.message === 'string' ? envelope.error.message : 'the host refused the action')
      }
      await reload()
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(null)
    }
  }, [props.remote, reload])
  if (view === null) return null
  return (
    <div className="zdsh-pc">
      <style>{pluginCenterStyles}</style>
      <div className="zdsh-pc-note">{t.preinstallHeading}</div>
      {view.rows.length === 0 ? (
        <div className="zdsh-pc-note">{t.preinstallEmpty}</div>
      ) : (
        view.rows.map((row) => (
          <div className="zdsh-pc-audit-row" key={row.seedId}>
            <span>{row.displayName}</span>
            <span
              className={
                row.badge === 'preinstalled'
                  ? 'zdsh-pc-badge zdsh-pc-badge-good'
                  : row.badge === 'failed'
                    ? 'zdsh-pc-badge zdsh-pc-badge-warn'
                    : 'zdsh-pc-badge zdsh-pc-badge-dim'
              }
            >
              {preinstallBadgeLabel(row, locale)}
            </span>
            <span>{preinstallMountLabel(row, locale)}</span>
            <span>{row.badge === 'failed' ? (row.reason ?? '') : ''}</span>
            {/* An uninstalled component is gone: the factory will not bring
                it back, so there is nothing left to start or stop. */}
            {row.badge === 'userUninstalled' ? null : (
              <span className="zdsh-pc-toolbar">
                <button
                  className="zdsh-pc-btn"
                  disabled={working !== null}
                  onClick={() => { void act(row.seedId, row.enabled ? 'disable' : 'enable') }}
                >
                  {row.enabled ? t.preinstallDisable : t.preinstallEnable}
                </button>
                <button
                  className="zdsh-pc-btn"
                  disabled={working !== null}
                  onClick={() => { void act(row.seedId, 'uninstall') }}
                >
                  {t.preinstallUninstall}
                </button>
              </span>
            )}
          </div>
        ))
      )}
      {working !== null ? <div className="zdsh-pc-note">{t.preinstallWorking}</div> : null}
      {failure !== null ? <div className="zdsh-pc-note">{failure}</div> : null}
    </div>
  )
}

/** Register the plugin center as its own settings section (order 30). */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: PLUGIN_CENTER_SLOT_ID,
            order: PLUGIN_CENTER_SLOT_ORDER,
            label: messages.zh.brand,
          },
          () => <PluginCenterApp locale="zh" remote={ctx.remote} />,
        ),
      )
      // Standalone factory-preinstall section (ADJ-1 B): hidden by its own
      // fail-safe when the governance remote face is absent or unhappy.
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: PREINSTALL_SLOT_ID,
            order: PREINSTALL_SLOT_ORDER,
            label: messages.zh.preinstallHeading,
          },
          () => <PreinstallSection locale="zh" remote={ctx.remote} />,
        ),
      )
      return () => undefined
    },
    'zdsh-plugin-center: settings section',
  )
}
