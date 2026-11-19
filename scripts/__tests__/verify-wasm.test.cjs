const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SCRIPT = path.join(__dirname, "..", "verify-wasm.sh");
const REPO_ROOT = path.join(__dirname, "..", "..");
const ZERO = "0".repeat(64);

function run(args, env = {}) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

const dockerAvailable = (() => {
  try {
    return spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();


test("--list prints every workspace contract, including the marketplace escrow", () => {
  const { code, out } = run(["--list"]);
  assert.equal(code, 0);
  const names = out.trim().split("\n").sort();
  assert.deepEqual(names, [
    "escrow",
    "governance",
    "investment_basket",
    "production_escrow",
    "registry",
  ]);
});

test("no arguments prints usage and exits 2", () => {
  const { code, out } = run([]);
  assert.equal(code, 2);
  assert.match(out, /verify-wasm\.sh <contract_name> <on_chain_hash>/);
  assert.match(out, /Usage:/);
});

test("rejects a malformed on-chain hash before running any build", () => {
  for (const bad of ["abc", "", ZERO.slice(1), "z".repeat(64), "  " + ZERO]) {
    const { code, out } = run(["escrow", bad]);
    assert.equal(code, 2, `hash ${JSON.stringify(bad)} passed`);
    assert.match(out, /64-character hex string/);
    assert.doesNotMatch(out, /Building/);
  }
});

test("rejects an unknown or malformed contract name", () => {
  for (const bad of ["bogus", "../escrow", "ESCROW", "escrow;"]) {
    const { code, out } = run([bad, ZERO]);
    assert.equal(code, 2, `${bad} accepted`);
    assert.match(out, /unsupported contract|contract_name must match/);
  }
});

test("rejects a missing hash argument", () => {
  const { code } = run(["escrow"]);
  assert.equal(code, 2);
});

test("never prints VERIFIED in the argument-validation path", () => {
  const { out } = run(["escrow", "0x" + "F".repeat(64)]);
  assert.doesNotMatch(out, /VERIFIED/);
});

// The real contract: a hash that is NOT the build output must report the build
// output, never "VERIFIED". Skipped when no Docker daemon is reachable, since the
// verification is defined as a pinned build.

test("negative path reports MISMATCH (or a hard error) against a tampered hash", { skip: !dockerAvailable }, () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-wasm-repo-"));
  fs.mkdirSync(path.join(repoDir, "contracts", "governance"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "Cargo.toml"), 'members = ["contracts/governance"]\n');
  fs.writeFileSync(path.join(repoDir, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.89.0"\n');
  fs.writeFileSync(path.join(repoDir, "contracts", "governance", "Cargo.toml"), "[package]\nname = \"governance\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
  fs.writeFileSync(
    path.join(repoDir, "contracts", "governance", "lib.rs"),
    '#![no_std]\n#[panic_handler]\nfn panic(_: &core::panic::PanicInfo) -> ! { loop {} }\n#[no_mangle]\npub extern "C" fn entry() -> u32 { 7 }\n',
  );
  const negative = path.join(repoDir, "scripts", "verify-wasm.sh");
  fs.mkdirSync(path.dirname(negative), { recursive: true });
  fs.copyFileSync(SCRIPT, negative);

  const result = spawnSync("bash", [negative, "governance", "f".repeat(64)], { encoding: "utf8" });
  const out = result.stdout + result.stderr;
  assert.notEqual(result.status, 0, "a tampered hash must never exit 0");
  assert.doesNotMatch(out, /^VERIFIED/m);
  assert.match(out, /MISMATCH|Error:/);
});
