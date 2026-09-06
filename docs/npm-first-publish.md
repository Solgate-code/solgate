# First npm publish

For the initial `@solgate/*` publication, configure a GitHub Actions repository secret named `NPM_TOKEN` using a granular npm token with package write permission. The workflow will publish all public packages except `@solgate/admin`.

After the packages exist, migrate each package to npm Trusted Publishing and remove the long-lived token dependency.
