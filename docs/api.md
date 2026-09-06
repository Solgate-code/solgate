# HTTP API

Base URL: your deployment. All bodies are JSON.

## Public (used by the widget)
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness + registered module ids |
| GET | `/modules` | module definitions (no schemas) |
| GET | `/campaigns/:id` | public campaign (quiz answers stripped) + counts |
| POST | `/campaigns/:id/auth/nonce` | `{wallet}` → `{nonce, message}` (5 min TTL) |
| POST | `/campaigns/:id/auth/verify` | `{wallet, nonce, signature}` → `{token, entry}` |
| GET | `/campaigns/:id/me` | Bearer session → `{entry, social}` |
| POST | `/campaigns/:id/requirements/:key/verify` | Bearer session; body is module-specific input |
| GET | `/campaigns/:id/oauth/:provider/start?key=&return=` | Bearer session → `{url}` (`&redirect=1` to 302) |
| GET | `/oauth/:provider/callback` | provider redirect target |

## Integration
| Method | Path | Notes |
|---|---|---|
| GET | `/campaigns/:id/eligibility/:wallet` | `{eligible, allocation, snapshot, merkle?: {root, proof}}`. Served from the latest snapshot when one exists (`?snapshot=<id>` pins one). `points`/`rank` only with a read key, or when `eligibilityLookup` is `"full"`. `"protected"` requires a key for everything. |

## Admin (`x-api-key`)
| Method | Path |
|---|---|
| GET/POST | `/admin/campaigns` |
| GET/PUT/DELETE | `/admin/campaigns/:id` |
| GET | `/admin/campaigns/:id/stats` |
| GET | `/admin/campaigns/:id/entries?page&limit&eligible&search` |
| PATCH | `/admin/campaigns/:id/entries/:wallet/requirements/:key` `{passed, note}` |
| POST | `/admin/campaigns/:id/recheck` `{wallets?}` → `{checked, changed, unavailable}` |
| POST | `/admin/campaigns/:id/snapshot` → immutable `{id, count, totalAllocation, merkle}` |
| GET | `/admin/campaigns/:id/snapshots`, `/admin/campaigns/:id/snapshots/:sid` |
| GET | `/admin/campaigns/:id/export?format=csv|json|txt|merkle&all&evidence` |
| GET/POST/DELETE | `/admin/webhooks`, `/admin/webhooks/:id`, `POST /admin/webhooks/:id/test` |
| GET/POST/DELETE | `/admin/api-keys`, `/admin/api-keys/:id` |

## Module inputs (`/requirements/:key/verify` body)
- `token-balance`, `nft-ownership`: `{}`
- `quiz`: `{ answers: { [questionId]: number | number[] | string } }`
- `referral`: `{ code?: string }`
- `captcha`: `{ token: string }`
- `social-task`: `{ action: "open" | "complete", proofUrl?: string }`
- `telegram-verify`: the Telegram Login Widget user object
- `x-verify` / `discord-verify` / `youtube-verify`: driven by the OAuth callback, not called directly

## Webhook events
`entry.created`, `entry.updated`, `entry.eligible`, `entry.ineligible`, `requirement.passed`, `requirement.failed`, `campaign.updated`, `campaign.exported`, `campaign.snapshot`.
Webhook targets must be `https://` and may not point at localhost or private address ranges (`allowInsecureWebhooks` relaxes this for local development).

## Errors
`503 verification_unavailable` — an upstream (RPC, DAS, provider API) failed. Nothing was recorded; the client should retry. An outage is never persisted as a failed requirement.
Header `x-allowlist-signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`. Verify with `verifyWebhookSignature()` from `@solgate/server`.
