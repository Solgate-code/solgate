# Storage adapters

`Storage` (packages/server/src/storage/types.ts) is intentionally small: campaigns, entries, TTL'd temp values, social-link uniqueness, webhooks, api keys. Built-in:

- `MemoryStorage` — tests, demos.
- `createSqliteStorage(file)` — production for most projects (a few thousand to low millions of entries), zero ops, WAL mode.

For Postgres, D1, Turso, etc. copy `sqlite.ts` and swap the driver: every table is `key → JSON` with a couple of indexed columns, so the port is mechanical. Uniqueness guarantees come from primary keys:

- `entries (campaign_id, wallet)` — one entry per wallet per campaign.
- `social_links (campaign_id, provider, provider_user_id)` — one X/Discord/Telegram/Google account per wallet per campaign.

Rate limiting and OAuth state use `temp` with TTL; on edge runtimes back this with KV.
