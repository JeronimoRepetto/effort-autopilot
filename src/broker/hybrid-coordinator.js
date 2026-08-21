import { randomUUID } from "node:crypto";

import { resolveBundledModelProfile } from "../core/model-profiles.js";
import { brokerTurn } from "./turn-controller.js";
import { ReplayAuthorizations } from "./replay-authorizations.js";

const MAX_PROMPT_BYTES = 1024 * 1024;

function replaySystemMessage(metadata) {
  if (metadata?.outcome === "applied") {
    return `Effort Autopilot: applied ${metadata.appliedEffort} for ${metadata.model}.`;
  }
  return `Effort Autopilot: automatic effort unchanged (${metadata?.cause ?? "unknown"}).`;
}

export class HybridBrokerCoordinator {
  constructor({
    authorizations = new ReplayAuthorizations(),
    diagnosticBlockAuthorizedReplay = false,
  } = {}) {
    this.authorizations = authorizations;
    this.diagnosticBlockAuthorizedReplay = diagnosticBlockAuthorizedReplay;
    this.sessions = new Map();
    this.pending = new Map();
  }

  registerSession({ sessionId, model, cwd = null }) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("invalid session id");
    const exactProfile = resolveBundledModelProfile(model);
    this.sessions.set(sessionId, {
      model: exactProfile?.id ?? null,
      modelReliable: Boolean(exactProfile),
      cwd,
      explicitUserEffort: false,
      activeEffort: null,
    });
    return Object.freeze({ registered: true, exactModel: exactProfile?.id ?? null });
  }

  updateUserEffort(sessionId, effort) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.explicitUserEffort = true;
    session.activeEffort = effort;
    return true;
  }

  markModelAmbiguous(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.model = null;
    session.modelReliable = false;
    return true;
  }

  handleUserPromptSubmit({ sessionId, prompt, promptId = null, cwd = null }) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("invalid session id");
    if (typeof prompt !== "string" || prompt.length === 0) throw new TypeError("invalid prompt");
    if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error("prompt-too-large");

    const authorization = this.authorizations.consume(sessionId, prompt);
    if (authorization) {
      if (this.diagnosticBlockAuthorizedReplay) {
        return Object.freeze({
          action: "block",
          reason: "Diagnostic mode suppressed the authorized replay before inference.",
          authorizedReplay: true,
          diagnostic: true,
        });
      }
      return Object.freeze({
        action: "allow",
        authorizedReplay: true,
        systemMessage: authorization.systemMessage,
      });
    }

    if ([...this.pending.values()].some((ticket) => ticket.sessionId === sessionId)) {
      return Object.freeze({
        action: "block",
        reason: "Effort Autopilot is still routing the previous task.",
        authorizedReplay: false,
        busy: true,
      });
    }

    const ticket = {
      id: randomUUID(),
      sessionId,
      prompt,
      promptId,
      cwd,
      createdAt: Date.now(),
    };
    this.pending.set(ticket.id, ticket);
    return Object.freeze({
      action: "block",
      reason: "Effort Autopilot is applying local effort before this task.",
      authorizedReplay: false,
      ticketId: ticket.id,
    });
  }

  async routeTicket(ticketId, {
    classifier,
    environment,
    config,
    applyEffort,
    reinjectPrompt,
    onStatus,
    classificationTimeoutMs,
    minimumConfidence,
  } = {}) {
    const ticket = this.pending.get(ticketId);
    if (!ticket) throw new Error("unknown-or-stale-ticket");
    const session = this.sessions.get(ticket.sessionId) ?? {
      model: null,
      modelReliable: false,
      explicitUserEffort: false,
      activeEffort: null,
    };
    let armed = null;
    try {
      return await brokerTurn({
        prompt: ticket.prompt,
        activeModel: session.modelReliable ? session.model : null,
        activeEffort: session.activeEffort,
        explicitUserEffort: session.explicitUserEffort,
        terminalState: "top-level-prompt",
        classifier,
        environment,
        config,
        applyEffort,
        classificationTimeoutMs,
        minimumConfidence,
        forwardPrompt: async (prompt, metadata) => {
          armed = this.authorizations.arm(ticket.sessionId, prompt, {
            systemMessage: replaySystemMessage(metadata),
          });
          try {
            await reinjectPrompt(prompt);
          } catch (error) {
            this.authorizations.revoke(armed);
            throw error;
          }
        },
        onStatus,
      });
    } finally {
      ticket.prompt = "";
      this.pending.delete(ticketId);
    }
  }

  cancelTicket(ticketId) {
    const ticket = this.pending.get(ticketId);
    if (!ticket) return false;
    ticket.prompt = "";
    this.pending.delete(ticketId);
    return true;
  }
}
