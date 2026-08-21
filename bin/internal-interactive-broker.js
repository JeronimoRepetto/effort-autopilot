#!/usr/bin/env node
import process from "node:process";

import { runInteractiveBroker } from "../src/broker/interactive.js";

try {
  process.exitCode = await runInteractiveBroker();
} catch (error) {
  process.stderr.write(`Effort Autopilot: ${error.message}\n`);
  process.exitCode = 1;
}
