import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
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
//#region src/host/guardian-entry.ts
/**
* Watchdog entrypoint (`node lib/guardian-entry.js --config <file>`).
*
* Runs detached from the DSH host. Every tick it probes a hardcoded loopback
* address on the configured port; sustained failure triggers a bounded
* relaunch of the host command. Status is mirrored to disk each tick so the
* plugin surface can report what the watchdog sees.
*/
const LOOPBACK_HOST = "127.0.0.1";
function argAfter(argv, flag) {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] ?? null : null;
}
function sleep(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
/**
* Contained path helper: watchdog artifacts must resolve strictly inside the
* data root. After normalization any escaping candidate loses the root
* prefix, so a strict prefix comparison suffices on drive-letter and POSIX
* layouts alike.
*/
function containedUnderRoot(dataRoot, ...segments) {
	const root = resolve(dataRoot);
	const file = resolve(join(root, ...segments));
	if (!(isAbsolute(file) && file.startsWith(root + sep) && file !== root)) throw new Error("watchdog path escaped the data root");
	return file;
}
function statusFileFor(dataRoot) {
	return containedUnderRoot(dataRoot, "guardian", "status.json");
}
/** Validate the operator-supplied config path before any IO touches it. */
function validatedConfigPath(raw) {
	const resolved = resolve(raw);
	const parentDir = resolve(resolved, sep);
	if (!(isAbsolute(resolved) && resolved !== parentDir && existsSync(resolved))) throw new Error("--config must point to an existing absolute file");
	return resolved;
}
async function loadConfig(rawPath) {
	const cfgPath = validatedConfigPath(rawPath);
	const text = await readFile(cfgPath, "utf8");
	return JSON.parse(text);
}
/** Probe the local web host; any HTTP response under 500 counts as alive. */
async function probeLoopback(port, timeoutMs = 2500) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return (await fetch(`http://${LOOPBACK_HOST}:${String(port)}/`, { signal: controller.signal })).status < 500;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return false;
	}
}
/** Boot the host command again as its own detached process (no shell). */
async function relaunchHost(launch) {
	return import("node:child_process").then(({ spawn }) => {
		const child = spawn(launch.cmd, launch.args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			shell: false
		});
		child.unref();
		return typeof child.pid === "number" ? child.pid : null;
	}, () => null);
}
var Watchdog = class {
	config;
	persist;
	budget = new RestartBudget();
	bootId = randomUUID();
	healthyTicks = 0;
	startedAtMs = Date.now();
	constructor(config, persist) {
		this.config = config;
		this.persist = persist;
	}
	base() {
		return {
			bootId: this.bootId,
			startedAtMs: this.startedAtMs,
			checkedAtMs: Date.now(),
			healthyTicks: this.healthyTicks,
			restartsUsed: this.budget.used(Date.now())
		};
	}
	async tick(nowMs) {
		if (await probeLoopback(this.config.port)) {
			this.healthyTicks += 1;
			const state = this.healthyTicks >= 3 ? "healthy" : "probing";
			this.persist({
				...this.base(),
				state
			});
			return state;
		}
		this.healthyTicks = 0;
		if (decideAction({
			verdict: { kind: "unhealthy" },
			budget: this.budget,
			nowMs
		}) === "give-up") {
			this.persist({
				...this.base(),
				state: "give-up"
			});
			return "exit";
		}
		this.budget.record(nowMs);
		this.persist({
			...this.base(),
			state: "restarting"
		});
		await relaunchHost(this.config.launch);
		await sleep(15e3);
		return "restarting";
	}
};
async function runWatchdog(config) {
	mkdirSync(containedUnderRoot(config.dataRoot, "guardian"), { recursive: true });
	const statusFile = statusFileFor(config.dataRoot);
	const watchdog = new Watchdog(config, (status) => writeFileSync(statusFile, JSON.stringify(status), "utf8"));
	for (;;) {
		if (await watchdog.tick(Date.now()) === "exit") break;
		await sleep(config.intervalMs ?? 3e3);
	}
}
function autoRunOnImport(argv, isDirect) {
	if (!isDirect) return;
	const rawCfg = argAfter(argv, "--config");
	if (!rawCfg) {
		console.error("watchdog requires --config <file>");
		process.exit(2);
	}
	loadConfig(rawCfg).then(runWatchdog).catch((error) => {
		console.error("watchdog failed to start:", error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
//#endregion
export { Watchdog, autoRunOnImport, containedUnderRoot, probeLoopback, relaunchHost, runWatchdog, validatedConfigPath };

//# sourceMappingURL=guardian-entry.mjs.map