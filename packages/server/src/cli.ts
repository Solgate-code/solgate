#!/usr/bin/env node
import { startNodeServer } from "./node.js";
startNodeServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
