import { createHash, randomUUID } from "node:crypto";

function replayKey(sessionId, prompt) {
  return createHash("sha256").update(sessionId).update("\0").update(prompt).digest("hex");
}

/** In-memory, one-use replay authorization. No prompt or digest is persisted or reported. */
export class ReplayAuthorizations {
  constructor({ ttlMs = 5000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  arm(sessionId, prompt, { systemMessage = null } = {}) {
    this.purge();
    const key = replayKey(sessionId, prompt);
    const authorization = Object.freeze({
      id: randomUUID(),
      key,
      sessionId,
      systemMessage,
      expiresAt: this.now() + this.ttlMs,
    });
    this.entries.set(key, authorization);
    return authorization;
  }

  consume(sessionId, prompt) {
    this.purge();
    const key = replayKey(sessionId, prompt);
    const authorization = this.entries.get(key);
    if (!authorization || authorization.sessionId !== sessionId) return null;
    this.entries.delete(key);
    return authorization;
  }

  revoke(authorization) {
    if (authorization?.key && this.entries.get(authorization.key)?.id === authorization.id) {
      this.entries.delete(authorization.key);
      return true;
    }
    return false;
  }

  purge() {
    const current = this.now();
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= current) this.entries.delete(key);
    }
  }

  get size() {
    this.purge();
    return this.entries.size;
  }
}
