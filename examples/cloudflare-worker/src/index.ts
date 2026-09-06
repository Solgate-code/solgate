/**
 * Deploy the API to Cloudflare Workers. Storage here is a tiny KV-backed adapter;
 * for production use D1 (SQL) — the Storage interface is 20 methods, see docs/storage.md.
 */
import { createAllowlistApp, type Storage } from "@solana-allowlist/server";
import { MemoryStorage } from "@solana-allowlist/server";

export default {
  async fetch(req: Request, env: Record<string, string>, ctx: ExecutionContext) {
    const storage: Storage = new MemoryStorage(); // replace with a D1/KV adapter
    const { app } = createAllowlistApp(
      {
        storage,
        baseUrl: env.BASE_URL,
        sessionSecret: env.SESSION_SECRET,
        adminApiKey: env.ADMIN_API_KEY,
        solana: { rpcUrl: env.SOLANA_RPC_URL, dasUrl: env.SOLANA_DAS_URL },
        oauth: { discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET } },
      },
      { waitUntil: (p) => ctx.waitUntil(p) },
    );
    return app.fetch(req, env, ctx);
  },
};
