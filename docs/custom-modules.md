# Writing a custom module

A module has two halves: a **definition** (id, label, config schema — safe for the browser) and a **verifier** (server-side check).

```ts
// modules/staked-sol.ts
import { z } from "zod";
import { ModuleRegistry, type ModuleDefinition } from "@solana-allowlist/core";
import { pass, fail, type Verifier } from "@solana-allowlist/server";

const StakedSolModule = {
  id: "staked-sol",
  label: "Staked SOL",
  category: "onchain",
  recheckable: true,
  configSchema: z.object({ minSol: z.number().positive(), validator: z.string().optional() }),
} satisfies ModuleDefinition;

type Cfg = z.infer<typeof StakedSolModule.configSchema>;

const stakedSolVerifier: Verifier<Cfg> = {
  moduleId: "staked-sol",
  async verify({ requirement, config, wallet, cfg }) {
    const total = await sumStakeAccounts(cfg.solana.rpcUrl, wallet, config.validator); // your RPC logic
    return total >= config.minSol
      ? pass(requirement.key, requirement.module, { total })
      : fail(requirement.key, requirement.module, `Stake at least ${config.minSol} SOL`, { total });
  },
};

// server.ts
const registry = new ModuleRegistry().register(StakedSolModule);
createAllowlistApp({ ...config, registry, verifiers: [stakedSolVerifier] });
```

In the widget, custom modules get a plain "Check" button by default (POSTs `{}`). To render something richer, pass `renderers={{ "staked-sol": MyComponent }}` to `<AllowlistWidget>`; the component receives `{ req, result, busy, verify }`.

Verifier `input` is whatever the client posts, so a module can collect arbitrary data (proof URLs, on-chain tx signatures to inspect, etc.).
