#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const NODE_RANGE = ">=22.13.0 <23";
const NPM_RANGE = ">=10.9.0 <11";

function parseVersion(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return match.slice(1).map(Number);
}

function isAtLeast(version, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

function isSupportedNode(version) {
  const parsed = parseVersion(version);
  return Boolean(parsed && parsed[0] === 22 && isAtLeast(parsed, [22, 13, 0]));
}

function isSupportedNpm(version) {
  const parsed = parseVersion(version);
  return Boolean(parsed && parsed[0] === 10 && isAtLeast(parsed, [10, 9, 0]));
}

function npmVersion() {
  const userAgentMatch = process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/);
  if (userAgentMatch) return userAgentMatch[1];

  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  return execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
}

function validateToolchain(nodeVersion, currentNpmVersion) {
  const errors = [];
  if (!isSupportedNode(nodeVersion)) {
    errors.push(
      `Unsupported Node.js ${nodeVersion}; required ${NODE_RANGE}. Run \`nvm use\` from the repository root.`,
    );
  }
  if (!isSupportedNpm(currentNpmVersion)) {
    errors.push(
      `Unsupported npm ${currentNpmVersion}; required ${NPM_RANGE}. The tested version is npm 10.9.2.`,
    );
  }
  return errors;
}

function main() {
  const currentNpmVersion = npmVersion();
  const errors = validateToolchain(process.versions.node, currentNpmVersion);
  if (errors.length > 0) {
    console.error(["Frontend toolchain check failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Frontend toolchain OK: Node.js ${process.versions.node}, npm ${currentNpmVersion}`,
  );
}

if (require.main === module) main();

module.exports = {
  isSupportedNode,
  isSupportedNpm,
  parseVersion,
  validateToolchain,
};
