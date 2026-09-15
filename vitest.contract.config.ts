import { defineConfig } from 'vitest/config';
import { CONTRACT_SPECS } from './vitest.config';

/**
 * Opt-in runner for the true-host contract specs (see `vitest.config.ts`).
 * These import the mainline `zDSH-main` sibling and fail loud when it is
 * missing, so they are NOT part of CI's default `pnpm test`. Run locally (or
 * in a matrix that checks out zDSH-main) with `pnpm test:contract`, which
 * resolves to `vitest run --config vitest.contract.config.ts`.
 */
export default defineConfig({
  test: {
    include: [...CONTRACT_SPECS],
    environment: 'node',
  },
});
