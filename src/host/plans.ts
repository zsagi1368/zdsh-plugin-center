import { createHash } from 'node:crypto';
import type { CatalogEntry } from '../shared/catalog.js';
import { isValidCommit } from '../shared/catalog.js';
import { CpErrorCode, type PlanState } from '../shared/types.js';

export type PlanAction = 'install' | 'uninstall' | 'update';

export interface InstallPlan {
  planId: string;
  action: PlanAction;
  profile: string;
  entry: CatalogEntry;
  phraseSha8: string;
  createdAt: string;
}

export class CpError extends Error {
  constructor(
    public readonly code: CpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CpError';
  }
}

function hashPlan(plan: Omit<InstallPlan, 'planId' | 'phraseSha8' | 'createdAt'>): string {
  const canonical = JSON.stringify({
    action: plan.action,
    profile: plan.profile,
    id: plan.entry.id,
    source: plan.entry.source,
    pinnedCommit: plan.entry.pinnedCommit ?? null,
    packageName: plan.entry.packageName ?? null,
    version: plan.entry.version ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Build an install plan from a catalog entry. GitHub entries must pin a full
 * commit; anything else is rejected as untrusted before a plan can exist.
 */
export function createPlan(
  entry: CatalogEntry,
  action: PlanAction,
  profile: string,
): InstallPlan {
  if (entry.source === 'github') {
    if (!entry.pinnedCommit || !isValidCommit(entry.pinnedCommit)) {
      throw new CpError(
        CpErrorCode.untrustedSource,
        `entry ${entry.id} has no pinned 40-hex commit`,
      );
    }
    if (!entry.owner || !entry.repo) {
      throw new CpError(CpErrorCode.invalidPlan, 'github entry missing owner/repo');
    }
  }
  if (entry.source === 'npm' && (!entry.packageName || !entry.version)) {
    throw new CpError(CpErrorCode.invalidPlan, 'npm entry missing packageName/version');
  }
  if (!profile.trim()) {
    throw new CpError(CpErrorCode.invalidPlan, 'profile is required');
  }
  const core = { action, profile, entry };
  const digest = hashPlan(core);
  return {
    planId: `${digest.slice(0, 16)}-${action}`,
    action,
    profile,
    entry,
    // 12 hex chars: the confirmation code is typed by a human, so keep it
    // short while leaving no realistic brute-force window for profile
    // enumeration (2^48 space per action/id pair).
    phraseSha8: digest.slice(0, 12),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Deterministic bilingual confirmation phrase bound to the plan content.
 * Same plan always yields the same phrase; different plans never collide in
 * practice (12 hex chars of the canonical-content digest).
 */
export function confirmationPhrase(plan: InstallPlan): string {
  const verb =
    plan.action === 'install' ? '安装 install' : plan.action === 'update' ? '更新 update' : '卸载 uninstall';
  return `确认 ${verb} ${plan.entry.id} @${plan.phraseSha8} / confirm`;
}

interface PendingRecord {
  plan: InstallPlan;
  state: PlanState;
  expiresAtMs: number;
}

/** One-shot plan store: confirmation consumes the plan exactly once. */
export class PlanStore {
  private readonly pending = new Map<string, PendingRecord>();

  constructor(private readonly ttlMs = 10 * 60_000) {}

  add(plan: InstallPlan): void {
    // Never overwrite an existing plan: resetting a confirmed plan back to
    // planned would reopen a one-shot window.
    if (this.pending.has(plan.planId)) {
      throw new CpError(CpErrorCode.invalidPlan, `plan ${plan.planId} already exists`);
    }
    this.pending.set(plan.planId, {
      plan,
      state: 'planned',
      expiresAtMs: Date.parse(plan.createdAt) + this.ttlMs,
    });
  }

  get(planId: string): { plan: InstallPlan; state: PlanState } | null {
    const record = this.pending.get(planId);
    return record ? { plan: record.plan, state: record.state } : null;
  }

  markState(planId: string, state: PlanState): void {
    const record = this.pending.get(planId);
    if (record) record.state = state;
  }

  /** Consume the plan: only the exact phrase, only once, only unexpired. */
  confirm(planId: string, phrase: string): InstallPlan {
    const record = this.pending.get(planId);
    if (!record) throw new CpError(CpErrorCode.planNotFound, `unknown plan ${planId}`);
    if (Date.now() > record.expiresAtMs) {
      this.pending.delete(planId);
      throw new CpError(CpErrorCode.planNotFound, `plan ${planId} expired`);
    }
    if (record.state === 'confirmed' || record.state === 'executing') {
      throw new CpError(CpErrorCode.planConsumed, `plan ${planId} was already confirmed`);
    }
    if (phrase.trim() !== confirmationPhrase(record.plan)) {
      throw new CpError(CpErrorCode.confirmationMismatch, 'confirmation phrase does not match');
    }
    record.state = 'confirmed';
    return record.plan;
  }

  /** Drop expired plans; returns the number removed. */
  sweepExpired(nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [id, record] of this.pending) {
      if (nowMs > record.expiresAtMs) {
        this.pending.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
