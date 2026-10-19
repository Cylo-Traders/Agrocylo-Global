#!/usr/bin/env node
// Check relative destinations against Git's index, including exact filename case.
const fs = require("node:fs");
const path = require("node:path").posix;
const { execFileSync } = require("node:child_process");

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const tracked = new Set(files);
const anchors = new Map();
function documentAnchors(file) {
  if (anchors.has(file)) return anchors.get(file);
  const source = fs.readFileSync(file, "utf8");
  const found = new Set();
  const counts = new Map();
  for (const [, heading] of source.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = heading.toLowerCase().replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "").replace(/ /g, "-");
    const count = counts.get(slug) || 0;
    found.add(count ? `${slug}-${count}` : slug);
    counts.set(slug, count + 1);
  }
  for (const [, id] of source.matchAll(/(?:id|name)=["']([^"']+)["']/g)) found.add(id);
  anchors.set(file, found);
  return found;
}
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
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
    const relative = decodeURIComponent(destination.split(/[?#]/)[0]);
    const target = relative ? path.normalize(path.join(path.dirname(file), relative)) : file;
    if (!tracked.has(target) && !files.some((name) => name.startsWith(`${target}/`))) {
      console.error(`${file}: broken relative link ${destination}`);
      failures++;
    } else if (target.endsWith(".md") && destination.includes("#")) {
      const fragment = decodeURIComponent(destination.split("#")[1]);
      if (fragment && !documentAnchors(target).has(fragment)) {
        console.error(`${file}: broken Markdown anchor ${destination}`);
        failures++;
      }
    }
  }
}
if (failures) process.exitCode = 1;
else console.log("Tracked Markdown relative links: OK");
