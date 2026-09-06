# Contributing

Thanks for helping make self-hosted allowlists the default on Solana.

## Setup

```bash
git clone https://github.com/Solgate-code/solgate.git
cd solgate
pnpm install
pnpm build && pnpm test
```

Node 20+ and pnpm 9 are required. `pnpm dev:server` starts the API with an in-memory DB when `ALLOWLIST_DB=memory`; `pnpm dev:admin` starts the dashboard.

## Good first contributions

- **A new module** (staking, DAO membership, domain ownership, on-chain activity…). Definition goes in `packages/core/src/modules.ts`, verifier in `packages/server/src/verifiers/`, an optional renderer in `packages/react/src/requirements/`. See `docs/custom-modules.md`.
- **A storage adapter** (Postgres, D1, Turso). Copy `packages/server/src/storage/sqlite.ts`.
- **Docs and examples** for a framework or host you use (Astro, SvelteKit, Fly.io, Railway…).

## Pull requests

- One change per PR, with a short description of *why*.
- Add or update a test where behaviour changes (`vitest`). CI runs build, typecheck and tests.
- Keep the module contract stable: changing `ModuleDefinition`, `Verifier` or `Storage` needs a discussion issue first.
- No secrets, API keys or `.env` files in commits.

## Reporting security issues

Please don't open a public issue for vulnerabilities. See `docs/security.md` for the threat model and email the maintainers (address in the repo profile) instead.

## Code of conduct

Be kind, be specific, assume good faith.
