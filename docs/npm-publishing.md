# npm publishing

SolGate publishes these public packages:

- `@solgate/core`
- `@solgate/server`
- `@solgate/react`
- `@solgate/embed`

`@solgate/admin` is private and is not published.

## First publish

The GitHub Actions workflow `.github/workflows/publish.yml` supports manual dispatch and release-triggered publishing. It expects a GitHub Actions secret named `NPM_TOKEN`.

Create a granular npm access token for the `solgate` npm account with package write permission and configure it as the repository secret `NPM_TOKEN`. Do not commit the token to the repository.

Before publishing, the workflow runs install, build, typecheck, and tests. Public packages declare `publishConfig.access = "public"`.

For a first manual publish from a trusted local machine, after `npm login` / `npm whoami` confirms the `solgate` account, you can also run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm -r --filter './packages/*' --filter '!@solgate/admin' publish --access public --no-git-checks
```

## Trusted publishing

After the packages exist on npm, configure npm Trusted Publishing for each package with:

- GitHub owner: `Solgate-code`
- Repository: `solgate`
- Workflow: `publish.yml`

Then remove the long-lived `NPM_TOKEN` dependency from the workflow and publish with GitHub OIDC (`id-token: write`).

## Release discipline

Keep package versions aligned for now. Bump all public package versions before a release, merge to `main`, then create a GitHub release. npm will reject an attempt to republish a version that already exists.
