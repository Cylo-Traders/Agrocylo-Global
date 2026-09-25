#!/usr/bin/env node

const net = require("node:net");
const { spawn } = require("node:child_process");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readPort(args, env, appName, defaultPort) {
  const forwardedArgs = [];
  let cliPort;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port" || argument === "-p") {
      cliPort = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=")) {
      cliPort = argument.slice("--port=".length);
      continue;
    }
    forwardedArgs.push(argument);
  }

  const appPortVariable = `${appName.toUpperCase().replace(/-/g, "_")}_PORT`;
  const rawPort = cliPort ?? env[appPortVariable] ?? env.PORT ?? defaultPort;
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `[${appName}] Invalid port ${JSON.stringify(rawPort)}. ` +
        "Use an integer from 1 through 65535.",
    );
  }

  return { port, forwardedArgs, appPortVariable };
}

function assertPortAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function main() {
  const [appName, defaultPort, ...args] = process.argv.slice(2);
  if (!appName || !defaultPort) {
    throw new Error(
      "Usage: dev-frontend.cjs <app-name> <default-port> [Next.js arguments]",
    );
  }

  const { port, forwardedArgs, appPortVariable } = readPort(
    args,
    process.env,
    appName,
    defaultPort,
  );

  try {
    await assertPortAvailable(port);
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      throw new Error(
        `[${appName}] Port ${port} is already in use. Stop the process using it, ` +
          `or choose another port with \`npm run dev:${appName} -- --port ${port + 100}\` ` +
          `(or set ${appPortVariable}).`,
      );
    }
    throw error;
  }

  const nextBin = require.resolve("next/dist/bin/next", {
    paths: [process.cwd()],
  });
  console.log(
    `[${appName}] Starting at http://localhost:${port} ` +
      `(override with --port or ${appPortVariable})`,
  );

  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(port), ...forwardedArgs],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit",
    },
  );

  child.once("error", (error) => fail(`[${appName}] Failed to start: ${error.message}`));
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  main().catch((error) => fail(error.message));
}

module.exports = { assertPortAvailable, readPort };
