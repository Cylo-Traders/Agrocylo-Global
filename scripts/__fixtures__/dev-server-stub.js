"use strict";

/**
 * Stand-in for `next dev` used by the smoke-harness tests: a real HTTP server
 * on a real port, with failure modes the harness has to detect.
 *
 *   node scripts/__fixtures__/dev-server-stub.js <port> [ok|fail|crash|slow|nomarker]
 */

const http = require("http");

const port = Number(process.argv[2] || 3000);
const mode = process.argv[3] || "ok";
const startedAt = Date.now();

const server = http.createServer((req, res) => {
  if (mode === "fail") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Error: build failed\n");
    return;
  }
  if (mode === "slow" && Date.now() - startedAt < 3000) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("still compiling\n");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(
    mode === "nomarker"
      ? "<html><body>placeholder</body></html>"
      : "<html><body><h1>AgroCylo marketplace</h1></body></html>",
  );
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`stub listening on ${port} (${mode})\n`);
  if (mode === "crash") {
    setTimeout(() => {
      server.close();
      process.exit(3);
    }, 300);
  }
});
