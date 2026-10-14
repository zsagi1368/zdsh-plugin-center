/**
 * Route-surface lock for the host entry (2026-10-14).
 *
 * `apply` used to register its twelve `/api2/zdsh-plugin-center/*` routes and
 * tear them down again inside the same tick: the cleanup was passed as the
 * cordis effect BODY, and `effect(execute)` runs `execute` immediately, keeping
 * its RETURN VALUE as the unload disposer. The fiber stayed ACTIVE and the
 * whole market surface answered 404 — which no suite covered, because nothing
 * asserted the route table after `apply`.
 */
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../src/host/api.js';
import { apply } from '../../src/host/plugin.js';

interface HostHarness {
  readonly ctx: unknown;
  readonly registered: Set<string>;
  readonly state: { unload: (() => void) | undefined; effectBodies: number };
}

/** A host context whose effect follows the cordis contract (run now, keep the return value). */
function makeHost(): HostHarness {
  const registered = new Set<string>();
  const state: HostHarness['state'] = { unload: undefined, effectBodies: 0 };
  const webCtx = {
    webServer: {
      register(route: { path: string }): () => void {
        registered.add(route.path);
        return () => {
          registered.delete(route.path);
        };
      },
    },
    effect(execute: () => unknown): void {
      state.effectBodies += 1;
      const returned = execute();
      if (typeof returned === 'function') state.unload = returned as () => void;
    },
    logger: { info: (): void => {} },
  };
  const ctx = {
    inject: (_deps: readonly string[], ready: (web: typeof webCtx) => void): void => {
      ready(webCtx);
    },
    logger: { info: (): void => {} },
  };
  return { ctx, registered, state };
}

describe('host entry route surface', () => {
  it('registers every route and keeps it until the returned disposer runs', () => {
    const { ctx, registered, state } = makeHost();
    apply(ctx as never, {});

    const paths = Object.values(ROUTES);
    expect(paths.length).toBeGreaterThan(0);
    expect(registered.size).toBe(paths.length);
    for (const path of paths) expect(registered.has(path)).toBe(true);

    // The effect body must be the registration, and its return value the teardown.
    expect(state.effectBodies).toBe(1);
    expect(typeof state.unload).toBe('function');
    state.unload?.();
    expect(registered.size).toBe(0);
  });
});
