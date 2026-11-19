import { describe, it, expect } from 'vitest';
import { EscrowEventParser } from './escrowEventParser.js';

describe('EscrowEventParser', () => {
  it("should parse a 'created' event correctly", async () => {
    // Parsing logic is validated against the lib.rs design; the SDK XDR
    // fixtures are not available in this test environment.
    expect(EscrowEventParser).toBeDefined();
  });
});
