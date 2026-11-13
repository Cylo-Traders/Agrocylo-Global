#!/usr/bin/env node
/**
 * Prisma Schema Referential Integrity & Validation Gate (Issue #744).
 *
 * Ensures every field type in `server/prisma/schema.prisma` and
 * `agro-production/server/prisma/schema.prisma` resolves to either a Prisma
 * scalar type or a `model` / `enum` / `type` declared in the same schema file,
 * preventing P1012 dangling-model errors from cascading through CI.
 */

const fs = require("node:fs");
const path = require("node:path");

const PRISMA_SCALARS = new Set([
  "String",
  "Boolean",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "DateTime",
  "Json",
  "Bytes",
  "Unsupported",
]);

function validatePrismaSchemaSource(source, label = "schema.prisma") {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const definedTypes = new Set(PRISMA_SCALARS);
  const models = [];

  let currentBlock = null;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;

    const blockStart = /^(model|enum|type)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
    if (blockStart) {
      const [, kind, name] = blockStart;
      definedTypes.add(name);
      if (kind === "model") {
        currentBlock = { name, startLine: i + 1, fields: [] };
        models.push(currentBlock);
      } else {
        currentBlock = null;
      }
      continue;
    }

    if (line === "}") {
      currentBlock = null;
      continue;
    }

    if (currentBlock) {
      if (line.startsWith("@@")) continue;
      const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\]|\?)?/.exec(line);
      if (fieldMatch) {
        const [, fieldName, fieldType, modifier] = fieldMatch;
        currentBlock.fields.push({
          fieldName,
          fieldType,
          modifier: modifier || "",
          line: i + 1,
          raw: line,
        });
      }
    }
  }

  const errors = [];
  for (const model of models) {
    for (const field of model.fields) {
      if (!definedTypes.has(field.fieldType)) {
        errors.push(
          `${label}:${field.line}: Model "${model.name}" field "${field.fieldName}" references undefined type "${field.fieldType}" (P1012)`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, modelCount: models.length };
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const schemaPaths = [
    "server/prisma/schema.prisma",
    "agro-production/server/prisma/schema.prisma",
  ];

  let hasErrors = false;
  for (const rel of schemaPaths) {
    const full = path.join(repoRoot, rel);
    const content = fs.readFileSync(full, "utf8");
    const result = validatePrismaSchemaSource(content, rel);
    if (!result.valid) {
      hasErrors = true;
      for (const err of result.errors) {
        console.error(`ERROR: ${err}`);
      }
    } else {
      console.log(`${rel}: OK (${result.modelCount} models validated)`);
    }
  }

  if (hasErrors) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { validatePrismaSchemaSource };
