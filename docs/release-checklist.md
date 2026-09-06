# Release checklist

Before publishing SolGate packages:

1. Merge security/remediation changes to `main`.
2. Confirm `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, and `pnpm test` pass.
3. Confirm public package versions are aligned and have not already been published.
4. Confirm the npm scope is `@solgate` and the npm account owns the scope.
5. Confirm `NPM_TOKEN` is configured in GitHub Actions for the initial publish, or npm Trusted Publishing is configured for subsequent releases.
6. Publish via the `Publish to npm` workflow or create a GitHub release.
7. Verify the registry entries for `@solgate/core`, `@solgate/server`, `@solgate/react`, and `@solgate/embed`.
8. Install the published packages in a clean test project before announcing the release.

Never commit npm tokens, recovery codes, OAuth client secrets, admin keys, or wallet secrets to the repository.
