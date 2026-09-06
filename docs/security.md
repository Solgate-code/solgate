# Security model

- **Wallet ownership**: SIWS-style message with a server-issued nonce (5 min TTL, single use), ed25519-verified. Sessions are HMAC-signed, 24h by default, bound to one campaign.
- **Duplicate prevention**: wallet is the primary key; social identities are unique per campaign (a Discord/X/Telegram/Google account can back only one wallet). Uniqueness is enforced by the storage layer's unique constraint via an atomic insert-if-absent (`claimSocialLink`), not by check-then-write in application code. Referral self-use is blocked; referrer credits are capped with an atomic counter.
- **Client IP**: forwarded headers (`cf-connecting-ip`, `x-forwarded-for`) are ignored unless `trustProxy` names the proxy that sets them. With `trustProxy: "none"` the socket address is used (Node) or per-IP limiting is off (edge runtimes without a resolver).
- **OAuth return**: the `return` URL is restricted to relative paths, the API origin, CORS origins and `allowedReturnOrigins`. No open redirect.
- **Config exposure**: requirement config is private by default; a module must implement `publicConfig` to expose anything to the browser.
- **Upstream failures**: RPC/DAS/provider errors raise `VerificationUnavailable` → HTTP 503, and never get persisted as "failed".
- **Anti-bot**: CAPTCHA module (Turnstile/hCaptcha/reCAPTCHA v3), per-IP rate limiting, X account-age/follower thresholds, minimum dwell time on social tasks, quiz attempt limits.
- **Secrets**: quiz answers never leave the server (`publicConfig` strips them). OAuth client secrets, bot tokens, captcha secrets live in server env only. Webhook secrets and API keys are shown once and stored hashed (API keys) / at rest (webhook secrets, needed for signing).
- **On-chain re-verification**: balances and holdings can be re-checked at any time (`/recheck`) so the final export reflects a snapshot, not registration-time state.
- **Merkle / snapshots**: take a snapshot (`POST /admin/campaigns/:id/snapshot`) after the final re-check. The public eligibility endpoint then serves from that immutable snapshot, so the root cannot drift while people mint.
- **Timing-safe comparisons** for API keys, session MACs, webhook signatures and Telegram login hashes. Telegram logins are rejected if stale (>10 min) or from the future (>60 s skew).
- **Admin dashboard** keeps the API key in `sessionStorage` (cleared on tab close). Treat the admin origin as sensitive; a proper admin login session is on the roadmap.
- **Token balances** are compared as exact raw integers (`BigInt`), never floating-point `uiAmount`.
- **Follow checks on X**: X's `following` lookup requires a paid API tier. If unavailable the module links the account and records `followCheck: "unavailable"`; use `social-task` with `requireApproval` as a fallback.
