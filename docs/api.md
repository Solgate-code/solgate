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
| GET | `/campaigns/:id/eligibility/:wallet` | `{eligible, allocation, points, rank, merkle?: {root, proof}}` — set `protectEligibilityLookup` to require a read key |

## Admin (`x-api-key`)
| Method | Path |
|---|---|
| GET/POST | `/admin/campaigns` |
| GET/PUT/DELETE | `/admin/campaigns/:id` |
| GET | `/admin/campaigns/:id/stats` |
| GET | `/admin/campaigns/:id/entries?page&limit&eligible&search` |
| PATCH | `/admin/campaigns/:id/entries/:wallet/requirements/:key` `{passed, note}` |
| POST | `/admin/campaigns/:id/recheck` `{wallets?}` |
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
`entry.created`, `entry.updated`, `entry.eligible`, `entry.ineligible`, `requirement.passed`, `requirement.failed`, `campaign.updated`, `campaign.exported`.
Header `x-allowlist-signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`. Verify with `verifyWebhookSignature()` from `@solana-allowlist/server`.
