import { describe, expect, it } from 'vitest';
import {
  confirmationPhrase,
  createPlan,
  CpError,
  isValidProfileName,
  PlanStore,
} from '../../src/host/plans.js';
import type { CatalogEntry } from '../../src/shared/catalog.js';

const COMMIT = 'c'.repeat(40);
const PROFILE_DIR = '/home/u/.dsh-zdsh/profiles/web';

function ghEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'sliverp/dsh-hub-plugin',
    source: 'github',
    owner: 'sliverp',
    repo: 'dsh-hub-plugin',
    pinnedCommit: COMMIT,
    title: { zh: 'Hub', en: 'Hub' },
    summary: { zh: '市场', en: 'Marketplace' },
    category: 'marketplace',
    evidence: 'verified',
    compat: 'exact',
    scriptsPolicy: 'none',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('plan creation', () => {
  it('rejects github entries without a pinned commit', () => {
    expect(() => createPlan(ghEntry({ pinnedCommit: undefined }), 'install', 'web', PROFILE_DIR)).toThrow(CpError);
    try {
      createPlan(ghEntry({ pinnedCommit: 'main' }), 'install', 'web', PROFILE_DIR);
    } catch (error) {
      expect((error as CpError).code).toBe('untrusted_source');
    }
  });

  it('codes are random one-shot secrets, not derived content', () => {
    const a = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    const b = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    // identical content yields identical plan ids…
    expect(a.planId).toBe(b.planId);
    // …but independent confirmation codes, so a leaked id reveals nothing
    expect(a.confirmCode).toMatch(/^[0-9a-f]{12}$/);
    expect(a.confirmCode).not.toBe(b.confirmCode);
  });

  it('different actions or profiles yield different phrases', () => {
    const install = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    const update = createPlan(ghEntry(), 'update', 'web', PROFILE_DIR);
    const otherProfile = createPlan(ghEntry(), 'install', 'docs', PROFILE_DIR);
    expect(confirmationPhrase(install)).not.toBe(confirmationPhrase(update));
    expect(confirmationPhrase(install)).not.toBe(confirmationPhrase(otherProfile));
  });

  it('refuses directory-shaped profile names (CP-1: the CLI takes a bare name)', () => {
    for (const bad of [PROFILE_DIR, 'profiles/web', 'profiles\\web', '.', '..', 'node_modules', '']) {
      expect(() => createPlan(ghEntry(), 'install', bad, PROFILE_DIR)).toThrow(CpError);
      try {
        createPlan(ghEntry(), 'install', bad, PROFILE_DIR);
      } catch (error) {
        expect((error as CpError).code).toBe('invalid_plan');
      }
    }
    expect(() => createPlan(ghEntry(), 'install', 'web', '  ')).toThrow(CpError);
  });

  it('profile name and dir are carried as two separate layers on the plan', () => {
    const plan = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    expect(plan.profile).toBe('web');
    expect(plan.profileDir).toBe(PROFILE_DIR);
    // a different dir with the same name is a different plan (backup/rollback target differs)
    const other = createPlan(ghEntry(), 'install', 'web', '/elsewhere/profiles/web');
    expect(other.planId).not.toBe(plan.planId);
  });

  it('isValidProfileName mirrors the launcher predicate surface', () => {
    for (const good of ['web', 'docs', 'headless', 'sdk-minimal', 'a.b', 'a_b', '2']) {
      expect(isValidProfileName(good)).toBe(true);
    }
    for (const bad of ['', '.', '..', 'node_modules', 'a/b', 'a\\b', '/abs', 'C:\\x']) {
      expect(isValidProfileName(bad)).toBe(false);
    }
  });
});

describe('plan store one-shot semantics', () => {
  it('confirms exactly once with the exact phrase', () => {
    const store = new PlanStore();
    const plan = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    store.add(plan);
    const phrase = confirmationPhrase(plan);
    expect(store.confirm(plan.planId, phrase).planId).toBe(plan.planId);
    expect(() => store.confirm(plan.planId, phrase)).toThrow(CpError);
    try {
      store.confirm(plan.planId, phrase);
    } catch (error) {
      expect((error as CpError).code).toBe('plan_consumed');
    }
  });

  it('rejects wrong phrases without consuming the plan', () => {
    const store = new PlanStore();
    const plan = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    store.add(plan);
    try {
      store.confirm(plan.planId, 'wrong phrase');
    } catch (error) {
      expect((error as CpError).code).toBe('confirmation_mismatch');
    }
    // still confirmable with the right phrase afterwards
    expect(store.confirm(plan.planId, confirmationPhrase(plan)).planId).toBe(plan.planId);
  });

  it('expires stale plans on sweep and rejects their confirmation', async () => {
    const store = new PlanStore(10); // 10ms ttl
    const plan = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    store.add(plan);
    await new Promise((r) => setTimeout(r, 25));
    expect(store.sweepExpired()).toBe(1);
    expect(store.get(plan.planId)).toBeNull();
    expect(() => store.confirm(plan.planId, confirmationPhrase(plan))).toThrow(CpError);
  });

  it('refuses to overwrite an existing plan id', () => {
    const store = new PlanStore();
    const plan = createPlan(ghEntry(), 'install', 'web', PROFILE_DIR);
    store.add(plan);
    expect(() => store.add(plan)).toThrow(CpError);
    // the original pending plan survives untouched
    expect(store.get(plan.planId)?.state).toBe('planned');
  });
});
