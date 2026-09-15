window.__ModuleLoader__.load({
  id: "zdsh-plugin-center",
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
* Join the two Remote surfaces by seedId. Roster rows WITHOUT
* `provenance==='preinstall'` (operator npm installs, loader mirrors,
* project entries) never enter the factory view; ledger rows without a
* roster counterpart (failed installs, tombstones) do. Malformed entries
* are coerced to 'unknown' verdicts rather than dropped, so a corrupt row
* still surfaces for the operator to investigate.
*/
function buildPreinstallView(rosterRows, report) {
	const merged = /* @__PURE__ */ new Map();
	for (const row of rosterRows) {
		if (row.provenance !== "preinstall") continue;
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
		merged.set(seedId, {
			seedId,
			displayName,
			admitted,
			status,
			reason,
			userUninstalled,
			mount: mount.state,
			mountReason: mount.reason,
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
		uninstall: "卸载",
		preinstallHeading: "出厂组件",
		preinstallBadgeInstalled: "出厂已装",
		preinstallBadgeFailed: "出厂失败",
		preinstallBadgeUninstalled: "已被卸载（不会重装）",
		preinstallMountMounted: "已装载",
		preinstallMountFailed: "装载失败",
		preinstallMountSkipped: "出厂未激活",
		preinstallMountUnknown: "装载状态未知",
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
		uninstall: "Uninstall",
		preinstallHeading: "Factory components",
		preinstallBadgeInstalled: "Preinstalled",
		preinstallBadgeFailed: "Install failed",
		preinstallBadgeUninstalled: "Uninstalled (will not return)",
		preinstallMountMounted: "Mounted",
		preinstallMountFailed: "Mount failed",
		preinstallMountSkipped: "Off at factory",
		preinstallMountUnknown: "Mount state unknown",
		preinstallEmpty: "This host has no factory-preinstalled components.",
		pageInfo: (a, b, c) => `Page ${String(a)} / ${String(b)} · ${String(c)} entries`,
		sourceOf: (entry) => entry.source === "github" ? messages.en.sourceGithub : messages.en.sourceNpm
	}
};
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
	const [error, setError] = (0, react.useState)("");
	const [auditTail, setAuditTail] = (0, react.useState)([]);
	const [guardian, setGuardian] = (0, react.useState)(null);
	const [backups, setBackups] = (0, react.useState)([]);
	(0, react.useEffect)(() => {
		let alive = true;
		apiGet(marketUrl({
			page,
			q: submitted,
			category,
			onlyRecommended: onlyRec
		})).then((next) => {
			if (alive) setData(next);
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
		onlyRec
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
				planId: result.planId,
				entryId,
				action,
				phraseFull: result.phrase,
				confirmCode: extractSha8(result.phrase)
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};
	const applyStaged = async () => {
		if (!dialog) return;
		try {
			await apiPost(`${API}/plan/apply`, {
				planId: dialog.planId,
				phrase: dialog.phraseFull
			});
			setDialog(null);
			setApplied(true);
			refreshOps();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setDialog(null);
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
	const restoreOne = async (name) => {
		setError("");
		try {
			const staged = await apiPost(`${API}/backups/restore`, { name });
			const typed = window.prompt(t.confirmRestore(name), staged.code);
			if (typed === null || typed.trim() !== staged.code) return;
			await apiPost(`${API}/backups/restore/apply`, {
				restoreId: staged.restoreId,
				code: staged.code
			});
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
				onCancel: () => {
					setDialog(null);
				},
				onConfirm: () => {
					applyStaged();
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
	const evidenceClass = item.evidence === "recommended" || item.evidence === "verified" ? "zdsh-pc-badge zdsh-pc-badge-good" : "zdsh-pc-badge";
	const compatClass = item.compat === "exact" ? "zdsh-pc-badge zdsh-pc-badge-good" : item.compat === "range-supported" ? "zdsh-pc-badge zdsh-pc-badge-warn" : "zdsh-pc-badge zdsh-pc-badge-dim";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "zdsh-pc-card",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "zdsh-pc-card-main",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-card-title",
					children: item.title[props.locale]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-card-desc",
					children: item.summary[props.locale]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "zdsh-pc-badges",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: evidenceClass,
							children: evidenceLabel(item.evidence, props.locale)
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
				children: t.install
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
	const ready = typed === props.dialog.confirmCode;
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
					children: `${props.dialog.action} · ${props.dialog.entryId}`
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
	if (view === null) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "zdsh-pc",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "zdsh-pc-note",
			children: t.preinstallHeading
		}), view.rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: row.badge === "failed" ? row.reason ?? "" : "" })
			]
		}, row.seedId))]
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
		}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCenterApp, { locale: "zh" })));
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