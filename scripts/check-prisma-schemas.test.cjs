const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validatePrismaSchemaSource } = require("./check-prisma-schemas.cjs");

test("agro-production/server/prisma/schema.prisma defines Product and passes referential check (#744)", () => {
  const schemaPath = path.join(
    __dirname,
    "..",
    "agro-production",
    "server",
    "prisma",
    "schema.prisma",
  );
  const content = fs.readFileSync(schemaPath, "utf8");
  const result = validatePrismaSchemaSource(
    content,
    "agro-production/server/prisma/schema.prisma",
  );
  assert.equal(result.valid, true, `Unexpected schema errors: ${result.errors.join("; ")}`);
  assert.match(content, /model\s+Product\s*\{/);
});

test("validatePrismaSchemaSource catches dangling Product[] relation (P1012 regression #744)", () => {
  const brokenSchema = `
    datasource db {
      provider = "postgresql"
    }
    model Campaign {
      id       String    @id @default(uuid())
      products Product[]
    }
  `;
  const result = validatePrismaSchemaSource(brokenSchema, "broken.prisma");
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /references undefined type "Product" \(P1012\)/);
});
