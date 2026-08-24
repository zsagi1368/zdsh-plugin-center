import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { appendFileSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/shared/types.ts
/** Stable error codes for every failure surface of the plugin center. */
const CpErrorCode = {
	invalidPlan: "invalid_plan",
	untrustedSource: "untrusted_source",
	hashMismatch: "hash_mismatch",
	backupFailed: "backup_failed",
	installFailed: "install_failed",
	healthCheckFailed: "health_check_failed",
	rollbackFailed: "rollback_failed",
	planConsumed: "plan_consumed",
	planNotFound: "plan_not_found",
	confirmationMismatch: "confirmation_mismatch",
	scriptBlocked: "script_blocked",
	sourceUnreachable: "source_unreachable",
	offlineDegraded: "offline_degraded",
	unsafeUrl: "unsafe_url",
	internal: "internal"
};
function cpOk(data) {
	return {
		ok: true,
		data
	};
}
function cpErr(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}
/**
* Normalize a plugin id to the canonical `namespace/name` form.
* Accepts `@scope/pkg`, `owner/repo` and bare names; rejects empties and any
* character outside the safe identifier set (ids flow into command argv).
*/
function normalizePluginId(raw) {
	const trimmed = raw.trim().replace(/^@/, "");
	if (!trimmed) return cpErr(CpErrorCode.invalidPlan, "empty plugin id");
	if (trimmed.length > 120) return cpErr(CpErrorCode.invalidPlan, "plugin id too long");
	const parts = trimmed.split("/").filter(Boolean);
	if (parts.length === 0 || parts.length > 2) return cpErr(CpErrorCode.invalidPlan, `malformed plugin id: ${raw}`);
	for (const part of parts) if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) return cpErr(CpErrorCode.invalidPlan, `illegal characters in plugin id segment: ${part.slice(0, 30)}`);
	return cpOk(parts.join("/"));
}
//#endregion
//#region src/shared/redact.ts
const SENSITIVE_KEY = /(token|secret|password|passwd|credential|authorization|auth|api[-_]?key|^key$|cookie|session)/i;
const JWT_LIKE = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;
const LONG_HEX = /^[0-9a-f]{32,}$/i;
const REDACTED = "[redacted]";
function isSensitiveValue(value) {
	return JWT_LIKE.test(value) || LONG_HEX.test(value);
}
function redactValue(key, value) {
	if (SENSITIVE_KEY.test(key) || isSensitiveValue(value)) return REDACTED;
	return value;
}
/** Shallow record redaction used by the audit trail before anything hits disk. */
function redactRecord(record) {
	const output = {};
	for (const [key, value] of Object.entries(record)) if (typeof value === "string") output[key] = redactValue(key, value);
	else if (value !== null && typeof value === "object" && !Array.isArray(value)) output[key] = redactRecord(value);
	else output[key] = value;
	return output;
}
//#endregion
//#region src/shared/ssrc-guard.ts
var ssrc_guard_exports = /* @__PURE__ */ __exportAll({
	assertSafeUrl: () => assertSafeUrl,
	isHostAllowed: () => isHostAllowed,
	parseFlexibleIpv4: () => parseFlexibleIpv4,
	safeFetch: () => safeFetch
});
const BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
	"localhost",
	"ip6-localhost",
	"ip6-loopback",
	"metadata.google.internal"
]);
function ipv4ToInt(h) {
	const parts = h.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		const n = Number(part);
		if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(part)) return null;
		value = value * 256 + n;
	}
	return value;
}
function inCidr4(ip, base, bits) {
	const baseInt = ipv4ToInt(base);
	if (baseInt === null) return false;
	const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
	return (ip & mask) === (baseInt & mask);
}
/**
* Decide whether a host (already lower-cased, brackets stripped) is safe for
* outbound requests. Rejects loopback, private, link-local, CGNAT, multicast,
* reserved and IPv4-mapped IPv6 forms.
*/
function isHostAllowed(hostname) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) return false;
	if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/i.test(host)) return judgeIpv4Literal(host.slice(7));
	if (host.includes(":")) {
		const normalized = host;
		if (normalized.toLowerCase().startsWith("::ffff:")) return judgeIpv4Literal(normalized.slice(7));
		const halves = normalized.split("::");
		let groups;
		if (halves.length === 2) {
			const left = halves[0] ? halves[0].split(":") : [];
			const right = halves[1] ? halves[1].split(":") : [];
			const fill = 8 - left.length - right.length;
			if (fill < 0) return false;
			groups = [
				...left,
				...Array(fill).fill("0"),
				...right
			];
		} else groups = normalized.split(":");
		if (groups.length !== 8) return false;
		const hex = groups.map((g) => parseInt(g, 16));
		if (hex.some((n) => Number.isNaN(n))) return false;
		const first = hex[0];
		if (hex.every((n) => n === 0)) return false;
		if (hex.slice(0, 7).every((n) => n === 0) && hex[7] === 1) return false;
		if (hex.slice(0, 5).every((n) => n === 0) && hex[5] === 65535) return judgeIpv4Literal(hexGroupsToIpv4(hex[6], hex[7]));
		if (hex.slice(0, 6).every((n) => n === 0) && !hex.slice(6).every((n) => n === 0)) return judgeIpv4Literal(hexGroupsToIpv4(hex[6], hex[7]));
		if (first === 100 && hex[1] === 65435 && hex.slice(2, 6).every((n) => n === 0)) return judgeIpv4Literal(hexGroupsToIpv4(hex[6], hex[7]));
		if ((first & 65024) === 64512) return false;
		if ((first & 65472) === 65152) return false;
		if ((first & 65280) === 65280) return false;
		return true;
	}
	const v4 = ipv4ToInt(host);
	if (v4 !== null) return judgeIpv4(v4);
	const flexible = parseFlexibleIpv4(host);
	if (flexible !== null) return judgeIpv4(flexible);
	if (/^[0-9.]+$/.test(host)) return false;
	if (host.length > 253) return false;
	if (host.endsWith(".local") || host.endsWith(".internal")) return false;
	return host.split(".").every((label) => label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) && /[a-z0-9]/.test(host);
}
function hexGroupsToIpv4(high, low) {
	return [
		high >> 8 & 255,
		high & 255,
		low >> 8 & 255,
		low & 255
	].join(".");
}
function judgeIpv4Literal(literal) {
	const v4 = ipv4ToInt(literal);
	return v4 !== null && judgeIpv4(v4);
}
function judgeIpv4(ip) {
	if (inCidr4(ip, "0.0.0.0", 8)) return false;
	if (inCidr4(ip, "10.0.0.0", 8)) return false;
	if (inCidr4(ip, "127.0.0.0", 8)) return false;
	if (inCidr4(ip, "169.254.0.0", 16)) return false;
	if (inCidr4(ip, "172.16.0.0", 12)) return false;
	if (inCidr4(ip, "192.168.0.0", 16)) return false;
	if (inCidr4(ip, "100.64.0.0", 10)) return false;
	if (inCidr4(ip, "224.0.0.0", 4)) return false;
	if (inCidr4(ip, "240.0.0.0", 4)) return false;
	return true;
}
/**
* Full inet_aton-style parsing: OS resolvers accept `2130706433`, `127.1`,
* `0x7f000001` and `0177.0.0.1` as loopback, so the guard must judge every
* numeric form instead of letting it fall through to the DNS-name path.
* Returns null when the string is not a numeric IPv4 form at all.
*/
function parseFlexibleIpv4(host) {
	if (!/^[0-9xXa-fA-F.]+$/.test(host) || !/\d/.test(host)) return null;
	const parts = host.split(".");
	if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === "")) return null;
	const values = [];
	for (const part of parts) {
		let value;
		if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = Number.parseInt(part, 16);
		else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part, 8);
		else if (/^\d+$/.test(part)) value = Number.parseInt(part, 10);
		else return null;
		if (!Number.isFinite(value) || value < 0 || value > 4294967295) return null;
		values.push(value);
	}
	const lastWidthBytes = 5 - values.length;
	const last = values[values.length - 1];
	if (last >= 256 ** lastWidthBytes) return null;
	let high = 0;
	for (let index = 0; index < values.length - 1; index += 1) {
		const v = values[index];
		if (v > 255) return null;
		high = high * 256 + v;
	}
	return high * 256 ** lastWidthBytes + last >>> 0;
}
/** Validate an outbound URL; returns the parsed URL or a closed error. */
function assertSafeUrl(raw) {
	let url;
	try {
		url = raw instanceof URL ? raw : new URL(raw);
	} catch {
		return {
			ok: false,
			error: {
				code: CpErrorCode.unsafeUrl,
				message: `malformed url`
			}
		};
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return {
		ok: false,
		error: {
			code: CpErrorCode.unsafeUrl,
			message: `protocol not allowed: ${url.protocol}`
		}
	};
	if (url.username || url.password) return {
		ok: false,
		error: {
			code: CpErrorCode.unsafeUrl,
			message: "embedded credentials are not allowed"
		}
	};
	if (!isHostAllowed(url.hostname)) return {
		ok: false,
		error: {
			code: CpErrorCode.unsafeUrl,
			message: `host not allowed: ${url.hostname}`
		}
	};
	return {
		ok: true,
		data: url
	};
}
const SENSITIVE_REDIRECT_HEADERS = /^(authorization|cookie|cookie2|proxy-authorization|x-zdsh-pc-intent)$/i;
/**
* fetch wrapper that re-validates every hop (redirects are followed manually)
* so a redirect cannot smuggle us onto a private address, and credential
* headers are stripped the moment we leave the original origin.
*/
async function safeFetch(rawUrl, options = {}) {
	const maxRedirects = options.maxRedirects ?? 3;
	let current = assertSafeUrl(rawUrl);
	let origin = current.ok ? current.data.origin : "";
	const headers = { ...options.headers ?? {} };
	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		if (!current.ok) return current;
		if (current.data.origin !== origin) {
			for (const key of Object.keys(headers)) if (SENSITIVE_REDIRECT_HEADERS.test(key)) delete headers[key];
			origin = current.data.origin;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
		try {
			const response = await fetch(current.data, {
				redirect: "manual",
				headers,
				signal: controller.signal
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) return {
					ok: false,
					error: {
						code: CpErrorCode.sourceUnreachable,
						message: "redirect without location"
					}
				};
				current = assertSafeUrl(new URL(location, current.data));
				continue;
			}
			const text = await response.text();
			return {
				ok: true,
				data: {
					status: response.status,
					text
				}
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					code: CpErrorCode.sourceUnreachable,
					message: error instanceof Error ? error.message : "fetch failed"
				}
			};
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		ok: false,
		error: {
			code: CpErrorCode.sourceUnreachable,
			message: "too many redirects"
		}
	};
}
//#endregion
//#region src/shared/catalog.ts
const COMMIT_HEX = /^[0-9a-f]{40}$/;
function isValidCommit(commit) {
	return COMMIT_HEX.test(commit);
}
const NAME_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/;
const NPM_PACKAGE = /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,213}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CATEGORY = /^[A-Za-z0-9 _-]{1,40}$/;
const TEXT_LIMIT = 200;
function textOk(value) {
	const t = value;
	return typeof t === "object" && t !== null && typeof t.zh === "string" && t.zh.length >= 1 && t.zh.length <= TEXT_LIMIT && typeof t.en === "string" && t.en.length >= 1 && t.en.length <= TEXT_LIMIT;
}
/** Structural validation; ids are normalized and every argv-bound field is
* pinned to a strict charset (these values reach command construction). */
function validateCatalogEntry(raw) {
	if (typeof raw !== "object" || raw === null) return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "entry is not an object"
		}
	};
	const e = raw;
	const id = typeof e.id === "string" ? normalizePluginId(e.id) : null;
	if (!id || !id.ok) return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "entry id missing or malformed"
		}
	};
	const source = e.source;
	if (source !== "github" && source !== "npm") return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: `unknown source: ${String(source)}`
		}
	};
	let owner;
	let repo;
	let pinnedCommit;
	let packageName;
	let version;
	let integritySha256;
	if (source === "github") {
		const commit = e.pinnedCommit;
		if (typeof commit !== "string" || !isValidCommit(commit)) return {
			ok: false,
			error: {
				code: "untrusted_source",
				message: "github entry requires a pinned 40-hex commit"
			}
		};
		if (typeof e.owner !== "string" || !NAME_PART.test(e.owner)) return {
			ok: false,
			error: {
				code: "untrusted_source",
				message: "github entry requires a safe owner"
			}
		};
		if (typeof e.repo !== "string" || !NAME_PART.test(e.repo)) return {
			ok: false,
			error: {
				code: "untrusted_source",
				message: "github entry requires a safe repo"
			}
		};
		owner = e.owner;
		repo = e.repo;
		pinnedCommit = commit;
	} else {
		if (typeof e.packageName !== "string" || !NPM_PACKAGE.test(e.packageName)) return {
			ok: false,
			error: {
				code: "untrusted_source",
				message: "npm entry requires a safe packageName"
			}
		};
		if (typeof e.version !== "string" || !SEMVER.test(e.version)) return {
			ok: false,
			error: {
				code: "untrusted_source",
				message: "npm entry requires a semver version"
			}
		};
		if (typeof e.integritySha256 === "string" && /^[0-9a-f]{64}$/.test(e.integritySha256)) integritySha256 = e.integritySha256;
		packageName = e.packageName;
		version = e.version;
	}
	if (!textOk(e.title) || !textOk(e.summary)) return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "title/summary must be bilingual strings ≤200 chars"
		}
	};
	const evidence = e.evidence;
	if (evidence !== "discovered" && evidence !== "installable" && evidence !== "verified" && evidence !== "recommended") return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "bad evidence level"
		}
	};
	const compat = e.compat;
	if (compat !== "exact" && compat !== "range-supported" && compat !== "unknown") return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "bad compat level"
		}
	};
	const scriptsPolicy = e.scriptsPolicy;
	if (scriptsPolicy !== "none" && scriptsPolicy !== "allowlisted") return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "bad scripts policy"
		}
	};
	const updatedAt = e.updatedAt;
	if (typeof updatedAt !== "string" || updatedAt.length > 32 || Number.isNaN(Date.parse(updatedAt))) return {
		ok: false,
		error: {
			code: "invalid_plan",
			message: "updatedAt missing or invalid"
		}
	};
	const category = typeof e.category === "string" && CATEGORY.test(e.category) ? e.category : "misc";
	let homepage;
	if (e.homepage !== void 0) {
		if (typeof e.homepage !== "string") return {
			ok: false,
			error: {
				code: "invalid_plan",
				message: "homepage must be a string"
			}
		};
		const checked = assertSafeUrl(e.homepage);
		if (!checked.ok) return {
			ok: false,
			error: {
				code: "unsafe_url",
				message: "homepage must be a safe http(s) URL"
			}
		};
		homepage = checked.data.toString();
	}
	return {
		ok: true,
		data: {
			id: id.data,
			source,
			title: e.title,
			summary: e.summary,
			category,
			evidence,
			compat,
			scriptsPolicy,
			updatedAt,
			...owner !== void 0 ? { owner } : {},
			...repo !== void 0 ? { repo } : {},
			...pinnedCommit !== void 0 ? { pinnedCommit } : {},
			...packageName !== void 0 ? { packageName } : {},
			...version !== void 0 ? { version } : {},
			...integritySha256 !== void 0 ? { integritySha256 } : {},
			...homepage !== void 0 ? { homepage } : {}
		}
	};
}
const EVIDENCE_RANK = {
	recommended: 3,
	verified: 2,
	installable: 1,
	discovered: 0
};
const COMPAT_RANK = {
	exact: 2,
	"range-supported": 1,
	unknown: 0
};
/** Default ordering: recommendation first, then evidence, exact compat, recency. */
function sortEntries(entries) {
	return [...entries].sort((a, b) => {
		const ev = EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence];
		if (ev !== 0) return ev;
		const co = COMPAT_RANK[b.compat] - COMPAT_RANK[a.compat];
		if (co !== 0) return co;
		return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
	});
}
/** Bounded pagination; out-of-range pages clamp to the last non-empty page. */
function paginate(items, page, pageSize) {
	const total = items.length;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
	const start = (safePage - 1) * pageSize;
	return {
		items: items.slice(start, start + pageSize),
		page: safePage,
		pageSize,
		total
	};
}
function searchEntries(entries, query) {
	let result = entries;
	if (query.category) result = result.filter((e) => e.category === query.category);
	if (query.evidenceOnlyRecommended) result = result.filter((e) => e.evidence === "recommended");
	const text = query.text?.trim().toLowerCase();
	if (text) result = result.filter((e) => [
		e.id,
		e.title.zh,
		e.title.en,
		e.summary.zh,
		e.summary.en,
		e.packageName ?? "",
		e.repo ?? ""
	].join(" ").toLowerCase().includes(text));
	return result;
}
//#endregion
//#region src/host/plans.ts
var CpError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "CpError";
	}
};
function hashPlan(plan) {
	const canonical = JSON.stringify({
		action: plan.action,
		profile: plan.profile,
		id: plan.entry.id,
		source: plan.entry.source,
		pinnedCommit: plan.entry.pinnedCommit ?? null,
		packageName: plan.entry.packageName ?? null,
		version: plan.entry.version ?? null
	});
	return createHash("sha256").update(canonical).digest("hex");
}
/**
* Build an install plan from a catalog entry. GitHub entries must pin a full
* commit; anything else is rejected as untrusted before a plan can exist.
*/
function createPlan(entry, action, profile) {
	if (entry.source === "github") {
		if (!entry.pinnedCommit || !isValidCommit(entry.pinnedCommit)) throw new CpError(CpErrorCode.untrustedSource, `entry ${entry.id} has no pinned 40-hex commit`);
		if (!entry.owner || !entry.repo) throw new CpError(CpErrorCode.invalidPlan, "github entry missing owner/repo");
	}
	if (entry.source === "npm" && (!entry.packageName || !entry.version)) throw new CpError(CpErrorCode.invalidPlan, "npm entry missing packageName/version");
	if (!profile.trim()) throw new CpError(CpErrorCode.invalidPlan, "profile is required");
	const digest = hashPlan({
		action,
		profile,
		entry
	});
	return {
		planId: `${digest.slice(0, 16)}-${action}`,
		action,
		profile,
		entry,
		phraseSha8: digest.slice(0, 12),
		createdAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
/**
* Deterministic bilingual confirmation phrase bound to the plan content.
* Same plan always yields the same phrase; different plans never collide in
* practice (12 hex chars of the canonical-content digest).
*/
function confirmationPhrase(plan) {
	return `确认 ${plan.action === "install" ? "安装 install" : plan.action === "update" ? "更新 update" : "卸载 uninstall"} ${plan.entry.id} @${plan.phraseSha8} / confirm`;
}
/** One-shot plan store: confirmation consumes the plan exactly once. */
var PlanStore = class {
	ttlMs;
	pending = /* @__PURE__ */ new Map();
	constructor(ttlMs = 6e5) {
		this.ttlMs = ttlMs;
	}
	add(plan) {
		if (this.pending.has(plan.planId)) throw new CpError(CpErrorCode.invalidPlan, `plan ${plan.planId} already exists`);
		this.pending.set(plan.planId, {
			plan,
			state: "planned",
			expiresAtMs: Date.parse(plan.createdAt) + this.ttlMs
		});
	}
	get(planId) {
		const record = this.pending.get(planId);
		return record ? {
			plan: record.plan,
			state: record.state
		} : null;
	}
	markState(planId, state) {
		const record = this.pending.get(planId);
		if (record) record.state = state;
	}
	/** Consume the plan: only the exact phrase, only once, only unexpired. */
	confirm(planId, phrase) {
		const record = this.pending.get(planId);
		if (!record) throw new CpError(CpErrorCode.planNotFound, `unknown plan ${planId}`);
		if (Date.now() > record.expiresAtMs) {
			this.pending.delete(planId);
			throw new CpError(CpErrorCode.planNotFound, `plan ${planId} expired`);
		}
		if (record.state === "confirmed" || record.state === "executing") throw new CpError(CpErrorCode.planConsumed, `plan ${planId} was already confirmed`);
		if (phrase.trim() !== confirmationPhrase(record.plan)) throw new CpError(CpErrorCode.confirmationMismatch, "confirmation phrase does not match");
		record.state = "confirmed";
		return record.plan;
	}
	/** Drop expired plans; returns the number removed. */
	sweepExpired(nowMs = Date.now()) {
		let removed = 0;
		for (const [id, record] of this.pending) if (nowMs > record.expiresAtMs) {
			this.pending.delete(id);
			removed += 1;
		}
		return removed;
	}
};
//#endregion
//#region src/host/ports.ts
function sleepBusy(multiplier) {
	const until = Date.now() + multiplier * 40;
	while (Date.now() < until);
}
/**
* Refuse to descend through reparse points: every existing segment between
* root and path must be a real directory. Junctions need no privileges on
* Windows, so "predictable dir" plus "attacker-planted junction" equals
* arbitrary write location.
*/
function ensureNoReparse(root, ...segments) {
	const target = resolve(join(resolve(root), ...segments));
	let probe = resolve(root);
	if (lstatSafe(probe)?.isSymbolicLink()) throw new Error(`reparse point at root: ${probe}`);
	for (const segment of segments) {
		probe = join(probe, segment);
		const stats = lstatSafe(probe);
		if (stats !== null && stats.isSymbolicLink()) throw new Error(`reparse point in path: ${probe}`);
	}
	return target;
}
function lstatSafe(path) {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}
function sha256File(path) {
	try {
		if (!lstatSync(path).isFile()) return null;
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return null;
	}
}
/**
* Containment check that survives Windows cross-drive paths: a cross-drive
* `path.relative` degenerates into an absolute path, so an absolute result can
* never count as "inside".
*/
function isInsideRoot(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
/**
* Remove a file or link. Symlinks/junctions are unlinked at the link itself so
* a delete can never follow into the target tree.
*/
function removePathSafe(path) {
	let stats;
	try {
		stats = lstatSync(path);
	} catch {
		return;
	}
	if (stats.isSymbolicLink()) {
		unlinkSync(path);
		return;
	}
	if (stats.isDirectory()) {
		rmSync(path, { recursive: true });
		return;
	}
	unlinkSync(path);
}
/**
* Argument allowlist for shelled commands: catalog-controlled values flow
* into these argv slots, so anything outside this set is refused before a
* process is created. Deliberately excludes quotes, ampersands, pipes,
* redirects, carets, percent (cmd env expansion) and bangs (delayed
* expansion). Space stays allowed because profile directories legitimately
* contain spaces — the data layer below independently pins owner/repo/version
* to a much stricter charset.
*/
const SAFE_ARG = /^[A-Za-z0-9_@+=.,:\\/#\- ]+$/;
function assertSafeArgs(args) {
	for (const arg of args) if (!SAFE_ARG.test(arg)) throw new Error(`refusing unsafe command argument: ${JSON.stringify(arg.slice(0, 40))}`);
}
function runViaSpawn(spec) {
	return new Promise((resolvePromise, rejectPromise) => {
		assertSafeArgs([spec.cmd, ...spec.args]);
		import("node:child_process").then(({ spawn }) => {
			const child = spawn(spec.cmd, spec.args, {
				shell: true,
				windowsHide: true
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			child.on("error", rejectPromise);
			child.on("close", (code) => resolvePromise({
				code: code ?? -1,
				stdout,
				stderr
			}));
		}, rejectPromise);
	});
}
function nodePorts() {
	return {
		fs: {
			readFile(path) {
				try {
					return readFileSync(path, "utf8");
				} catch {
					return null;
				}
			},
			writeFileAtomic(path, contents) {
				const dir = dirname(path);
				mkdirSync(dir, { recursive: true });
				let handle = null;
				let tmp = "";
				for (let attempt = 0; attempt < 5 && handle === null; attempt += 1) {
					tmp = join(dir, `.${Date.now()}-${attempt}-${Math.floor(Math.random() * 4294967295).toString(36)}.tmp`);
					try {
						handle = openSync(tmp, "wx");
					} catch {
						handle = null;
					}
				}
				if (handle === null) throw new Error("writeFileAtomic: cannot create exclusive temp file");
				try {
					writeSync(handle, contents, 0, "utf8");
				} finally {
					closeSync(handle);
				}
				let lastError;
				for (let attempt = 0; attempt < 5; attempt += 1) try {
					renameSync(tmp, path);
					return;
				} catch (error) {
					lastError = error;
					const code = error.code;
					if (code !== "EPERM" && code !== "EACCES") break;
					sleepBusy(attempt + 1);
				}
				try {
					unlinkSync(tmp);
				} catch {}
				throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error("writeFileAtomic failed");
			},
			copyFile(from, to) {
				mkdirSync(dirname(to), { recursive: true });
				const existing = lstatSafe(to);
				if (existing !== null && existing.isSymbolicLink()) unlinkSync(to);
				copyFileSync(from, to);
			},
			mkdirDeep(path) {
				mkdirSync(path, { recursive: true });
			},
			hashFile: sha256File,
			fileExists(path) {
				try {
					return statSync(path).isFile();
				} catch {
					return false;
				}
			},
			removePath: removePathSafe
		},
		commands: { run: runViaSpawn },
		clock: { now: () => /* @__PURE__ */ new Date() },
		http: { async fetchText(url, timeoutMs) {
			const { safeFetch } = await Promise.resolve().then(() => ssrc_guard_exports);
			const result = await safeFetch(url, { timeoutMs });
			if (!result.ok) return result;
			return cpOk(result.data.text);
		} }
	};
}
//#endregion
//#region src/host/lifecycle-engine.ts
/** The three profile files an install touches; the truth lives here. */
const PROFILE_FILES = [
	"package.json",
	"pnpm-workspace.yaml",
	"cordis.patch.yml"
];
const LIFECYCLE_SCRIPT_KEYS = [
	"preinstall",
	"install",
	"postinstall",
	"prepublish",
	"prepare"
];
/** Pure command builders so tests can pin exact shapes without spawning. */
function buildInstallCmd(profile, owner, repo, commit) {
	return {
		cmd: "dsh",
		args: [
			"plugin",
			"--profile",
			profile,
			"add",
			`git+https://github.com/${owner}/${repo}.git#${commit}`
		]
	};
}
function buildNpmAddCmd(profile, pkgName, version) {
	return {
		cmd: "dsh",
		args: [
			"plugin",
			"--profile",
			profile,
			"add",
			`${pkgName}@${version}`
		]
	};
}
function buildRemoveCmd(profile, pkgName) {
	return {
		cmd: "dsh",
		args: [
			"plugin",
			"--profile",
			profile,
			"remove",
			pkgName
		]
	};
}
/** List lifecycle scripts a package manifest would run on install. */
function detectLifecycleScripts(manifest) {
	const scripts = manifest.scripts;
	if (typeof scripts !== "object" || scripts === null) return [];
	const found = [];
	for (const key of LIFECYCLE_SCRIPT_KEYS) {
		const value = scripts[key];
		if (typeof value === "string" && value.trim()) found.push(key);
	}
	return found;
}
var LifecycleEngine = class {
	deps;
	plans = new PlanStore();
	states = /* @__PURE__ */ new Map();
	queue = Promise.resolve();
	constructor(deps) {
		this.deps = deps;
	}
	get fs() {
		return this.deps.ports.fs;
	}
	stateOf(planId) {
		return this.states.get(planId) ?? "draft";
	}
	/**
	* Build and register a plan. `targetManifest` (when the registry supplied
	* the package manifest) runs the lifecycle-script gate before staging.
	*/
	buildPlan(entry, action, profile, targetManifest) {
		try {
			if (action !== "uninstall" && targetManifest) {
				const scripts = detectLifecycleScripts(targetManifest);
				const allow = this.deps.config.scriptAllowlist ?? [];
				const pkgName = entry.packageName ?? entry.id;
				const blocked = scripts.filter((s) => !allow.includes(`${pkgName}:${s}`));
				if (blocked.length > 0) return cpErr("script_blocked", `entry declares lifecycle scripts (${blocked.join(", ")}) not on the allowlist`);
			}
			const plan = createPlan(entry, action, profile);
			this.plans.add(plan);
			this.states.set(plan.planId, "planned");
			this.audit({
				ts: this.now(),
				action: "plan.create",
				planId: plan.planId,
				step: "planned",
				outcome: "ok"
			});
			return cpOk({
				plan,
				phrase: confirmationPhrase(plan)
			});
		} catch (error) {
			return toCpResult(error);
		}
	}
	/** One-shot confirmation bound to the deterministic phrase. */
	confirmPlan(planId, phrase) {
		try {
			const plan = this.plans.confirm(planId, phrase);
			this.audit({
				ts: this.now(),
				action: "plan.confirm",
				planId,
				step: "confirmed",
				outcome: "ok"
			});
			return cpOk(plan);
		} catch (error) {
			return toCpResult(error);
		}
	}
	/**
	* Apply a confirmed plan: pre-hash the profile, back it up, run the pinned
	* official CLI, compare post-state, probe health, audit everything — with
	* byte-exact rollback on any failure after the backup succeeded.
	*
	* Plans serialize through a per-engine queue so two concurrent applies can
	* never interleave snapshots and rollbacks against one profile.
	*/
	applyPlan(planId) {
		const run = this.queue.then(() => this.applyPlanLocked(planId));
		this.queue = run.then(() => void 0, () => void 0);
		return run;
	}
	async applyPlanLocked(planId) {
		const record = this.plans.get(planId);
		if (!record || record.state !== "confirmed") return cpErr("invalid_plan", `plan ${planId} is not in confirmed state`);
		const plan = record.plan;
		this.states.set(planId, "executing");
		let backup = null;
		try {
			const before = this.snapshotProfile(plan.profile);
			const dir = ensureNoReparse(this.deps.config.dataRoot, "backups", `${Date.now()}-${plan.action}-${randomUUID().slice(0, 8)}`);
			this.fs.mkdirDeep(dir);
			const pairs = [];
			for (const snap of before) if (snap.hash !== null) {
				const backupPath = join(dir, baseNameOf(snap.path));
				this.fs.copyFile(snap.path, backupPath);
				pairs.push({
					backupPath,
					originalPath: snap.path
				});
			}
			backup = {
				dir,
				pairs
			};
			this.audit({
				ts: this.now(),
				action: "plan.execute",
				planId,
				step: "backup",
				outcome: "ok"
			});
			const spec = this.commandFor(plan);
			if (spec.args.includes("add") && spec.args.includes("--force")) throw new CpError(CpErrorCode.installFailed, "force-add is forbidden");
			const outcome = await this.deps.ports.commands.run(spec);
			if (outcome.code !== 0) throw new CpError(CpErrorCode.installFailed, `dsh exited ${outcome.code}: ${outcome.stderr.slice(0, 400)}`);
			this.audit({
				ts: this.now(),
				action: "plan.execute",
				planId,
				step: "command",
				outcome: "ok"
			});
			const changed = before.filter((snap) => this.fs.hashFile(snap.path) !== snap.hash).map((s) => baseNameOf(s.path));
			this.audit({
				ts: this.now(),
				action: "plan.execute",
				planId,
				step: "post-hash",
				outcome: "ok",
				detail: { changedFiles: changed.join(",") }
			});
			if (this.deps.healthProbe) try {
				await this.deps.healthProbe();
			} catch (error) {
				throw new CpError(CpErrorCode.healthCheckFailed, error instanceof Error ? error.message : String(error));
			}
			this.audit({
				ts: this.now(),
				action: "plan.execute",
				planId,
				step: "health",
				outcome: "ok"
			});
			this.states.set(planId, "restart-pending");
			this.audit({
				ts: this.now(),
				action: "plan.done",
				planId,
				step: "restart-pending",
				outcome: "ok"
			});
			return cpOk({ state: "restart-pending" });
		} catch (error) {
			const code = error instanceof CpError ? error.code : CpErrorCode.internal;
			const rolledBack = backup ? this.rollbackFromBackup(backup) : true;
			this.states.set(planId, rolledBack ? "rolled-back" : "executing");
			this.audit({
				ts: this.now(),
				action: "plan.failed",
				planId,
				step: "rollback",
				outcome: rolledBack ? "rolled-back" : "error",
				errorCode: String(code)
			});
			if (backup && !rolledBack) return cpErr("rollback_failed", `execution failed (${String(code)}) and rollback could not be verified`);
			return toCpResult(error);
		}
	}
	/** Package name a remove command targets: explicit name, else repo, else id. */
	targetPackageName(entry) {
		if (entry.packageName) return entry.packageName;
		if (entry.repo) return entry.repo;
		return entry.id;
	}
	commandFor(plan) {
		if (plan.action === "uninstall") return buildRemoveCmd(plan.profile, this.targetPackageName(plan.entry));
		if (plan.entry.source === "github") return buildInstallCmd(plan.profile, plan.entry.owner, plan.entry.repo, plan.entry.pinnedCommit);
		return buildNpmAddCmd(plan.profile, plan.entry.packageName, plan.entry.version);
	}
	/** Restore each backed-up file to its original path and verify bytes. */
	rollbackFromBackup(backup) {
		for (const pair of backup.pairs) {
			const contents = this.fs.readFile(pair.backupPath);
			if (contents === null) return false;
			const expected = this.fs.hashFile(pair.backupPath);
			try {
				this.fs.writeFileAtomic(pair.originalPath, contents);
			} catch {
				return false;
			}
			if (!expected || this.fs.hashFile(pair.originalPath) !== expected) return false;
		}
		return true;
	}
	/**
	* Operator-facing restore: copy a backup directory (base-named profile
	* files) back into the profile, byte-verified per file.
	*/
	restoreBackupInto(profileDir, backupDir, backupName) {
		let names;
		try {
			names = readdirSync(backupDir).map((n) => n.toString());
		} catch {
			return cpErr("backup_failed", `backup ${backupName} is not readable`);
		}
		if (names.length === 0) return cpErr("backup_failed", `backup ${backupName} is empty`);
		const restored = [];
		for (const name of names) {
			if (!PROFILE_FILES.includes(name)) continue;
			const sourcePath = join(backupDir, name);
			const contents = this.fs.readFile(sourcePath);
			if (contents === null) return cpErr("backup_failed", `cannot read ${name} in backup`);
			const expected = this.fs.hashFile(sourcePath);
			try {
				this.fs.writeFileAtomic(join(profileDir, name), contents);
			} catch (error) {
				return cpErr("backup_failed", error instanceof Error ? error.message : String(error));
			}
			if (!expected || this.fs.hashFile(join(profileDir, name)) !== expected) return cpErr("hash_mismatch", `restored ${name} failed verification`);
			restored.push(name);
		}
		this.audit({
			ts: this.now(),
			action: "backup.restore",
			step: backupName,
			outcome: "ok",
			detail: { restored: restored.join(",") }
		});
		return cpOk({ restored });
	}
	snapshotProfile(profileDir) {
		const snapshots = [];
		for (const name of PROFILE_FILES) {
			const path = join(profileDir, name);
			snapshots.push({
				path,
				hash: this.fs.hashFile(path)
			});
		}
		return snapshots;
	}
	now() {
		return this.deps.ports.clock.now().toISOString();
	}
	audit(event) {
		const line = JSON.stringify(redactRecord({ ...event }));
		if (this.deps.auditSink) {
			this.deps.auditSink(line);
			return;
		}
		try {
			appendFileSync(join(this.deps.config.dataRoot, "audit-log.jsonl"), `${line}\n`, "utf8");
		} catch {}
	}
};
function baseNameOf(p) {
	const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	return idx === -1 ? p : p.slice(idx + 1);
}
function toCpResult(error) {
	if (error instanceof CpError) return cpErr(error.code, error.message);
	return cpErr("internal", error instanceof Error ? error.message : String(error));
}
//#endregion
//#region src/host/guardian.ts
/**
* Node self-guardian: a detached watchdog that keeps the DSH host reachable.
*
* Unlike OS-service guardians this needs no launchd/schtasks/systemd — it is
* an ordinary detached child process. It probes a fixed loopback address
* (hardcoded, never a configurable hostname), applies the shared bounded
* restart budget, and records its status under `<dataRoot>/guardian/`.
*/
function guardianDir(dataRoot) {
	return join(dataRoot, "guardian");
}
function statusPath(dataRoot) {
	return join(guardianDir(dataRoot), "status.json");
}
function pidPath(dataRoot) {
	return join(guardianDir(dataRoot), "pid.txt");
}
/** Resolve the built guardian entrypoint next to this module. */
function guardianEntryPath() {
	for (const candidate of ["../guardian-entry.js", "../../lib/guardian-entry.js"]) {
		const path = fileURLToPath(new URL(candidate, import.meta.url));
		if (existsSync(path)) return path;
	}
	throw new Error("guardian entry not found next to guardian.js");
}
/** Fixed two-argument invocation of the entry script (no shell involved). */
function watchdogArgs(entry, cfgFile) {
	return [
		entry,
		"--config",
		cfgFile
	];
}
function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
/** Spawn the detached watchdog; resolves with its pid. Idempotent per pidfile. */
async function startGuardian(config) {
	const dir = guardianDir(config.dataRoot);
	const pidFile = pidPath(config.dataRoot);
	if (existsSync(pidFile)) {
		const existing = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
		if (Number.isFinite(existing) && isAlive(existing)) return {
			ok: true,
			pid: existing,
			reason: "already-running"
		};
	}
	const cfgFile = join(dir, "config.json");
	const configBytes = JSON.stringify(config);
	writeFileSync(cfgFile, configBytes, "utf8");
	const digest = createHash("sha256").update(configBytes, "utf8").digest("hex");
	writeFileSync(`${cfgFile}.sha256`, digest, "utf8");
	return await import("node:child_process").then(({ spawn }) => {
		const child = spawn(process.execPath, watchdogArgs(guardianEntryPath(), cfgFile), {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			shell: false
		});
		child.unref();
		if (typeof child.pid !== "number") return {
			ok: false,
			reason: "watchdog-start-failed"
		};
		writeFileSync(pidFile, String(child.pid), "utf8");
		return {
			ok: true,
			pid: child.pid
		};
	}, () => ({
		ok: false,
		reason: "watchdog-unavailable"
	}));
}
/** Stop a running watchdog; safe when none is running. */
function stopGuardian(dataRoot) {
	const pidFile = pidPath(dataRoot);
	if (!existsSync(pidFile)) return { stopped: false };
	const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
	try {
		if (Number.isFinite(pid)) process.kill(pid);
	} catch {}
	try {
		unlinkSync(pidFile);
	} catch {}
	return { stopped: true };
}
//#endregion
//#region src/host/snapshot.ts
function digestOf(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
/**
* A remote snapshot is only trusted when it ships a matching
* `catalog.json.sha256` sidecar — an unsigned document must never be able to
* promote itself to `recommended` or relax scripts policy.
*/
async function fetchVerifiedRemote(http, remoteUrl) {
	const [body, expectedDigest] = await Promise.all([http.fetchText(remoteUrl), http.fetchText(`${remoteUrl}.sha256`).catch(() => ({
		ok: false,
		error: {
			code: "source_unreachable",
			message: "no sidecar"
		}
	}))]);
	if (!body.ok || !expectedDigest.ok) return cpErr("source_unreachable", "remote catalog unreachable");
	const declared = expectedDigest.data.match(/^[0-9a-f]{64}/)?.[0];
	if (declared === void 0 || declared !== digestOf(body.data)) return cpErr("untrusted_source", "remote catalog failed integrity verification");
	try {
		return cpOk(JSON.parse(body.data));
	} catch {
		return cpErr("source_unreachable", "remote catalog returned invalid JSON");
	}
}
function parseEntries(raw) {
	const entries = [];
	for (const item of raw) {
		const validated = validateCatalogEntry(item);
		if (!validated.ok) return validated;
		entries.push(validated.data);
	}
	return cpOk(entries);
}
function parseSnapshot(raw) {
	try {
		return cpOk(JSON.parse(raw));
	} catch {
		return cpErr("internal", "snapshot JSON is corrupted");
	}
}
function entriesOf(snapshot) {
	return parseEntries(Array.isArray(snapshot.entries) ? snapshot.entries : []);
}
/**
* Three-tier catalog loading with graceful degradation:
* verified remote success → fresh (cache rewritten); anything else falls back
* to the digest-checked local cache (`cached`), then the bundled seed.
*/
async function loadCatalog(input, ports) {
	if (input.remoteUrl) {
		const fetched = await fetchVerifiedRemote(ports.http, input.remoteUrl);
		if (fetched.ok) {
			const entries = entriesOf(fetched.data);
			if (!entries.ok) return entries;
			const fetchedAt = typeof fetched.data.fetchedAt === "string" ? fetched.data.fetchedAt : (/* @__PURE__ */ new Date()).toISOString();
			try {
				const serialized = JSON.stringify(fetched.data, null, 2);
				ports.fs.writeFileAtomic(input.cachePath, serialized);
				ports.fs.writeFileAtomic(`${input.cachePath}.sha256`, digestOf(serialized));
			} catch {}
			return cpOk({
				entries: entries.data,
				mode: "fresh",
				fetchedAt
			});
		}
	}
	const cachedRaw = ports.fs.readFile(input.cachePath);
	if (cachedRaw !== null) {
		const expected = ports.fs.readFile(`${input.cachePath}.sha256`);
		if (expected === null || digestOf(cachedRaw) !== expected.trim()) return loadSeedOnly(input.seedPath, ports.fs);
		const parsed = parseSnapshot(cachedRaw);
		if (!parsed.ok) return parsed;
		const entries = entriesOf(parsed.data);
		if (!entries.ok) return entries;
		return cpOk({
			entries: entries.data,
			mode: "cached",
			fetchedAt: typeof parsed.data.fetchedAt === "string" ? parsed.data.fetchedAt : void 0
		});
	}
	return loadSeedOnly(input.seedPath, ports.fs);
}
function loadSeedOnly(seedPath, fs) {
	const seedRaw = fs.readFile(seedPath);
	if (seedRaw === null) return cpErr("offline_degraded", "no catalog source available (offline, no cache, no seed)");
	const parsed = parseSnapshot(seedRaw);
	if (!parsed.ok) return parsed;
	const entries = entriesOf(parsed.data);
	if (!entries.ok) return entries;
	return cpOk({
		entries: entries.data,
		mode: "seed"
	});
}
//#endregion
//#region src/host/services.ts
const PLUGIN_NAME = "zdsh-plugin-center";
function resolveDataRoot(config) {
	if (!config?.dataRoot) return join(homedir(), ".zdsh-plugin-center");
	return isAbsolute(config.dataRoot) ? config.dataRoot : resolve(config.dataRoot);
}
/** Profile directory layout follows the host convention `$DSH_HOME/profiles/<name>`. */
function resolveProfileDir(config) {
	if (config.profileDir) return config.profileDir;
	const home = config.dshHome ?? process.env.DSH_BRANCH_HOME ?? process.env.DSH_HOME ?? defaultDshHome();
	return join(home, "profiles", config.defaultProfile);
}
function defaultDshHome() {
	const zdsh = join(homedir(), ".dsh-zdsh");
	if (existsSync(zdsh)) return zdsh;
	return join(homedir(), ".dsh");
}
function normalizeConfig(raw = {}) {
	const cfg = raw;
	return {
		defaultProfile: typeof cfg.defaultProfile === "string" && cfg.defaultProfile ? cfg.defaultProfile : "web",
		profileDir: typeof cfg.profileDir === "string" ? cfg.profileDir : void 0,
		dshHome: typeof cfg.dshHome === "string" ? cfg.dshHome : void 0,
		dataRoot: typeof cfg.dataRoot === "string" ? cfg.dataRoot : void 0,
		remoteCatalogUrl: cfg.remoteCatalogUrl === void 0 ? null : typeof cfg.remoteCatalogUrl === "string" ? cfg.remoteCatalogUrl : null,
		catalogSeedPath: typeof cfg.catalogSeedPath === "string" ? cfg.catalogSeedPath : void 0,
		webPort: typeof cfg.webPort === "number" && Number.isFinite(cfg.webPort) ? cfg.webPort : 3080,
		launchCommand: cfg.launchCommand && typeof cfg.launchCommand === "object" ? {
			cmd: String(cfg.launchCommand.cmd ?? "dsh"),
			args: Array.isArray(cfg.launchCommand.args) ? cfg.launchCommand.args.map(String) : ["web"]
		} : void 0,
		mutationsEnabled: cfg.mutationsEnabled !== false
	};
}
/** Locate the catalog seed shipped inside this package (src or built lib). */
function bundledSeedPath() {
	for (const candidate of ["../catalog/seed.json", "../../catalog/seed.json"]) {
		const path = fileURLToPath(new URL(candidate, import.meta.url));
		if (existsSync(path)) return path;
	}
	return join(process.cwd(), "catalog", "seed.json");
}
function createRuntimeIdentity() {
	return Object.freeze({
		schemaVersion: 1,
		pluginName: PLUGIN_NAME,
		bootId: randomUUID(),
		startedAt: (/* @__PURE__ */ new Date()).toISOString(),
		restartMode: "self-guardian"
	});
}
var PluginCenterServices = class {
	ports;
	catalogTtlMs;
	config;
	engine;
	identity = createRuntimeIdentity();
	catalogCache = null;
	constructor(configRaw, ports = nodePorts(), catalogTtlMs = 6e4, depsOverride) {
		this.ports = ports;
		this.catalogTtlMs = catalogTtlMs;
		this.config = normalizeConfig(configRaw);
		this.engine = new LifecycleEngine({
			ports,
			config: { dataRoot: resolveDataRoot(this.config) },
			...depsOverride ?? {}
		});
	}
	/** Stage a plan for a catalog entry; returns the plan id and its phrase. */
	async stagePlan(action, entryId) {
		const entry = await this.entryById(entryId);
		if (!entry.ok) return entry;
		const built = this.engine.buildPlan(entry.data, action, this.profileDir);
		if (!built.ok) return built;
		return cpOk({
			planId: built.data.plan.planId,
			phrase: built.data.phrase
		});
	}
	/** Confirm with the exact phrase, then carry the plan through. */
	async confirmAndRun(planId, phrase) {
		const confirmed = this.engine.confirmPlan(planId, phrase);
		if (!confirmed.ok) return confirmed;
		return this.engine.applyPlan(planId);
	}
	/** Last known watchdog state from disk; idle when never started. */
	guardianStatus() {
		const port = this.config.webPort ?? 3080;
		try {
			const parsed = JSON.parse(readFileSync(statusPath(resolveDataRoot(this.config)), "utf8"));
			return {
				running: parsed.state !== "give-up",
				state: parsed.state,
				port,
				checkedAtMs: parsed.checkedAtMs,
				restartsUsed: parsed.restartsUsed
			};
		} catch {
			return {
				running: false,
				state: "idle",
				port
			};
		}
	}
	/** Start or stop the detached watchdog. */
	async guardianToggle(action) {
		if (action === "stop") return cpOk({
			ok: true,
			reason: stopGuardian(resolveDataRoot(this.config)).stopped ? "stopped" : "not-running"
		});
		return cpOk(await startGuardian({
			dataRoot: resolveDataRoot(this.config),
			port: this.config.webPort ?? 3080,
			launch: this.config.launchCommand ?? {
				cmd: "dsh",
				args: ["web"]
			}
		}));
	}
	/** Backup snapshots under the data root, newest first. */
	backupsList() {
		const dir = join(resolveDataRoot(this.config), "backups");
		let names;
		try {
			names = readdirSync(dir).map((n) => n.toString());
		} catch {
			return [];
		}
		const rows = [];
		for (const name of names) try {
			rows.push({
				name,
				createdAtMs: Number.parseInt(name.split("-")[0] ?? "0", 10) || 0
			});
		} catch {}
		return rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
	}
	/** Restore a named backup into the profile with per-file verification. */
	restoreBackup(name) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return cpErr("backup_failed", "malformed backup name");
		const root = resolve(join(resolveDataRoot(this.config), "backups"));
		const target = resolve(join(root, name));
		if (!isAbsolute(target) || !target.startsWith(root + sep) || target === root) return cpErr("backup_failed", "backup path escaped the data root");
		return this.engine.restoreBackupInto(this.profileDir, target, name);
	}
	get runtime() {
		return this.identity;
	}
	get profileDir() {
		return resolveProfileDir(this.config);
	}
	catalog(forceRefresh = false) {
		const now = Date.now();
		if (!forceRefresh && this.catalogCache && now - this.catalogCache.atMs < this.catalogTtlMs) return this.catalogCache.value;
		const value = loadCatalog({
			seedPath: this.config.catalogSeedPath ?? bundledSeedPath(),
			cachePath: join(resolveDataRoot(this.config), "cache", "catalog.json"),
			remoteUrl: this.config.remoteCatalogUrl ?? void 0
		}, this.ports);
		this.catalogCache = {
			atMs: now,
			value
		};
		return value;
	}
	/** Bounded, sorted, filtered market page. */
	async marketPage(params) {
		const loaded = await this.catalog(params.forceRefresh ?? false);
		if (!loaded.ok) return loaded;
		return cpOk({
			...paginate(sortEntries(searchEntries(loaded.data.entries, {
				text: params.q,
				category: params.category,
				evidenceOnlyRecommended: params.onlyRecommended
			})), params.page ?? 1, Math.min(Math.max(params.pageSize ?? 24, 1), 48)),
			mode: loaded.data.mode,
			fetchedAt: loaded.data.fetchedAt
		});
	}
	async entryById(entryId) {
		const loaded = await this.catalog();
		if (!loaded.ok) return loaded;
		const found = loaded.data.entries.find((entry) => entry.id === entryId);
		if (!found) return {
			ok: false,
			error: {
				code: "invalid_plan",
				message: `unknown entry ${entryId}`
			}
		};
		return cpOk(found);
	}
};
//#endregion
//#region src/host/api.ts
/**
* Framework-free HTTP surface for the plugin center.
*
* The router is pure: it maps (method, path, headers, body) to JSON responses
* so the whole API is testable without a socket. `attachRoutes` adapts it to
* the DSH host webserver's plugin route registration contract at runtime.
*/
const API_PREFIX = ["/api2", PLUGIN_NAME].join("/");
const ROUTES = {
	market: [API_PREFIX, "market"].join("/"),
	entry: [API_PREFIX, "entry"].join("/"),
	stagePlan: [API_PREFIX, "plan/stage"].join("/"),
	applyPlan: [API_PREFIX, "plan/apply"].join("/"),
	audit: [API_PREFIX, "audit"].join("/"),
	runtime: [API_PREFIX, "runtime"].join("/"),
	guardianStatus: [API_PREFIX, "guardian/status"].join("/"),
	guardianToggle: [API_PREFIX, "guardian/toggle"].join("/"),
	backups: [API_PREFIX, "backups"].join("/"),
	backupRestore: [API_PREFIX, "backups/restore"].join("/"),
	restartRequest: [API_PREFIX, "restart/request"].join("/")
};
const WRITE_PATHS = /* @__PURE__ */ new Set([
	ROUTES.stagePlan,
	ROUTES.applyPlan,
	ROUTES.guardianToggle,
	ROUTES.backupRestore,
	ROUTES.restartRequest
]);
const INTENT_HEADER = "x-zdsh-pc-intent";
function json(status, payload) {
	return {
		status,
		payload: payload === void 0 ? null : payload
	};
}
function fromCp(result) {
	if (result.ok) return json(200, result.data);
	return json(statusFor(result.error?.code ?? "internal"), { error: result.error });
}
function statusFor(code) {
	switch (code) {
		case "invalid_plan":
		case "confirmation_mismatch": return 400;
		case "plan_consumed":
		case "plan_not_found": return 409;
		case "script_blocked":
		case "untrusted_source": return 422;
		case "source_unreachable":
		case "offline_degraded": return 503;
		default: return 500;
	}
}
function sameOriginOk(headers) {
	const host = headers.host;
	if (!host) return false;
	const origin = headers.origin;
	if (!origin) return true;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
function matches(request, method, path) {
	return request.method === method && request.path === path;
}
/** Handle one API request. Never throws — every outcome is a JSON response. */
async function handleApiRequest(services, request) {
	if (!Object.values(ROUTES).includes(request.path)) return json(404, { error: {
		code: "not_found",
		message: "unknown path"
	} });
	if (!sameOriginOk(request.headers ?? {})) return json(403, { error: {
		code: "cross_origin_denied",
		message: "cross-origin denied"
	} });
	if (WRITE_PATHS.has(request.path)) {
		if (!services.config.mutationsEnabled) return json(403, { error: {
			code: "mutations_disabled",
			message: "read-only mode"
		} });
		if (request.method !== "POST") return json(405, { error: {
			code: "method_not_allowed",
			message: "writes require POST"
		} });
		if (request.headers?.["x-zdsh-pc-intent"] !== "zdsh-plugin-center") return json(403, { error: {
			code: "intent_missing",
			message: "missing intent header"
		} });
	}
	if (matches(request, "GET", ROUTES.market)) {
		const q = request.query ?? {};
		return fromCp(await services.marketPage({
			page: toInt(q.page),
			pageSize: toInt(q.pageSize),
			q: q.q,
			category: q.category,
			onlyRecommended: q.onlyRecommended === "1",
			forceRefresh: q.refresh === "1"
		}));
	}
	if (matches(request, "GET", ROUTES.entry)) return fromCp(await services.entryById(request.query?.id ?? ""));
	if (matches(request, "GET", ROUTES.runtime)) return json(200, services.runtime);
	if (matches(request, "GET", ROUTES.guardianStatus)) return json(200, services.guardianStatus());
	if (matches(request, "GET", ROUTES.backups)) return json(200, services.backupsList());
	if (matches(request, "POST", ROUTES.guardianToggle)) {
		const body = request.body ?? {};
		if (body.action !== "start" && body.action !== "stop") return json(400, { error: {
			code: "invalid_plan",
			message: "action must be start|stop"
		} });
		return fromCp(await services.guardianToggle(body.action));
	}
	if (matches(request, "POST", ROUTES.backupRestore)) {
		const body = request.body ?? {};
		if (!body.name) return json(400, { error: {
			code: "invalid_plan",
			message: "name is required"
		} });
		return fromCp(services.restoreBackup(body.name));
	}
	if (matches(request, "GET", ROUTES.audit)) return json(200, await readAuditTail(resolveDataRoot(services.config)));
	if (matches(request, "POST", ROUTES.stagePlan)) {
		const body = request.body ?? {};
		if (!isPlanAction(body.action)) return json(400, { error: {
			code: "invalid_plan",
			message: "action must be install|update|uninstall"
		} });
		if (!body.entryId) return json(400, { error: {
			code: "invalid_plan",
			message: "entryId is required"
		} });
		return fromCp(await services.stagePlan(body.action, body.entryId));
	}
	if (matches(request, "POST", ROUTES.applyPlan)) {
		const body = request.body ?? {};
		if (!body.planId || !body.phrase) return json(400, { error: {
			code: "invalid_plan",
			message: "planId and phrase are required"
		} });
		return fromCp(await services.confirmAndRun(body.planId, body.phrase));
	}
	if (matches(request, "POST", ROUTES.restartRequest)) return json(501, { error: {
		code: "not_implemented",
		message: "guardian wiring lands later in M2"
	} });
	return json(404, { error: {
		code: "not_found",
		message: "no handler for this route"
	} });
}
function isPlanAction(value) {
	return value === "install" || value === "update" || value === "uninstall";
}
function toInt(raw) {
	if (raw === void 0 || raw === "") return void 0;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : void 0;
}
async function readAuditTail(dataRoot, maxLines = 200) {
	let raw;
	try {
		raw = await readFile(join(dataRoot, "audit-log.jsonl"), "utf8");
	} catch {
		return [];
	}
	const lines = raw.split("\n").filter((line) => line.trim() !== "");
	const parsed = [];
	for (const line of lines.slice(-maxLines)) try {
		parsed.push(JSON.parse(line));
	} catch {
		parsed.push({ parseError: true });
	}
	return parsed;
}
//#endregion
//#region src/host/plugin.ts
const MAX_BODY_BYTES = 65536;
const name = PLUGIN_NAME;
const inject = [];
function header(req, key) {
	const value = req.headers[key];
	return Array.isArray(value) ? value[0] : value;
}
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.length;
		if (size > MAX_BODY_BYTES) return void 0;
		chunks.push(buf);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
function send(res, response) {
	res.writeHead(response.status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(response.payload));
}
/** Adapt one raw node request into a router request and answer it. */
async function serveRequest(services, req, res) {
	const url = new URL(req.url ?? "/", "http://internal.invalid");
	const query = {};
	url.searchParams.forEach((value, key) => {
		query[key] = value;
	});
	const method = req.method === "POST" ? "POST" : "GET";
	const needsBody = method === "POST";
	const body = needsBody ? await readJsonBody(req) : void 0;
	if (needsBody && body === void 0) {
		send(res, {
			status: 400,
			payload: { error: {
				code: "invalid_plan",
				message: "invalid JSON body"
			} }
		});
		return;
	}
	const request = {
		method,
		path: url.pathname,
		query,
		headers: {
			host: header(req, "host"),
			origin: header(req, "origin"),
			[INTENT_HEADER]: header(req, INTENT_HEADER)
		},
		body
	};
	try {
		send(res, await handleApiRequest(services, request));
	} catch (error) {
		send(res, {
			status: 500,
			payload: { error: {
				code: "internal",
				message: error instanceof Error ? error.message : String(error)
			} }
		});
	}
}
/** Cordis apply: wire the plugin center onto a running host. */
function apply(ctx, config = {}) {
	const services = new PluginCenterServices(config);
	ctx.inject(["webServer"], (webCtx) => {
		const disposers = Object.values(ROUTES).map((path) => webCtx.webServer.register({
			kind: "exact",
			path,
			handler: (req, res) => serveRequest(services, req, res)
		}));
		webCtx.effect?.(() => {
			for (const dispose of disposers.reverse()) dispose();
		}, `${PLUGIN_NAME}: routes`);
		webCtx.logger?.info?.(`${PLUGIN_NAME}: market and lifecycle surface ready`);
	});
}
//#endregion
//#region src/host/restart-budget.ts
/**
* Bounded-restart accounting shared by the guardian entry and the runtime
* surface: at most `max` restarts inside any `windowMs`, then the circuit
* stays open (give-up) until an operator intervenes.
*/
var RestartBudget = class {
	windowMs;
	max;
	attempts = [];
	constructor(windowMs = 3e5, max = 3) {
		this.windowMs = windowMs;
		this.max = max;
	}
	/** Would another restart right now still be within budget? */
	canRestart(nowMs) {
		this.prune(nowMs);
		return this.attempts.length < this.max;
	}
	record(nowMs) {
		this.prune(nowMs);
		this.attempts.push(nowMs);
	}
	/** Number of restarts already spent in the current window. */
	used(nowMs) {
		this.prune(nowMs);
		return this.attempts.length;
	}
	reset() {
		this.attempts = [];
	}
	prune(nowMs) {
		const cutoff = nowMs - this.windowMs;
		this.attempts = this.attempts.filter((t) => t >= cutoff);
	}
};
/** Pure decision step used by the guardian loop on every probe tick. */
function decideAction(input) {
	if (input.verdict.kind === "healthy") return "none";
	return input.budget.canRestart(input.nowMs) ? "restart" : "give-up";
}
//#endregion
//#region src/host/index.ts
/**
* zdsh-plugin-center — host-side public surface and Cordis entry.
*
* v1 ships as a standalone plugin: the default export is the Cordis plugin
* (name/inject/apply). Domain building blocks are re-exported for reuse and
* for the future branch-integrated form.
*/
var host_default = apply;
//#endregion
export { API_PREFIX, CpError, CpErrorCode, INTENT_HEADER, LifecycleEngine, PLUGIN_NAME, PROFILE_FILES, PlanStore, PluginCenterServices, ROUTES, RestartBudget, apply, apply as cordisApply, assertSafeUrl, buildInstallCmd, buildNpmAddCmd, buildRemoveCmd, bundledSeedPath, confirmationPhrase, name as cordisName, name, cpErr, cpOk, createPlan, createRuntimeIdentity, decideAction, host_default as default, detectLifecycleScripts, guardianDir, handleApiRequest, inject, isHostAllowed, isInsideRoot, isSensitiveValue, isValidCommit, loadCatalog, nodePorts, normalizeConfig, normalizePluginId, paginate, pidPath, redactRecord, redactValue, resolveDataRoot, resolveProfileDir, safeFetch, searchEntries, serveRequest, sortEntries, startGuardian, statusPath, stopGuardian, toCpResult, validateCatalogEntry };

//# sourceMappingURL=index.js.map