import process from "node:process";

import * as nodePty from "node-pty";

export function terminalText(value) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, (sequence) => {
      const final = sequence.at(-1);
      if (final === "C") return " ";
      if (final === "H" || final === "f") return "\n";
      return "";
    })
    .replace(/\r/g, "");
}

export class PtySession {
  constructor(child, {
    acknowledgementTimeoutMs = 1000,
    topLevelSubmitSequence = "\r",
    promptSettleMs = 500,
  } = {}) {
    this.child = child;
    this.acknowledgementTimeoutMs = acknowledgementTimeoutMs;
    this.topLevelSubmitSequence = topLevelSubmitSequence;
    this.promptSettleMs = promptSettleMs;
    this.buffer = "";
    this.waiters = new Set();
    this.exited = false;
    this.exitPromise = new Promise((resolve) => {
      this.exitDisposable = child.onExit((event) => {
        this.exited = true;
        resolve(event);
      });
    });
    this.disposable = child.onData((data) => {
      this.buffer += data;
      if (this.buffer.length > 128 * 1024) this.buffer = this.buffer.slice(-64 * 1024);
      for (const waiter of [...this.waiters]) waiter();
    });
  }

  static spawn(command, args = [], options = {}) {
    const child = nodePty.spawn(command, args, {
      name: "xterm-256color",
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      useConpty: process.platform === "win32",
    });
    return new PtySession(child, options);
  }

  waitFor(pattern, timeoutMs = this.acknowledgementTimeoutMs, { normalize = false } = {}) {
    const matches = () => {
      pattern.lastIndex = 0;
      return pattern.test(normalize ? terminalText(this.buffer) : this.buffer);
    };
    if (matches()) return Promise.resolve(this.buffer);
    return new Promise((resolve, reject) => {
      let timer;
      const check = () => {
        if (!matches()) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(this.buffer);
      };
      timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error("pty-acknowledgement-timeout"));
      }, timeoutMs);
      this.waiters.add(check);
    });
  }

  async applyEffort(effort) {
    // Start a fresh bounded acknowledgement window. Full-screen TUIs redraw
    // enough data to trigger buffer compaction, so a numeric slice offset from
    // the pre-command buffer can become invalid while the command is running.
    this.buffer = "";
    this.child.write(`/effort ${effort}\r`);
    try {
      await this.waitFor(
        new RegExp(`Set effort level to ${effort}(?:\\s|\\(|$)`, "i"),
        this.acknowledgementTimeoutMs,
        { normalize: true },
      );
      const acknowledgement = terminalText(this.buffer);
      return {
        acknowledged: new RegExp(`Set effort level to ${effort}(?:\\s|\\(|$)`, "i").test(
          acknowledgement,
        ),
        effort,
      };
    } catch {
      return { acknowledged: false, effort: null };
    }
  }

  async forwardPrompt(prompt) {
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new TypeError("prompt must be a non-empty string");
    }
    // Multiline/control-bearing prompt text must enter as one bracketed-paste
    // transaction so newline and escape bytes are editor content, not keys.
    // The second hook's digest match is the end-to-end fidelity check.
    const payload = /[\r\n\u001b]/.test(prompt)
      ? `\u001b[200~${prompt}\u001b[201~`
      : prompt;
    this.child.write(payload);
    // Ink/React-based TUIs can coalesce a text burst and carriage return into
    // one paste event. A short transport yield keeps submit distinct without
    // using OS-level input automation.
    await new Promise((resolve) => setTimeout(resolve, this.promptSettleMs));
    this.child.write(this.topLevelSubmitSequence);
  }

  write(data) {
    this.child.write(data);
  }

  dispose() {
    this.disposable?.dispose();
    this.exitDisposable?.dispose();
    if (!this.exited) this.child.kill();
  }
}
