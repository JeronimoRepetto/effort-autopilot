const readline = require("node:readline");

let effort = "high";
let requests = 0;

process.stdout.write("MODEL claude-sonnet-5\r\nSTATE top-level-prompt\r\n");

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (raw) => {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("/effort ")) {
    effort = line.slice("/effort ".length);
    process.stdout.write(`Set effort level to ${effort} (this session only)\r\n`);
    process.stdout.write("STATE top-level-prompt\r\n");
    return;
  }
  if (line === "/exit") {
    process.stdout.write("EXIT\r\n");
    process.exit(0);
  }
  requests += 1;
  process.stdout.write(
    `MODEL_REQUEST count=${requests} effort=${effort} prompt_b64=${Buffer.from(line).toString("base64")}\r\n`,
  );
  process.stdout.write("STATE top-level-prompt\r\n");
});
