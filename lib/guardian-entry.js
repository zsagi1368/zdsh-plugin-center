import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve, sep, win32 } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
//#region src/shared/resolve-executable.ts
/**
* Executable resolution and spawn-carrier planning (TC-B4-PC1 F1, ruling 1b).
*
* zdsh-security-patterns ⑦: spawn must never take a bare command name. A
* bare name goes through cmd.exe/PATH search order on Windows (CWD before
* PATH), so a `dsh.cmd` planted in an untrusted working directory wins over
* the real CLI — the SECURITY-B4-D1a F1 [阻断] trigger chain. Every spawn in
* this package therefore:
*
* 1. resolves the command to an ABSOLUTE path — on win32 the probe is the
*    ABSOLUTE `%SystemRoot%\System32\where.exe` (TC-B4-PC2 / D1b FB1
*    hardening: the probe executable itself must never re-enter a bare-name
*    search — win32 CreateProcess searches the application directory and the
*    parent CWD before System32) with the probe cwd additionally pinned to
*    SystemRoot as belt-and-braces (so the host's cwd can never shadow the
*    target lookup); on POSIX the probe is the ABSOLUTE `/usr/bin/which`-
*    family candidate. A failed resolution is a hard error (fail-closed:
*    never falls back to the bare name);
* 2. plans the spawn carrier: a real executable spawns directly with
*    `shell:false`; a win32 `.cmd`/`.bat` shim (the npm-family CLI form —
*    spawning a `.cmd` bare with `shell:false` is EINVAL since the
*    CVE-2024-27980 hardening, and refusing shims outright would break every
*    install/uninstall on Windows) runs through an ABSOLUTE-path
*    `cmd.exe /d /s /c "<abs shim>" …` with `windowsVerbatimArguments`.
*    Both branches keep the spawn options at `shell:false` and the spawned
*    file absolute, so no bare-name search happens anywhere.
*
* Resolution is deliberately NOT cached (ruling-approved): installs and
* watchdog relaunches are human-rate operations, a fresh lookup per call has
* no stale-PATH surface, and fail-closed stays the simplest path.
*
* Pattern source (form only — cross-repo code import is forbidden): zDSH-main
* `packages/client/workbench/src/git-runner.ts` `defaultBinaryResolver`
* (where.exe probe + SystemRoot-pinned cwd + absolute-or-null fail-closed)
* and `pty-registry.ts` `resolveShell` (ComSpec must be win32-absolute,
* bare/relative values are refused, SystemRoot fallback). TC-B4-PC2 goes one
* step beyond the pattern form: the probe executables themselves are
* absolute-or-fail-closed as well (D1b FB1 defense-in-depth), so no spawn in
* this module — targets, carriers OR probes — ever takes a bare name.
*/
/**
* Argument allowlist for spawned commands: catalog-controlled values flow
* into these argv slots, so anything outside this set is refused before a
* process is created. Deliberately excludes quotes, ampersands, pipes,
* redirects, carets, percent (cmd env expansion) and bangs (delayed
* expansion). Space stays allowed because profile directories legitimately
* contain spaces — the data layer below independently pins owner/repo/version
* to a much stricter charset.
*
* This allowlist is also the safety premise of the win32 verbatim-argument
* carrier below (quoteForCmd): every cmd.exe metacharacter is excluded, so
* whitespace wrapping is the only quoting a token can need. The coverage is
* locked by tests/host/spawn-carrier.spec.ts (metachar-set assertion) to
* prevent future charset drift from silently invalidating that premise.
*/
const SAFE_ARG = /^[A-Za-z0-9_@+=.,:\\/#\- ]+$/;
function assertSafeArgs(args) {
	for (const arg of args) if (!SAFE_ARG.test(arg)) throw new Error(`refusing unsafe command argument: ${JSON.stringify(arg.slice(0, 40))}`);
}
function isWin32() {
	return process.platform === "win32";
}
function isAbsolutePlatform(p) {
	return isWin32() ? win32.isAbsolute(p) : posix.isAbsolute(p);
}
/** win32 executable forms worth resolving, best carrier first. */
const WIN_EXECUTABLE_EXTENSIONS = [
	".exe",
	".cmd",
	".bat",
	".com"
];
function firstNonEmptyLine(stdout) {
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed !== "") return trimmed;
	}
	return null;
}
/**
* The absolute where.exe probe executable for win32 (TC-B4-PC2, D1b FB1
* hardening). The probe itself must never be a bare name: win32 CreateProcess
* searches the application directory and the parent CWD BEFORE System32, so a
* `where.exe` planted in the host's cwd could win over the real probe — the
* registered (mechanism-disproved but defense-in-depth-closed) FB1 residue.
* Mirrors comSpecAbsolute's chain form: %SystemRoot%\System32\where.exe →
* %WINDIR% same shape → the fixed Windows default — each existence-checked,
* fail-closed otherwise (never a bare-name probe).
*/
function whereExeAbsolute() {
	for (const root of [process.env.SystemRoot, process.env.WINDIR]) if (root !== void 0 && root !== "" && win32.isAbsolute(root)) {
		const candidate = join(root, "System32", "where.exe");
		if (existsSync(candidate)) return candidate;
	}
	const lastResort = "C:\\Windows\\System32\\where.exe";
	if (existsSync(lastResort)) return lastResort;
	throw new Error("command resolution failed: no absolute where.exe probe available (SystemRoot/WINDIR unset, relative, or without System32\\where.exe, and the fixed C:\\Windows\\System32\\where.exe is missing) — refusing to resolve through a bare probe name (fail-closed)");
}
/** Common install locations of the POSIX `which` utility, best first. */
const POSIX_WHICH_CANDIDATES = [
	"/usr/bin/which",
	"/bin/which",
	"/usr/local/bin/which"
];
/**
* The absolute `which` probe executable for POSIX (TC-B4-PC2, D1b FB1
* hardening — symmetric leg). execvp does not search the parent CWD (unless
* PATH contains '.'), so the bare `which` probe was never practically
* plantable; this is the defense-in-depth half of the same ruling: identical
* absolute-or-fail-closed shape as the win32 probe, leaving zero search-order
* reasoning anywhere in this module. Candidates are probed in order and
* existence-checked; all missing → fail-closed (never a bare-name probe).
*/
function whichAbsolute() {
	for (const candidate of POSIX_WHICH_CANDIDATES) if (existsSync(candidate)) return candidate;
	throw new Error(`command resolution failed: no absolute which probe available (${POSIX_WHICH_CANDIDATES.join(", ")} all missing) — refusing to resolve through a bare probe name (fail-closed)`);
}
/**
* Resolve a command name to an absolute, existing, platform-executable path.
* Bare names go through the platform probe — itself an ABSOLUTE, existence-
* checked executable (whereExeAbsolute/whichAbsolute above; the probe cwd
* stays pinned to SystemRoot on win32 as belt-and-braces); absolute paths are
* validated in place; anything else (empty, relative, unresolvable, non-
* executable form, missing probe) throws with guidance — fail-closed, never
* a bare-name fallback.
*/
async function resolveExecutablePath(name) {
	const trimmed = name.trim();
	if (trimmed === "") throw new Error("command resolution failed: empty command name is refused (fail-closed)");
	if (isAbsolutePlatform(trimmed)) {
		if (!existsSync(trimmed)) throw new Error(`command resolution failed: configured absolute command path does not exist: ${trimmed} (fail-closed, no bare-name fallback)`);
		if (isWin32()) {
			const ext = win32.extname(trimmed).toLowerCase();
			if (!WIN_EXECUTABLE_EXTENSIONS.includes(ext)) throw new Error(`command resolution failed: ${trimmed} is not a win32 executable form (.exe/.cmd/.bat/.com) — an extensionless file is not executable on Windows (fail-closed)`);
		} else try {
			accessSync(trimmed, constants.X_OK);
		} catch {
			throw new Error(`command resolution failed: configured command is not executable (X_OK refused): ${trimmed} (fail-closed)`);
		}
		return trimmed;
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`command resolution failed: relative command paths are refused: ${JSON.stringify(trimmed)} (fail-closed — only bare names resolved through PATH or validated absolute paths may spawn)`);
	const { spawnSync } = await import("node:child_process");
	if (isWin32()) {
		const probeExe = whereExeAbsolute();
		let result;
		try {
			result = spawnSync(probeExe, [trimmed], {
				encoding: "utf8",
				cwd: process.env.SystemRoot ?? process.env.WINDIR ?? void 0,
				windowsHide: true
			});
		} catch (error) {
			throw new Error(`command resolution failed for "${trimmed}": where.exe probe threw (${error instanceof Error ? error.message : String(error)}) — refusing to fall back to the bare name`);
		}
		if (result.error !== void 0) throw new Error(`command resolution failed for "${trimmed}": where.exe unavailable (${result.error.message}) — refusing to fall back to the bare name`);
		if (result.status !== 0) throw new Error(`command resolution failed for "${trimmed}": where.exe exited ${String(result.status)} (name not found on PATH) — refusing to fall back to the bare name; install the dsh CLI or set launchCommand to an absolute path`);
		let best = null;
		for (const line of result.stdout.split(/\r?\n/)) {
			const candidate = line.trim();
			if (candidate === "" || !win32.isAbsolute(candidate)) continue;
			const rank = WIN_EXECUTABLE_EXTENSIONS.indexOf(win32.extname(candidate).toLowerCase());
			if (rank < 0) continue;
			if (best === null || rank < best.rank) best = {
				path: candidate,
				rank
			};
		}
		if (best === null || !existsSync(best.path)) throw new Error(`command resolution failed for "${trimmed}": where.exe returned no absolute executable candidate (bare/extensionless echoes are lookup misses) — refusing to fall back to the bare name`);
		return best.path;
	}
	let result;
	const probeExe = whichAbsolute();
	try {
		result = spawnSync(probeExe, [trimmed], {
			encoding: "utf8",
			windowsHide: true
		});
	} catch (error) {
		throw new Error(`command resolution failed for "${trimmed}": which probe threw (${error instanceof Error ? error.message : String(error)}) — refusing to fall back to the bare name`);
	}
	if (result.error !== void 0) throw new Error(`command resolution failed for "${trimmed}": which unavailable (${result.error.message}) — refusing to fall back to the bare name`);
	if (result.status !== 0) throw new Error(`command resolution failed for "${trimmed}": which exited ${String(result.status)} (name not found on PATH) — refusing to fall back to the bare name; install the dsh CLI or set launchCommand to an absolute path`);
	const resolved = firstNonEmptyLine(result.stdout);
	if (resolved === null || !posix.isAbsolute(resolved) || !existsSync(resolved)) throw new Error(`command resolution failed for "${trimmed}": which returned no usable absolute path — refusing to fall back to the bare name`);
	return resolved;
}
/**
* The absolute cmd.exe interpreter for win32 `.cmd`/`.bat` carriers.
* ComSpec must be an absolute, existing path (pty-registry family judgment);
* a bare/relative ComSpec would re-enter the very CWD-first search this
* module exists to eliminate. Fallback: %SystemRoot%\System32\cmd.exe, then
* the fixed Windows default — each existence-checked, fail-closed otherwise.
*/
function comSpecAbsolute() {
	const comspec = process.env.ComSpec?.trim();
	if (comspec !== void 0 && comspec !== "" && win32.isAbsolute(comspec) && existsSync(comspec)) return comspec;
	for (const root of [process.env.SystemRoot, process.env.WINDIR]) if (root !== void 0 && root !== "" && win32.isAbsolute(root)) {
		const candidate = join(root, "System32", "cmd.exe");
		if (existsSync(candidate)) return candidate;
	}
	const lastResort = "C:\\Windows\\System32\\cmd.exe";
	if (existsSync(lastResort)) return lastResort;
	throw new Error("command resolution failed: no absolute cmd.exe interpreter available (ComSpec unset/relative/missing and SystemRoot probes failed) — refusing to run a .cmd carrier through a bare interpreter name");
}
/**
* Quote one token for the verbatim `/d /s /c "<command line>"` carrier.
* SAFE_ARG has already refused quotes and every cmd.exe metacharacter, so
* whitespace wrapping is the only quoting a token can need (same shape as
* Node's own shell:true argument quoter).
*/
function quoteForCmd(token) {
	return token === "" || /[\t ]/.test(token) ? `"${token}"` : token;
}
function assertPlanInvariants(plan) {
	if (plan.options.shell !== false) throw new Error("internal invariant violated: spawn plan must carry shell:false");
	if (!isAbsolutePlatform(plan.file) || isWin32() && !win32.isAbsolute(plan.file)) throw new Error(`internal invariant violated: spawn file must be absolute, got ${plan.file}`);
	return plan;
}
/**
* Plan the shell-free spawn for an already-resolved absolute executable.
* Real executables spawn directly; win32 `.cmd`/`.bat` shims go through the
* absolute cmd.exe carrier (ruling 1b). Arguments pass the SAFE_ARG gate
* here as well — the verbatim carrier embeds them in a cmd.exe command line,
* so the metacharacter exclusion is a hard precondition, not a convention.
*/
function planSpawnInvocation(absFile, args) {
	assertSafeArgs([absFile, ...args]);
	if (!isAbsolutePlatform(absFile)) throw new Error(`command resolution failed: spawn file must be an absolute path, got ${JSON.stringify(absFile)} (fail-closed)`);
	if (isWin32() && /\.(cmd|bat)$/i.test(absFile)) return assertPlanInvariants({
		file: comSpecAbsolute(),
		args: [
			"/d",
			"/s",
			"/c",
			`"${[absFile, ...args].map(quoteForCmd).join(" ")}"`
		],
		options: {
			shell: false,
			windowsHide: true,
			windowsVerbatimArguments: true
		}
	});
	return assertPlanInvariants({
		file: absFile,
		args: [...args],
		options: {
			shell: false,
			windowsHide: true
		}
	});
}
/**
* One-call form used by every spawn site in this package: resolve the name
* (fail-closed) and plan the shell-free carrier. Never spawns a bare name,
* never sets shell:true, never falls back on resolution failure.
*/
async function planCommand(name, args) {
	return planSpawnInvocation(await resolveExecutablePath(name), args);
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
/**
* Load the watchdog config and verify its sha256 sidecar. A config that was
* tampered with after startGuardian wrote it is refused outright, so write
* access to the data root alone cannot plant a relaunch command.
*/
async function loadConfig(rawPath) {
	const cfgPath = validatedConfigPath(rawPath);
	const [text, expectedDigest] = await Promise.all([readFile(cfgPath, "utf8"), readFile(`${cfgPath}.sha256`, "utf8").catch(() => null)]);
	if (expectedDigest === null) throw new Error("watchdog config is missing its integrity sidecar");
	if (createHash("sha256").update(text, "utf8").digest("hex") !== expectedDigest.trim()) throw new Error("watchdog config failed integrity verification");
	return JSON.parse(text);
}
/** Probe the local web host; any HTTP response under 500 counts as alive. */
async function probeLoopback(port, timeoutMs = 2500) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, timeoutMs);
		try {
			return (await fetch(`http://${LOOPBACK_HOST}:${String(port)}/`, { signal: controller.signal })).status < 500;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return false;
	}
}
/**
* Boot the host command again as its own detached process.
*
* F1 (SECURITY-B4-D1a, ruling 1b): never a bare name, never a shell — the
* launch command goes through the same absolute-path resolver + carrier
* planner as every other spawn in this package. A failed resolution throws
* with guidance (fail-closed): the watchdog exits loudly through
* autoRunOnImport's catch instead of spawning whatever shadows the name.
* launchCommand config semantics (ruling condition 4): a user-configured
* absolute path is validated in place, a bare name is resolved through
* where.exe/which, a relative path is refused.
*/
async function relaunchHost(launch) {
	const [{ spawn }, invocation] = await Promise.all([import("node:child_process"), planCommand(launch.cmd, launch.args)]);
	const child = spawn(invocation.file, invocation.args, {
		...invocation.options,
		detached: true,
		stdio: "ignore"
	});
	child.unref();
	return typeof child.pid === "number" ? child.pid : null;
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
	const watchdog = new Watchdog(config, (status) => {
		writeFileSync(statusFile, JSON.stringify(status), "utf8");
	});
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

//# sourceMappingURL=guardian-entry.js.map