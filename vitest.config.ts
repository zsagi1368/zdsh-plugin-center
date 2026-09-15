import { configDefaults, defineConfig } from 'vitest/config';

/**
 * True-host contract specs import the mainline clone through a sibling path
 * (`zDSH-main/packages/boot/app-boot/src/profile.ts`) and fail loud when that
 * sibling is absent — by design, an honest red is never a silent skip. CI
 * runners (GitHub ubuntu/windows matrices) do not carry zDSH-main, so these
 * files are kept out of the default include here and run explicitly instead
 * (see `vitest.contract.config.ts` and the `test:contract` script; local run
 * notes: README "Development" / AGENTS.md).
 */
export const CONTRACT_SPECS: string[] = [
  'tests/integration/launcher-profile-contract.spec.ts',
];

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    exclude: [...configDefaults.exclude, ...CONTRACT_SPECS],
    environment: 'node',
    coverage: {
      reporter: ['text'],
      include: ['src/**'],
    },
  },
});
