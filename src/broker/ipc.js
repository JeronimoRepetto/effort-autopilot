import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MAX_MESSAGE_BYTES = 1024 * 1024 + 16 * 1024;

// POSIX sockaddr_un.sun_path holds 104 bytes on macOS (103 usable, the
// smallest common limit; Linux allows 108). Exceeding it makes bind() silently
// truncate the path, which surfaces one call later as a misleading ENOENT
// (issue #18) — so the byte length is guarded explicitly and the basename is
// kept short: macOS's per-user $TMPDIR alone is ~49 characters.
const MAX_SUN_PATH_BYTES = 103;

export function createIpcIdentity({
  platform = process.platform,
  tmpdir = os.tmpdir(),
  pid = process.pid,
} = {}) {
  return Object.freeze({
    endpoint:
      platform === "win32"
        ? `\\\\.\\pipe\\effort-autopilot-${pid}-${randomUUID()}`
        : path.posix.join(tmpdir, `ea-${pid}-${randomBytes(4).toString("hex")}.sock`),
    token: randomBytes(32).toString("base64url"),
  });
}

function tokenMatches(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicResponse(coordinator, message) {
  if (message.event === "SessionStart") {
    const registered = coordinator.registerSession({
      sessionId: message.sessionId,
      model: message.model,
      cwd: message.cwd,
    });
    return { ok: true, action: "continue", ...registered };
  }
  if (message.event === "UserPromptSubmit") {
    return {
      ok: true,
      ...coordinator.handleUserPromptSubmit({
        sessionId: message.sessionId,
        prompt: message.prompt,
        promptId: message.promptId,
        cwd: message.cwd,
      }),
    };
  }
  if (message.event === "DiagnosticGuard") {
    return { ok: true, action: "observed", diagnosticGuard: true };
  }
  return { ok: false, errorCode: "unsupported-event" };
}

export async function startBrokerIpcServer({
  endpoint,
  token,
  coordinator,
  onBlocked,
  onDecision,
  // Test seams; production callers rely on the defaults.
  platform = process.platform,
  fsOps = { chmod, rm },
}) {
  if (!endpoint || !token || !coordinator) throw new TypeError("missing IPC server option");
  if (platform !== "win32") {
    if (Buffer.byteLength(endpoint) > MAX_SUN_PATH_BYTES) {
      throw new Error(
        `ipc-endpoint-too-long: the socket path exceeds the ${MAX_SUN_PATH_BYTES}-byte sun_path limit`,
      );
    }
    await fsOps.rm(endpoint, { force: true });
  }

  const server = net.createServer((socket) => {
    let raw = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length > MAX_MESSAGE_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, errorCode: "message-too-large" })}\n`);
        return;
      }
      const newline = raw.indexOf(0x0a);
      if (newline < 0) return;
      const frame = raw.subarray(0, newline).toString("utf8");
      raw = Buffer.alloc(0);
      try {
        const message = JSON.parse(frame);
        if (!tokenMatches(message.token, token)) {
          socket.end(`${JSON.stringify({ ok: false, errorCode: "unauthorized" })}\n`);
          return;
        }
        const response = publicResponse(coordinator, message);
        socket.end(`${JSON.stringify(response)}\n`);
        queueMicrotask(() =>
          onDecision?.({
            event: message.event,
            sessionId: message.sessionId,
            action: response.action,
            authorizedReplay: response.authorizedReplay === true,
            diagnostic: response.diagnostic === true,
            diagnosticGuard: response.diagnosticGuard === true,
            ticketId: response.ticketId ?? null,
          }),
        );
        if (response.ticketId) queueMicrotask(() => onBlocked?.({ ticketId: response.ticketId }));
      } catch {
        socket.end(`${JSON.stringify({ ok: false, errorCode: "malformed-message" })}\n`);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  // A failure after listen() must never leak the listening handle (it keeps
  // the event loop — and the test runner — alive forever) or the socket file.
  try {
    if (platform !== "win32") await fsOps.chmod(endpoint, 0o600);
  } catch (error) {
    await new Promise((resolve) => server.close(() => resolve()));
    if (platform !== "win32") await fsOps.rm(endpoint, { force: true }).catch(() => {});
    throw error;
  }

  return Object.freeze({
    endpoint,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (platform !== "win32") await fsOps.rm(endpoint, { force: true });
    },
  });
}

export function callBrokerIpc({ endpoint, token, message, timeoutMs = 1000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let raw = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("ipc-timeout"));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ ...message, token })}\n`);
    });
    socket.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
        socket.destroy(new Error("ipc-response-too-large"));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.trim()));
      } catch {
        reject(new Error("malformed-ipc-response"));
      }
    });
  });
}
