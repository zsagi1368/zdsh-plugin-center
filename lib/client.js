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
const INTENT_HEADER = "x-zdsh-pc-intent";
const API = "/api2/zdsh-plugin-center";
const inject = ["slots"];
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
		return () => window.clearInterval(timer);
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
				onInstall: (id) => void stagePlanFor(id, "install"),
				onUninstall: (id) => void stagePlanFor(id, "uninstall")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "zdsh-pc-pager",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						disabled: page <= 1,
						onClick: () => setPage(page - 1),
						children: t.prevPage
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "zdsh-pc-note",
						children: t.pageInfo(page, pageCount, total)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "zdsh-pc-btn",
						disabled: page >= pageCount,
						onClick: () => setPage(page + 1),
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
					onClick: () => void toggleGuardian("start"),
					children: t.start
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "zdsh-pc-btn",
					onClick: () => void toggleGuardian("stop"),
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
						onClick: () => void restoreOne(row.name),
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
				onCancel: () => setDialog(null),
				onConfirm: () => void applyStaged()
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
			onInstall: () => props.onInstall(item.id),
			onUninstall: () => props.onUninstall(item.id)
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
					children: item.title[props.locale] ?? item.title.en
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "zdsh-pc-card-desc",
					children: item.summary[props.locale] ?? item.summary.en
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
					onChange: (e) => setTyped(e.target.value),
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
/** Register the plugin center as its own settings section (order 30). */
function apply(ctx) {
	ctx.effect(() => {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: PLUGIN_CENTER_SLOT_ID,
			order: 30,
			label: messages.zh.brand
		}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCenterApp, { locale: "zh" })));
		return () => void 0;
	}, "zdsh-plugin-center: settings section");
}
//#endregion
exports.INTENT_HEADER = INTENT_HEADER;
exports.PLUGIN_CENTER_SLOT_ID = PLUGIN_CENTER_SLOT_ID;
exports.PLUGIN_CENTER_SLOT_ORDER = PLUGIN_CENTER_SLOT_ORDER;
exports.PluginCenterApp = PluginCenterApp;
exports.apply = apply;
exports.compatLabel = compatLabel;
exports.evidenceLabel = evidenceLabel;
exports.extractSha8 = extractSha8;
exports.inject = inject;
exports.marketUrl = marketUrl;


    return module.exports;
  }
});
//# sourceMappingURL=client.js.map