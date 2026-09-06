# Storage adapters

`Storage` (packages/server/src/storage/types.ts) is intentionally small: campaigns, entries, TTL'd temp values, social-link uniqueness, webhooks, api keys. Built-in:

- `MemoryStorage` — tests, demos.
- `createSqliteStorage(file)` — production for most projects (a few thousand to low millions of entries), zero ops, WAL mode.

For Postgres, D1, Turso, etc. copy `sqlite.ts` and swap the driver: every table is `key → JSON` with a couple of indexed columns, so the port is mechanical. Two methods carry concurrency guarantees that your adapter **must** preserve:

- `claimSocialLink` — must be an atomic insert-if-absent (`ON CONFLICT DO NOTHING`, then read the owner). Never `INSERT OR REPLACE`.
- `incrTemp` — must be a single atomic increment (`ON CONFLICT DO UPDATE SET v = v + 1 RETURNING v`, Redis `INCR`, etc.). Never read-add-write.

Uniqueness guarantees come from primary keys:

- `entries (campaign_id, wallet)` — one entry per wallet per campaign.
- `social_links (campaign_id, provider, provider_user_id)` — one X/Discord/Telegram/Google account per wallet per campaign.

Rate limiting and OAuth state use `temp` with TTL; on edge runtimes back this with KV.
