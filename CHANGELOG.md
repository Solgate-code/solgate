# Changelog

## 0.2.0 — audit remediation

Response to the static code audit (see `docs/security.md`). Every item below has a regression test in `packages/server/src/audit.test.ts` or `packages/core/src/merkle.test.ts`.

| Finding | Fix |
|---|---|
| H1 SPL balance query malformed / errors swallowed | Query `getTokenAccountsByOwner` by `mint` only (covers Token + Token-2022). Compare raw `amount` as `BigInt`. RPC failure → `VerificationUnavailable` → HTTP 503, nothing persisted. Same for DAS/NFT. |
| H2 Social uniqueness race | New atomic `Storage.claimSocialLink` (`ON CONFLICT DO NOTHING`, then read owner). `putSocialLink` removed. |
| H3 Referral points lost on re-evaluation | Referral credits now live in `Entry.bonusPoints`, included by `computePoints()` on every evaluation. |
| M4 FCFS by registration time | `Entry.eligibleAt` set once on first eligibility; `applyCaps` ranks by it with wallet tie-break. |
| M5 OAuth open redirect | `resolveReturnUrl` restricts `return` to relative paths, API origin, CORS origins and `allowedReturnOrigins`. |
| M6 Custom module config leaks | Config is private by default; `ModuleDefinition.publicConfig` opts in. Built-ins updated. |
| M7 Spoofable proxy headers | `trustProxy: "none" \| "cloudflare" \| "x-forwarded-for"`; socket address via `getClientIp` (Node uses `getConnInfo`). |
| M8 Non-atomic counters | SQLite `incrTemp` is a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`. |
| M9 Floating-point balances | `BigInt` raw units; `toRawAmount(ui, decimals)` scales the threshold exactly. |
| M10 Admin key in localStorage | Moved to `sessionStorage`; cleared on tab close. |
| L11 Timing-unsafe compares | `safeEqual` used for session MAC, webhook signature, Telegram hash. |
| L12 Telegram future timestamps | Reject `auth_date` more than 60 s in the future or older than 10 min. |
| L13 Public points/rank | `eligibilityLookup: "minimal"` (default) returns only `eligible`, `allocation`, proof. |
| L14 Merkle rebuilt per request | Immutable snapshots (`POST /admin/campaigns/:id/snapshot`); public lookup serves from the latest one. |
| L15 Webhook SSRF | `assertSafeWebhookUrl`: https only, no localhost/link-local/RFC1918/ULA literals. |
| Branding | Packages renamed to `@solgate/*`; repo links updated. |

Breaking changes: `Storage` interface gained `claimSocialLink`, `putSnapshot`, `getSnapshot`, `listSnapshots` and lost `putSocialLink`; `ServerConfig.protectEligibilityLookup` replaced by `eligibilityLookup`; `Verifier.publicConfig` still works but `ModuleDefinition.publicConfig` is preferred.

## 0.1.0

Initial release.
