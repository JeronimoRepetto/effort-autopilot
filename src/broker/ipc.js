import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MAX_MESSAGE_BYTES = 1024 * 1024 + 16 * 1024;

export function createIpcIdentity() {
  const id = randomUUID();
  return Object.freeze({
    endpoint:
      process.platform === "win32"
        ? `\\\\.\\pipe\\effort-autopilot-${process.pid}-${id}`
        : path.join(os.tmpdir(), `effort-autopilot-${process.pid}-${id}.sock`),
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
    return { ok: true, ...coordinator.handleUserPromptSubmit({
      sessionId: message.sessionId,
      prompt: message.prompt,
      promptId: message.promptId,
      cwd: message.cwd,
    }) };
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
}) {
  if (!endpoint || !token || !coordinator) throw new TypeError("missing IPC server option");
  if (process.platform !== "win32") await rm(endpoint, { force: true });

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
        queueMicrotask(() => onDecision?.({
          event: message.event,
          sessionId: message.sessionId,
          action: response.action,
          authorizedReplay: response.authorizedReplay === true,
          diagnostic: response.diagnostic === true,
          diagnosticGuard: response.diagnosticGuard === true,
          ticketId: response.ticketId ?? null,
        }));
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
  if (process.platform !== "win32") await chmod(endpoint, 0o600);

  return Object.freeze({
    endpoint,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (process.platform !== "win32") await rm(endpoint, { force: true });
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
