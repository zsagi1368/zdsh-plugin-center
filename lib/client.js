window.__ModuleLoader__.load({
  id: "dsh-plugin-center",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/styles.ts
/** Scoped stylesheet for the plugin center settings section. */
const pluginCenterStyles = `
.zdsh-pc { display:flex; flex-direction:column; gap:14px; width:100%; max-width:760px;
  padding-bottom:24px; color:var(--dsw-alias-label-primary,#17191c);
  font-family:var(--dsw-font-family,inherit); }
.zdsh-pc * { box-sizing:border-box; }
.zdsh-pc-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.zdsh-pc-input { border:1px solid var(--dsw-alias-border-primary,#e4e6ea);
  border-radius:8px; padding:6px 10px; font-size:12px; background:transparent;
  color:inherit; min-width:0; }
.zdsh-pc-input[type="search"] { flex:1 1 180px; }
.zdsh-pc-toggle { display:flex; align-items:center; gap:5px; font-size:12px; }
.zdsh-pc-list { display:flex; flex-direction:column; gap:8px; }
.zdsh-pc-card { border:1px solid var(--dsw-alias-border-primary,#e4e6ea); border-radius:10px;
  padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.zdsh-pc-card-main { min-width:0; }
.zdsh-pc-card-title { font-size:13px; font-weight:600; }
.zdsh-pc-card-desc { font-size:12px; margin-top:3px; overflow-wrap:anywhere; }
.zdsh-pc-badges { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
.zdsh-pc-badge { font-size:10.5px; border-radius:999px; padding:1.5px 8px;
  background:var(--dsw-alias-fill-secondary,#f1f2f4); }
.zdsh-pc-badge-good { background:#e5f5ec; color:#116932; }
.zdsh-pc-badge-warn { background:#fdf3d8; color:#7a5a00; }
.zdsh-pc-badge-dim { color:var(--dsw-alias-label-tertiary,#7b8088); }
.zdsh-pc-btn { border:1px solid var(--dsw-alias-border-primary,#d9dbe0); border-radius:8px;
  padding:6px 12px; font-size:12px; cursor:pointer; background:transparent; color:inherit; }
.zdsh-pc-btn[disabled] { opacity:.45; cursor:not-allowed; }
.zdsh-pc-pager { display:flex; align-items:center; gap:10px; font-size:12px;
  justify-content:center; }
.zdsh-pc-note { font-size:11px; color:var(--dsw-alias-label-tertiary,#7b8088); }
.zdsh-pc-dialog-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35);
  display:flex; align-items:center; justify-content:center; z-index:60; }
.zdsh-pc-dialog { background:var(--dsw-alias-bg-primary,#fff); color:inherit;
  border-radius:12px; padding:18px; width:min(420px,92vw); display:flex;
  flex-direction:column; gap:10px; box-shadow:0 12px 32px rgba(0,0,0,.18); }
.zdsh-pc-code { font-family:ui-monospace,Menlo,monospace; font-size:15px;
  letter-spacing:.14em; text-align:center; padding:6px; border-radius:8px;
  background:var(--dsw-alias-fill-secondary,#f1f2f4); user-select:all; }
.zdsh-pc-actions { display:flex; justify-content:flex-end; gap:8px; }
.zdsh-pc-banner { border-radius:10px; padding:10px 12px; font-size:12px;
  background:#e5f5ec; color:#116932; }
.zdsh-pc-audit-row { display:flex; gap:8px; font-size:11px; padding:2px 0;
  font-family:ui-monospace,Menlo,monospace; }
`;
//#endregion
//#region src/client/preinstall.ts
/**
* Whether one roster row is a factory-preinstalled artifact.
*
* The host names the field `origin`; `provenance` is the older spelling this
* module was written against. Reading only the old name dropped every row the
* host actually sends, which is why the factory view showed nothing admitted.
* @param row - one roster row.
* @returns whether the row carries the factory marker.
*/
function isPreinstallRow(row) {
	return row.origin === "preinstall" || row.provenance === "preinstall";
}
function asString(value) {
	return typeof value === "string" ? value : null;
}
function asFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** Unwrap the typert transport envelope (`{ok:true,value} | {ok:false,error}`) to a value or a throw. */
function unwrapEnvelope(envelope) {
	if (envelope === null || typeof envelope !== "object" || !("ok" in envelope)) return envelope;
	const boxed = envelope;
	if (boxed.ok === true) return boxed.value;
	const error = boxed.error;
	throw new Error(`remote call failed: ${asString(error?.code) ?? "unknown"} ${asString(error?.message) ?? ""}`.trim());
}
function normalizeAdmission(value) {
	return value === "installed" || value === "skipped" || value === "failed" ? value : "unknown";
}
function normalizeMount(value) {
	if (value === null || typeof value !== "object") return {
		state: "unknown",
		reason: null
	};
	const mount = value;
	return {
		state: mount.status === "mounted" || mount.status === "failed" || mount.status === "skipped" ? mount.status : "unknown",
		reason: asString(mount.reason)
	};
}
function badgeOf(userUninstalled, status) {
	if (userUninstalled) return "userUninstalled";
	if (status === "failed") return "failed";
	return "preinstalled";
}
/**
* Join the two Remote surfaces by seedId. Roster rows WITHOUT the factory
* marker (operator npm installs, loader mirrors, project entries) never enter
* the factory view; ledger rows without a roster counterpart (failed
* installs, tombstones) do. Malformed entries are coerced to 'unknown'
* verdicts rather than dropped, so a corrupt row still surfaces for the
* operator to investigate.
*/
function buildPreinstallView(rosterRows, report) {
	const merged = /* @__PURE__ */ new Map();
	for (const row of rosterRows) {
		if (!isPreinstallRow(row)) continue;
		const seedId = asString(row.pluginId);
		if (seedId === null) continue;
		merged.set(seedId, {
			seedId,
			displayName: asString(row.displayName) ?? seedId,
			admitted: true,
			status: "unknown",
			reason: null,
			userUninstalled: false,
			mount: "unknown",
			mountReason: null,
			enabled: asString(row.status) !== "disabled",
			badge: "preinstalled"
		});
	}
	const entries = report?.entries;
	if (entries !== null && typeof entries === "object") for (const [seedId, raw] of Object.entries(entries)) {
		const row = raw;
		const mount = normalizeMount(row?.mount);
		const status = normalizeAdmission(row?.status);
		const userUninstalled = row?.userUninstalled === true;
		const admitted = merged.get(seedId)?.admitted === true;
		const displayName = merged.get(seedId)?.displayName ?? seedId;
		const reason = asString(row?.reason);
		const enabled = merged.get(seedId)?.enabled ?? true;
		merged.set(seedId, {
			seedId,
			displayName,
			admitted,
			status,
			reason,
			userUninstalled,
			mount: mount.state,
			mountReason: mount.reason,
			enabled,
			badge: badgeOf(userUninstalled, status)
		});
	}
	const rows = [...merged.values()].sort((a, b) => a.seedId < b.seedId ? -1 : a.seedId > b.seedId ? 1 : 0);
	return {
		ranAt: asFiniteNumber(report?.ranAt),
		rows
	};
}
/**
* Fetch both faces and build the view — under the MANDATORY fail-safe:
* any missing face, rejected call, transport error or shape surprise
* collapses to `null` (the section hides itself) plus a silent warn. It
* never throws to the caller and never reports a partial view.
*/
async function loadPreinstallView(remote, warn = (message) => {
	console.warn(`[zdsh-plugin-center] ${message}`);
}) {
	try {
		const governance = remote?.pluginGovernance;
		if (governance === void 0 || typeof governance.list !== "function" || typeof governance.preinstallReport !== "function") {
			warn("factory-preinstall section hidden: this host exposes no pluginGovernance list/preinstallReport face");
			return null;
		}
		const [roster, report] = await Promise.all([Promise.resolve(governance.list()), Promise.resolve(governance.preinstallReport())]).then(([rawRoster, rawReport]) => [unwrapEnvelope(rawRoster), unwrapEnvelope(rawReport)]);
		const plugins = roster?.plugins;
		return buildPreinstallView(Array.isArray(plugins) ? plugins : [], report ?? null);
	} catch (cause) {
		warn(`factory-preinstall section hidden: ${cause instanceof Error ? cause.message : String(cause)}`);
		return null;
	}
}
/**
* Fold a package or repository name into the governance id space.
*
* The `dsh-` and `zdsh-` prefixes are the two package-name generations the
* governance host folds into `core/`; anything else keeps its own name.
* @param name - a package or repository name.
* @returns the governance id the name folds into.
*/
function governanceIdOf(name) {
	if (name.startsWith("dsh-")) {
		const rest = name.slice(4);
		return rest === "" ? name : `core/${rest}`;
	}
	if (name.startsWith("zdsh-")) {
		const rest = name.slice(5);
		return rest === "" ? name : `core/${rest}`;
	}
	return name;
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
function isEntryInstalled(entry, installed) {
	const repo = entry.repo ?? entry.id.split("/")[1] ?? "";
	if (repo === "") return false;
	if (installed.ids.has(entry.id)) return true;
	if (installed.ids.has(governanceIdOf(repo))) return true;
	if (installed.ids.has(governanceIdOf(repo.toLowerCase()))) return true;
	return installed.names.has(repo);
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
async function loadInstalledPlugins(remote, warn = (message) => {
	console.warn(`[zdsh-plugin-center] ${message}`);
}) {
	try {
		const governance = remote?.pluginGovernance;
		if (governance === void 0 || typeof governance.list !== "function") {
			warn("installed-state lookup unavailable: this host exposes no pluginGovernance list face");
			return;
		}
		const roster = unwrapEnvelope(await Promise.resolve(governance.list()));
		const plugins = Array.isArray(roster?.plugins) ? roster.plugins : [];
		const ids = /* @__PURE__ */ new Set();
		const names = /* @__PURE__ */ new Set();
		for (const row of plugins) {
			const pluginId = asString(row.pluginId);
			if (pluginId !== null) ids.add(pluginId);
			const displayName = asString(row.displayName);
			if (displayName !== null) names.add(displayName);
		}
		return {
			ids,
			names
		};
	} catch (cause) {
		warn(`installed-state lookup unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
		return;
	}
}
//#endregion
//#region src/client/index.tsx
/**
* zdsh-plugin-center — web client surface.
*
* Loaded by the host module loader as a CJS block exposing {inject, apply}
* (react arrives through the loader's require, exactly like any peer).
* Registers a settings section (order 30, after inventory/governance) and
* talks to the plugin's own /api2 routes on the same origin.
*/
const PLUGIN_CENTER_SLOT_ID = "zdsh-plugin-center";
const PLUGIN_CENTER_SLOT_ORDER = 30;
/** Factory-preinstall section (DESIGN §8-ADJ-1 case B): standalone and read-only. */
const PREINSTALL_SLOT_ID = "zdsh-plugin-center-preinstall";
const PREINSTALL_SLOT_ORDER = 31;
const INTENT_HEADER = "x-zdsh-pc-intent";
const API = "/api2/zdsh-plugin-center";
/** ADJ-2 case C: the client reaches remote.pluginGovernance directly. */
const inject = [
	"slots",
	"remote",
	"remote.pluginGovernance"
];
const messages = {
	zh: {
		brand: "ZDSH 插件中心",
		sub: "发现 · 信任 · 安全安装 · 审计",
		search: "搜索名称、仓库或包名，回车确认…",
		allCategories: "分类过滤…",
		recommendedOnly: "只看推荐",
		install: "安装",
		evidenceRecommended: "推荐",
		evidenceVerified: "已验证",
		evidenceInstallable: "可安装",
		evidenceDiscovered: "仅发现",
		/** The catalog entry's plugin is already registered on this host. */
		evidenceInstalled: "已安装",
		/** The install action, for an entry that is already installed. */
		reinstall: "重新安装",
		compatExact: "兼容",
		compatRange: "范围支持·待验证",
		compatUnknown: "兼容性未知",
		sourceGithub: "GitHub 固定 commit",
		sourceNpm: "npm 固定版本",
		offlineHint: "当前为离线快照目录，数据可能不是最新。",
		confirmTitle: "确认安装",
		confirmHint: "请输入下方确认码后执行（一次性计划，防误触）：",
		cancelButton: "取消",
		confirmButton: "执行",
		appliedTitle: "已应用，等待重启生效",
		appliedBody: "依赖变更将在宿主重启后生效。",
		failedTitle: "操作失败",
		auditHeading: "审计记录（最近）",
		loading: "加载中…",
		empty: "没有匹配的插件。",
		prevPage: "上一页",
		nextPage: "下一页",
		opsHeading: "运维",
		guardianLabel: "看门狗",
		start: "启动",
		stop: "停止",
		backupsLabel: "备份快照",
		restoreBtn: "恢复",
		confirmRestore: (name) => `恢复备份 ${name}？请输入确认码继续：`,
		deleteBtn: "删除",
		restoredTitle: "已恢复",
		deletedTitle: "已删除快照",
		uninstall: "卸载",
		preinstallHeading: "出厂组件",
		preinstallBadgeInstalled: "出厂已装",
		preinstallBadgeFailed: "出厂失败",
		preinstallBadgeUninstalled: "已被卸载（不会重装）",
		preinstallMountMounted: "已装载",
		preinstallMountFailed: "装载失败",
		preinstallMountSkipped: "出厂未激活",
		preinstallMountUnknown: "装载状态未知",
		preinstallEnable: "启用",
		preinstallDisable: "停用",
		preinstallUninstall: "卸载",
		preinstallWorking: "处理中…",
		preinstallEmpty: "当前宿主没有出厂预装组件。",
		pageInfo: (a, b, c) => `第 ${String(a)} / ${String(b)} 页 · 共 ${String(c)} 条`,
		sourceOf: (entry) => entry.source === "github" ? messages.zh.sourceGithub : messages.zh.sourceNpm
	},
	en: {
		brand: "ZDSH Plugin Center",
		sub: "Discover · Trust · Safe installs · Audit",
		search: "Search names, repos or packages, press Enter…",
		allCategories: "Filter by category…",
		recommendedOnly: "Recommended only",
		install: "Install",
		evidenceRecommended: "Recommended",
		evidenceVerified: "Verified",
		evidenceInstallable: "Installable",
		evidenceDiscovered: "Discovered",
		/** The catalog entry's plugin is already registered on this host. */
		evidenceInstalled: "Installed",
		/** The install action, for an entry that is already installed. */
		reinstall: "Reinstall",
		compatExact: "Compatible",
		compatRange: "Range supported · unverified",
		compatUnknown: "Compatibility unknown",
		sourceGithub: "GitHub pinned commit",
		sourceNpm: "npm pinned version",
		offlineHint: "Showing an offline snapshot catalog; data may be stale.",
		confirmTitle: "Confirm install",
		confirmHint: "Type the confirmation code to apply this one-shot plan:",
		cancelButton: "Cancel",
		confirmButton: "Apply",
		appliedTitle: "Applied — restart required",
		appliedBody: "Dependency changes take effect after the host restarts.",
		failedTitle: "Operation failed",
		auditHeading: "Recent audit trail",
		loading: "Loading…",
		empty: "No matching plugins.",
		prevPage: "Prev",
		nextPage: "Next",
		opsHeading: "Operations",
		guardianLabel: "Watchdog",
		start: "Start",
		stop: "Stop",
		backupsLabel: "Backup snapshots",
		restoreBtn: "Restore",
		confirmRestore: (name) => `Restore backup ${name}? Type the confirmation code to continue:`,
		deleteBtn: "Delete",
		restoredTitle: "Restored",
		deletedTitle: "Snapshot deleted",
		uninstall: "Uninstall",
		preinstallHeading: "Factory components",
		preinstallBadgeInstalled: "Preinstalled",
		preinstallBadgeFailed: "Install failed",
		preinstallBadgeUninstalled: "Uninstalled (will not return)",
		preinstallMountMounted: "Mounted",
		preinstallMountFailed: "Mount failed",
		preinstallMountSkipped: "Off at factory",
		preinstallMountUnknown: "Mount state unknown",
		preinstallEnable: "Enable",
		preinstallDisable: "Disable",
		preinstallUninstall: "Uninstall",
		preinstallWorking: "Working…",
		preinstallEmpty: "This host has no factory-preinstalled components.",
		pageInfo: (a, b, c) => `Page ${String(a)} / ${String(b)} · ${String(c)} entries`,
		sourceOf: (entry) => entry.source === "github" ? messages.en.sourceGithub : messages.en.sourceNpm
	}
};
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
function entryBadge(entry, locale) {
	const t = messages[locale];
	if (entry.installed === true) return t.evidenceInstalled;
	return evidenceLabel(entry.evidence, locale);
}
function evidenceLabel(evidence, locale) {
	const t = messages[locale];
	if (evidence === "recommended") return t.evidenceRecommended;
	if (evidence === "verified") return t.evidenceVerified;
	if (evidence === "installable") return t.evidenceInstallable;
	return t.evidenceDiscovered;
}
function compatLabel(compat, locale) {
	const key = compat === "exact" ? "compatExact" : compat === "range-supported" ? "compatRange" : "compatUnknown";
	return (locale === "zh" ? messages.zh : messages.en)[key];
}
async function apiGet(path) {
	const response = await fetch(path, { headers: { accept: "application/json" } });
	if (!response.ok) throw new Error(`GET ${path} → ${String(response.status)}`);
	return await response.json();
}
async function apiPost(path, body) {
	const response = await fetch(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			[INTENT_HEADER]: PLUGIN_CENTER_SLOT_ID
		},
		body: JSON.stringify(body)
	});
	const payload = await response.json();
	if (!response.ok) throw new Error(payload.error?.message ?? `POST ${path} failed`);
	return payload;
}
function marketUrl(params) {
	const search = new URLSearchParams();
	search.set("page", String(Math.max(1, params.page)));
	search.set("pageSize", "24");
	if (params.q.trim() !== "") search.set("q", params.q.trim());
	if (params.category !== "") search.set("category", params.category);
	if (params.onlyRecommended) search.set("onlyRecommended", "1");
	return `${API}/market?${search.toString()}`;
}
function extractSha8(phrase) {
	return phrase.match(/@([0-9a-f]{12})\b/)?.[1] ?? "";
}
/** Headline component: catalog browsing plus the one-shot confirm flow. */
function PluginCenterApp(props) {
	const locale = props.locale ?? "zh";
	const t = messages[locale];
	const [data, setData] = (0, react.useState)(null);
	const [query, setQuery] = (0, react.useState)("");
	const [submitted, setSubmitted] = (0, react.useState)("");
	const [category, setCategory] = (0, react.useState)("");
	const [onlyRec, setOnlyRec] = (0, react.useState)(false);
	const [page, setPage] = (0, react.useState)(1);
	const [dialog, setDialog] = (0, react.useState)(null);
	const [applied, setApplied] = (0, react.useState)(false);
	/** A submission is in flight; the confirm action must not send a second. */
	const [applying, setApplying] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)("");
	const [auditTail, setAuditTail] = (0, react.useState)([]);
	const [guardian, setGuardian] = (0, react.useState)(null);
	const [backups, setBackups] = (0, react.useState)([]);
	/** Outcome of the last snapshot operation; the operations used to end silently. */
	const [notice, setNotice] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		let alive = true;
		apiGet(marketUrl({
			page,
			q: submitted,
			category,
			onlyRecommended: onlyRec
		})).then((next) => {
			if (!alive) return;
			loadInstalledPlugins(props.remote).then((installed) => {
				if (!alive || installed === void 0) return;
				setData({
					...next,
					items: next.items.map((item) => ({
						...item,
						installed: isEntryInstalled(item, installed)
					}))
				});
			});
			setData(next);
		}).catch((err) => {
			if (alive) setError(err instanceof Error ? err.message : String(err));
		});
		return () => {
			alive = false;
		};
	}, [
		page,
		submitted,
		category,
		onlyRec,
		props.remote
	]);
	(0, react.useEffect)(() => {
		let lastBoot = "";
		const timer = window.setInterval(() => {
			apiGet(`${API}/runtime`).then((runtime) => {
				if (lastBoot === "") {
					lastBoot = runtime.bootId;
					return;
				}
				if (runtime.bootId !== lastBoot) {
					lastBoot = runtime.bootId;
					apiGet(marketUrl({
						page: 1,
						q: "",
						category: "",
						onlyRecommended: false
					})).then(setData).catch(() => void 0);
				}
			}).catch(() => void 0);
			apiGet(`${API}/guardian/status`).then(setGuardian).catch(() => void 0);
		}, 5e3);
		apiGet(`${API}/guardian/status`).then(setGuardian).catch(() => void 0);
		apiGet(`${API}/backups`).then(setBackups).catch(() => void 0);
		return () => {
			window.clearInterval(timer);
		};
	}, []);
	const refreshOps = () => {
		apiGet(`${API}/guardian/status`).then(setGuardian).catch(() => void 0);
		apiGet(`${API}/backups`).then(setBackups).catch(() => void 0);
		apiGet(`${API}/audit`).then(setAuditTail).catch(() => void 0);
	};
	const stagePlanFor = async (entryId, action) => {
		setError("");
		try {
			const result = await apiPost(`${API}/plan/stage`, {
				action,
				entryId
			});
			setDialog({
				kind: "plan",
				label: `${action} · ${entryId}`,
				planId: result.planId,
				phraseFull: result.phrase,
				confirmCode: extractSha8(result.phrase)
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};
	/** Run whatever the typed code authorized, then report what happened. */
	const confirmDialog = async () => {
		if (!dialog) return;
		if (applying) return;
		setApplying(true);
		const current = dialog;
		setError("");
		try {
			if (current.kind === "plan") {
				await apiPost(`${API}/plan/apply`, {
					planId: current.planId,
					phrase: current.phraseFull
				});
				setDialog(null);
				setApplied(true);
			} else if (current.kind === "restore") {
				await apiPost(`${API}/backups/restore/apply`, {
					restoreId: current.ticketId,
					code: current.confirmCode
				});
				setDialog(null);
				setNotice({
					kind: "restored",
					name: current.backupName ?? ""
				});
			} else {
				await apiPost(`${API}/backups/delete/apply`, {
					deleteId: current.ticketId,
					code: current.confirmCode
				});
				setDialog(null);
				setNotice({
					kind: "deleted",
					name: current.backupName ?? ""
				});
			}
			refreshOps();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setDialog(null);
		} finally {
			setApplying(false);
		}
	};
	/**
	* Stage a restore and open the confirmation. The host issues a one-shot code
	* at staging; the dialog requires it to be typed rather than prefilled, which
	* is what makes it a confirmation instead of a click-through.
	*/
	const restoreOne = async (name) => {
		setError("");
		setNotice(null);
		try {
			const staged = await apiPost(`${API}/backups/restore`, { name });
			setDialog({
				kind: "restore",
				label: `${t.restoreBtn} · ${name}`,
				backupName: name,
				ticketId: staged.restoreId,
				confirmCode: staged.code
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};
	/** Deleting a snapshot is destructive and irreversible, so it takes a code too. */
	const deleteOne = async (name) => {
		setError("");
		setNotice(null);
		try {
			const staged = await apiPost(`${API}/backups/delete/stage`, { name });
			setDialog({
				kind: "delete",
				label: `${t.deleteBtn} · ${name}`,
				backupName: name,
				ticketId: staged.deleteId,
				confirmCode: staged.code
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};
	const toggleGuardian = async (action) => {
		setError("");
		try {
			await apiPost(`${API}/guardian/toggle`, { action });
			refreshOps();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};
	const total = data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / (data?.pageSize ?? 24)));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "zdsh-pc",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: pluginCenterStyles }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: "13px",
					fontWeight: 600
				},
				children: t.brand
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.sub
			})] }),
			applied ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-banner",
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t.appliedTitle }),
					" — ",
					t.appliedBody
				]
			}) : null,
			notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-banner",
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: notice.kind === "restored" ? t.restoredTitle : t.deletedTitle }), ` — ${notice.name}`]
			}) : null,
			error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-banner",
				role: "alert",
				children: `${t.failedTitle}: ${error}`
			}) : null,
			data !== null && data.mode !== "fresh" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.offlineHint
			}) : null,
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-toolbar",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "zdsh-pc-input",
						type: "search",
						placeholder: t.search,
						value: query,
						onChange: (e) => {
							setQuery(e.target.value);
							if (e.target.value === "") setSubmitted("");
						},
						onKeyDown: (e) => {
							if (e.key === "Enter") {
								setPage(1);
								setSubmitted(query);
							}
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "zdsh-pc-input",
						type: "search",
						style: { maxWidth: "130px" },
						placeholder: t.allCategories,
						value: category,
						onChange: (e) => {
							setPage(1);
							setCategory(e.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "zdsh-pc-toggle",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: onlyRec,
							onChange: (e) => {
								setPage(1);
								setOnlyRec(e.target.checked);
							}
						}), t.recommendedOnly]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryList, {
				data,
				locale,
				onInstall: (id) => {
					stagePlanFor(id, "install");
				},
				onUninstall: (id) => {
					stagePlanFor(id, "uninstall");
				}
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-pager",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						disabled: page <= 1,
						onClick: () => {
							setPage(page - 1);
						},
						children: t.prevPage
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "zdsh-pc-note",
						children: t.pageInfo(page, pageCount, total)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						disabled: page >= pageCount,
						onClick: () => {
							setPage(page + 1);
						},
						children: t.nextPage
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: `${t.opsHeading} · ${t.guardianLabel}${guardian ? ` [${guardian.state}]` : ""}`
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-toolbar",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "zdsh-pc-btn",
					onClick: () => {
						toggleGuardian("start");
					},
					children: t.start
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "zdsh-pc-btn",
					onClick: () => {
						toggleGuardian("stop");
					},
					children: t.stop
				})]
			})] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: `${t.opsHeading} · ${t.backupsLabel}`
			}), backups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: "—"
			}) : backups.slice(0, 5).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-audit-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: new Date(row.createdAtMs).toISOString() }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.name }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						onClick: () => {
							restoreOne(row.name);
						},
						children: t.restoreBtn
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						onClick: () => {
							deleteOne(row.name);
						},
						children: t.deleteBtn
					})
				]
			}, row.name))] }),
			auditTail.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.auditHeading
			}), auditTail.slice(-8).map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-audit-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.ts ?? "" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: `${row.action ?? ""}:${row.step ?? ""}` }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.outcome ?? "" })
				]
			}, `${row.ts ?? ""}-${String(index)}`))] }) : null,
			dialog !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
				dialog,
				locale,
				applying,
				onCancel: () => {
					if (dialog.kind === "plan") apiPost(`${API}/plan/release`, { planId: dialog.planId }).catch(() => void 0);
					setDialog(null);
				},
				onConfirm: () => {
					confirmDialog();
				}
			}) : null
		]
	});
}
function EntryList(props) {
	const t = messages[props.locale];
	if (props.data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "zdsh-pc-note",
		children: t.loading
	});
	if (props.data.items.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "zdsh-pc-note",
		children: t.empty
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "zdsh-pc-list",
		children: props.data.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryCard, {
			entry: item,
			locale: props.locale,
			onInstall: () => {
				props.onInstall(item.id);
			},
			onUninstall: () => {
				props.onUninstall(item.id);
			}
		}, item.id))
	});
}
function EntryCard(props) {
	const t = messages[props.locale];
	const item = props.entry;
	const installed = item.installed === true;
	const evidenceClass = installed ? "zdsh-pc-badge zdsh-pc-badge-good" : item.evidence === "recommended" || item.evidence === "verified" ? "zdsh-pc-badge zdsh-pc-badge-good" : "zdsh-pc-badge";
	const compatClass = item.compat === "exact" ? "zdsh-pc-badge zdsh-pc-badge-good" : item.compat === "range-supported" ? "zdsh-pc-badge zdsh-pc-badge-warn" : "zdsh-pc-badge zdsh-pc-badge-dim";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "zdsh-pc-card",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "zdsh-pc-card-main",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-title",
					children: item.title[props.locale]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-desc",
					children: item.summary[props.locale]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "zdsh-pc-badges",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: evidenceClass,
							children: entryBadge(item, props.locale)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: compatClass,
							children: compatLabel(item.compat, props.locale)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "zdsh-pc-badge zdsh-pc-badge-dim",
							children: t.sourceOf(item)
						})
					]
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "zdsh-pc-toolbar",
			style: {
				flexDirection: "column",
				alignItems: "stretch",
				gap: "6px"
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				className: "zdsh-pc-btn",
				disabled: item.evidence === "discovered",
				onClick: props.onInstall,
				children: installed ? t.reinstall : t.install
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				className: "zdsh-pc-btn",
				disabled: item.evidence === "discovered",
				onClick: props.onUninstall,
				children: t.uninstall
			})]
		})]
	});
}
function ConfirmDialog(props) {
	const t = messages[props.locale];
	const [typed, setTyped] = (0, react.useState)("");
	const ready = typed === props.dialog.confirmCode && props.applying !== true;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "zdsh-pc-dialog-backdrop",
		role: "presentation",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "zdsh-pc-dialog",
			role: "dialog",
			"aria-modal": "true",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t.confirmTitle }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-note",
					children: props.dialog.label
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-code",
					children: props.dialog.confirmCode
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
					className: "zdsh-pc-note",
					children: t.confirmHint
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					className: "zdsh-pc-input",
					value: typed,
					onChange: (e) => {
						setTyped(e.target.value);
					},
					onKeyDown: (e) => {
						if (e.key === "Enter" && ready) props.onConfirm();
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "zdsh-pc-actions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						onClick: props.onCancel,
						children: t.cancelButton
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						disabled: !ready,
						onClick: props.onConfirm,
						children: t.confirmButton
					})]
				})
			]
		})
	});
}
/** Badge copy for one factory-view row, per locale (exported for the spec). */
function preinstallBadgeLabel(row, locale) {
	const t = locale === "zh" ? messages.zh : messages.en;
	if (row.badge === "userUninstalled") return t.preinstallBadgeUninstalled;
	if (row.badge === "failed") return t.preinstallBadgeFailed;
	return t.preinstallBadgeInstalled;
}
/** Mount-dimension label (§9.4): an admitted artifact can still have failed to load. */
function preinstallMountLabel(row, locale) {
	const t = locale === "zh" ? messages.zh : messages.en;
	if (row.mount === "mounted") return t.preinstallMountMounted;
	if (row.mount === "failed") return t.preinstallMountFailed;
	if (row.mount === "skipped") return t.preinstallMountSkipped;
	return t.preinstallMountUnknown;
}
/**
* The factory-preinstall section (ADJ-1 case B). Read-only, standalone;
* under the ADJ-2 fail-safe it renders NOTHING while data is loading or on
* any fetch failure — it can never red-screen, and the market section is a
* separate slot that never reads this one.
*/
function PreinstallSection(props) {
	const locale = props.locale ?? "zh";
	const t = messages[locale];
	const [view, setView] = (0, react.useState)(null);
	const [working, setWorking] = (0, react.useState)(null);
	const [failure, setFailure] = (0, react.useState)(null);
	const reload = (0, react.useCallback)(async () => {
		const next = await loadPreinstallView(props.remote);
		setView(next);
	}, [props.remote]);
	(0, react.useEffect)(() => {
		let alive = true;
		loadPreinstallView(props.remote).then((next) => {
			if (alive) setView(next);
		}).catch(() => {
			if (alive) setView(null);
		});
		return () => {
			alive = false;
		};
	}, [props.remote]);
	/**
	* Run one governance action on a factory component and reload the view.
	*
	* The section used to be a read-only list, so an operator could see which
	* components the factory installed but could not stop or remove one — the
	* request was for exactly that.
	*/
	const act = (0, react.useCallback)(async (seedId, action) => {
		const call = (props.remote?.pluginGovernance)?.[action];
		if (typeof call !== "function") {
			setFailure("this host exposes no plugin governance action");
			return;
		}
		setWorking(seedId);
		setFailure(null);
		try {
			const envelope = await call({ pluginId: seedId });
			if (envelope !== null && typeof envelope === "object" && envelope.ok === false) setFailure(typeof envelope.error?.message === "string" ? envelope.error.message : "the host refused the action");
			await reload();
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			setWorking(null);
		}
	}, [props.remote, reload]);
	if (view === null) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "zdsh-pc",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: pluginCenterStyles }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.preinstallHeading
			}),
			view.rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.preinstallEmpty
			}) : view.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-audit-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.displayName }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: row.badge === "preinstalled" ? "zdsh-pc-badge zdsh-pc-badge-good" : row.badge === "failed" ? "zdsh-pc-badge zdsh-pc-badge-warn" : "zdsh-pc-badge zdsh-pc-badge-dim",
						children: preinstallBadgeLabel(row, locale)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: preinstallMountLabel(row, locale) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.badge === "failed" ? row.reason ?? "" : "" }),
					row.badge === "userUninstalled" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "zdsh-pc-toolbar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "zdsh-pc-btn",
							disabled: working !== null,
							onClick: () => {
								act(row.seedId, row.enabled ? "disable" : "enable");
							},
							children: row.enabled ? t.preinstallDisable : t.preinstallEnable
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "zdsh-pc-btn",
							disabled: working !== null,
							onClick: () => {
								act(row.seedId, "uninstall");
							},
							children: t.preinstallUninstall
						})]
					})
				]
			}, row.seedId)),
			working !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: t.preinstallWorking
			}) : null,
			failure !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "zdsh-pc-note",
				children: failure
			}) : null
		]
	});
}
/** Register the plugin center as its own settings section (order 30). */
function apply(ctx) {
	ctx.effect(() => {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: PLUGIN_CENTER_SLOT_ID,
			order: 30,
			label: messages.zh.brand
		}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCenterApp, {
			locale: "zh",
			remote: ctx.remote
		})));
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: PREINSTALL_SLOT_ID,
			order: 31,
			label: messages.zh.preinstallHeading
		}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreinstallSection, {
			locale: "zh",
			remote: ctx.remote
		})));
		return () => void 0;
	}, "zdsh-plugin-center: settings section");
}
//#endregion
exports.INTENT_HEADER = INTENT_HEADER;
exports.PLUGIN_CENTER_SLOT_ID = PLUGIN_CENTER_SLOT_ID;
exports.PLUGIN_CENTER_SLOT_ORDER = PLUGIN_CENTER_SLOT_ORDER;
exports.PREINSTALL_SLOT_ID = PREINSTALL_SLOT_ID;
exports.PREINSTALL_SLOT_ORDER = PREINSTALL_SLOT_ORDER;
exports.PluginCenterApp = PluginCenterApp;
exports.PreinstallSection = PreinstallSection;
exports.apply = apply;
exports.compatLabel = compatLabel;
exports.entryBadge = entryBadge;
exports.evidenceLabel = evidenceLabel;
exports.extractSha8 = extractSha8;
exports.inject = inject;
exports.marketUrl = marketUrl;
exports.preinstallBadgeLabel = preinstallBadgeLabel;
exports.preinstallMountLabel = preinstallMountLabel;


    return module.exports;
  }
});
//# sourceMappingURL=client.js.map