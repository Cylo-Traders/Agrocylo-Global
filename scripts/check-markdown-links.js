#!/usr/bin/env node
// Check relative destinations against Git's index, including exact filename case.
const fs = require("node:fs");
const path = require("node:path").posix;
const { execFileSync } = require("node:child_process");

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const tracked = new Set(files);
let failures = 0;
for (const file of files.filter((name) => name.endsWith(".md"))) {
  if (!fs.existsSync(file)) continue;
  const markdown = fs.readFileSync(file, "utf8")
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const destinations = [
    ...markdown.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\)/g),
    ...markdown.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
    ...markdown.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ];
  for (const [, destination] of destinations) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(destination)) continue;
    const relative = decodeURIComponent(destination.split(/[?#]/)[0]);
    if (!relative) continue;
    const target = path.normalize(path.join(path.dirname(file), relative));
    if (!tracked.has(target) && !files.some((name) => name.startsWith(`${target}/`))) {
      console.error(`${file}: broken relative link ${destination}`);
      failures++;
    }
  }
}
if (failures) process.exitCode = 1;
else console.log("Tracked Markdown relative links: OK");
