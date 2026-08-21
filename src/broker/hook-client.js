import { callBrokerIpc } from "./ipc.js";
import { brokerMessages } from "./messages.js";

export async function handleClaudeHookInput(
  input,
  { endpoint, token, call = callBrokerIpc, timeoutMs = 500 } = {},
) {
  const unchangedWarning = {
    systemMessage: brokerMessages(input?.prompt).brokerUnavailable,
  };
  try {
    if (input === null || typeof input !== "object") return {};
    const event = input.hook_event_name;
    if (!["SessionStart", "UserPromptSubmit"].includes(event)) return {};
    if (!endpoint || !token) return event === "UserPromptSubmit" ? unchangedWarning : {};
    const response = await call({
      endpoint,
      token,
      timeoutMs,
      message: {
        event,
        sessionId: input.session_id,
        promptId: input.prompt_id,
        cwd: input.cwd,
        model: event === "SessionStart" ? input.model : undefined,
        prompt: event === "UserPromptSubmit" ? input.prompt : undefined,
      },
    });
    if (event !== "UserPromptSubmit") return {};
    if (response?.ok !== true) return unchangedWarning;
    if (response.action === "block") {
      return {
        decision: "block",
        reason: response.reason ?? "Effort Autopilot is routing this task locally.",
      };
    }
    return response.systemMessage ? { systemMessage: response.systemMessage } : {};
  } catch {
    // IPC failure is fail-open: Claude receives the original prompt normally.
    return input?.hook_event_name === "UserPromptSubmit" ? unchangedWarning : {};
  }
}
