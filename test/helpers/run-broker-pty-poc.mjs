import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PtySession } from "../../src/broker/pty-session.js";
import { brokerTurn } from "../../src/broker/turn-controller.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = path.join(root, "test", "fixtures", "mock-claude-tui.cjs");
const prompt = "Implement the synthetic parser fix.";
const session = PtySession.spawn(process.execPath, [fixture], { cwd: root, promptSettleMs: 25 });

try {
  await session.waitFor(/STATE top-level-prompt/);
  const result = await brokerTurn({
    prompt,
    activeModel: "claude-sonnet-5",
    activeEffort: "high",
    classifier: () => ({
      status: "ok",
      decision: {
        tier: "medium",
        confidence: 0.8,
        reasons: ["synthetic"],
        execution: { claudeEffort: "medium" },
        context: { modelProfileId: "claude-sonnet-5" },
      },
    }),
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: (effort) => session.applyEffort(effort),
    forwardPrompt: (value) => session.forwardPrompt(value),
  });
  await session.waitFor(/MODEL_REQUEST count=1/);
  const encoded = Buffer.from(prompt).toString("base64");
  const acknowledgementIndex = session.buffer.indexOf("Set effort level to medium");
  const requestIndex = session.buffer.indexOf(
    `MODEL_REQUEST count=1 effort=medium prompt_b64=${encoded}`,
  );
  const summary = {
    acknowledgementBeforeRequest:
      acknowledgementIndex >= 0 && requestIndex > acknowledgementIndex,
    requestCount: (session.buffer.match(/MODEL_REQUEST/g) ?? []).length,
    outcome: result.outcome,
    metadataContainsPrompt: JSON.stringify(result).includes("synthetic parser fix"),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  session.write("/exit\r");
  await session.waitFor(/EXIT/);
  await session.exitPromise;
  session.dispose();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  session.dispose();
  process.exit(1);
}
