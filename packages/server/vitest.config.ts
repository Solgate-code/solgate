import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // better-sqlite3's native addon crashes vitest's default worker_threads
    // pool during teardown; forks (child processes) avoids it.
    pool: "forks",
  },
});
