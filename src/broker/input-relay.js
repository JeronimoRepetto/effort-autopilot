/**
 * Byte-transparent stdin relay for a PTY child.
 *
 * It never parses permission answers, editor input, slash commands, paste, or
 * cancellation keys. During the short hook-owned routing window it pauses the
 * source stream, letting Node/OS backpressure preserve later bytes. Resuming
 * delivers those bytes unchanged and in order after the authorized replay.
 */
export class PtyInputRelay {
  constructor({ input, write }) {
    if (!input || typeof input.on !== "function") throw new TypeError("input stream required");
    if (typeof write !== "function") throw new TypeError("write function required");
    this.input = input;
    this.write = write;
    this.started = false;
    this.routing = false;
    this.onData = (chunk) => this.write(chunk);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.input.on("data", this.onData);
  }

  pauseForRouting() {
    if (!this.started || this.routing) return false;
    this.routing = true;
    this.input.pause();
    return true;
  }

  resumeAfterRouting() {
    if (!this.started || !this.routing) return false;
    this.routing = false;
    this.input.resume();
    return true;
  }

  dispose() {
    if (!this.started) return;
    this.input.off("data", this.onData);
    this.started = false;
    this.routing = false;
  }
}
