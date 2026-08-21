import assert from "node:assert/strict";
import test from "node:test";

import {
  GatewayTransformError,
  extractLatestUserPrompt,
  passThroughStream,
  prepareGatewayRequest,
} from "../src/gateway/request-transform.js";

const PRIVATE_PROMPT = "Fix the private payment race and add tests.";

function syntheticRequest(overrides = {}) {
  return {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    stream: true,
    system: [{ type: "text", text: "synthetic system" }],
    messages: [{ role: "user", content: PRIVATE_PROMPT }],
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    output_config: { format: { type: "json_schema", schema: {} }, effort: "high" },
    ...overrides,
  };
}

test("synthetic gateway classifies before applying an effort-only mutation", () => {
  const events = [];
  const requestBody = syntheticRequest();
  const result = prepareGatewayRequest({
    requestBody,
    config: { ceiling: "medium", baselineEffort: "medium" },
    classifier(input) {
      events.push(`classify:${input.modelProfile.id}`);
      return {
        status: "ok",
        decision: {
          tier: "high",
          confidence: 0.8,
          reasons: ["synthetic"],
          execution: { claudeEffort: "high" },
          context: { modelProfileId: input.modelProfile.id },
        },
      };
    },
  });
  events.push(`forward:${result.forwardBody.output_config.effort}`);

  assert.deepEqual(events, ["classify:claude-sonnet-5", "forward:medium"]);
  assert.equal(result.forwardBody.model, requestBody.model);
  assert.equal(result.forwardBody.messages, requestBody.messages);
  assert.equal(result.forwardBody.tools, requestBody.tools);
  assert.equal(result.forwardBody.stream, true);
  assert.deepEqual(result.forwardBody.output_config, {
    format: requestBody.output_config.format,
    effort: "medium",
  });
  assert.equal(requestBody.output_config.effort, "high", "input must not be mutated");
});

test("tool-result requests reuse the latest natural-language user turn", () => {
  const request = syntheticRequest({
    messages: [
      { role: "user", content: PRIVATE_PROMPT },
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
    ],
  });
  assert.equal(extractLatestUserPrompt(request), PRIVATE_PROMPT);
});

test("classification failure preserves the entire outbound request by default", () => {
  const requestBody = syntheticRequest();
  const result = prepareGatewayRequest({
    requestBody,
    classifier: () => ({ status: "fallback" }),
  });
  assert.equal(result.forwardBody, requestBody);
  assert.equal(result.metadata.outcome, "forward-unmodified");
  assert.equal(result.metadata.appliedEffort, null);
  assert.equal(requestBody.output_config.effort, "high");
});

test("fail-closed mode rejects locally without a forward or retry", () => {
  let classifications = 0;
  assert.throws(
    () =>
      prepareGatewayRequest({
        requestBody: syntheticRequest(),
        classifier: () => {
          classifications += 1;
          throw new Error("synthetic failure");
        },
        onFailure: "reject",
      }),
    (error) => error instanceof GatewayTransformError && error.code === "gateway-classification-rejected",
  );
  assert.equal(classifications, 1);
});

test("prompt-free gateway metadata is safe to display or measure", () => {
  const result = prepareGatewayRequest({ requestBody: syntheticRequest() });
  assert.doesNotMatch(JSON.stringify(result.metadata), /private payment race/i);
  assert.match(JSON.stringify(result.forwardBody), /private payment race/i);
});

test("synthetic streaming pass-through preserves bytes and chunk order", async () => {
  const chunks = [
    Buffer.from("event: message_start\n\n"),
    Buffer.from("data: {\"type\":\"content_block_delta\"}\n\n"),
    Buffer.from("event: ping\n\n"),
  ];
  const relayed = [];
  for await (const chunk of passThroughStream(chunks)) relayed.push(chunk);
  assert.equal(Buffer.concat(relayed).compare(Buffer.concat(chunks)), 0);
  assert.deepEqual(relayed, chunks);
});
