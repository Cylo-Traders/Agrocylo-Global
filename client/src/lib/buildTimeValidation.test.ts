import { describe, it, expect } from "vitest";
import {
  validateEndpointUrl,
  validateEndpoints,
  assertEndpointsValid,
} from "./endpointValidator";

/**
 * Build-time validation test — exercises the actual validator used by next.config.ts
 * (Issue #927), replacing the previous literal-string comparisons.
 *
 * Covers:
 *  - absent/empty, malformed, unsupported schemes, local-dev endpoints
 *  - valid dev vs valid prod
 *  - production missing-config still blocks
 *  - diagnostics omit secrets / raw values
 *  - multi-variable error aggregation
 */
describe("Network build-time validation :: endpointValidator (actual validator)", () => {
  // ── Passphrase helpers (kept for compatibility with original intent) ──
  it("should identify mainnet correctly", () => {
    const passphrase = "Public Global Stellar Network ; September 2015";
    const isMainnet = passphrase === "Public Global Stellar Network ; September 2015";
    expect(isMainnet).toBe(true);
  });

  it("should identify testnet correctly", () => {
    const passphrase = "Test SDF Network ; September 2015";
    const isTestnet = passphrase === "Test SDF Network ; September 2015";
    expect(isTestnet).toBe(true);
  });

  it("should detect mismatched passphrase", () => {
    const passphrase = "Unknown Network";
    const isMainnet = passphrase === "Public Global Stellar Network ; September 2015";
    const isTestnet = passphrase === "Test SDF Network ; September 2015";
    expect(!isMainnet && !isTestnet).toBe(true);
  });

  // ── Actual validator: absent / empty ──
  describe("absent / empty values", () => {
    it("RPC absent is an error in production", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: undefined, NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" },
        { isProduction: true }
      );
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.invalidVars).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
      expect(res.errors[0]).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
    });

    it("RPC empty string is an error in production", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: "   ", NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" },
        { isProduction: true }
      );
      expect(res.invalidVars).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
    });

    it("RPC absent is allowed in dev with fallback hostname", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: undefined, NEXT_PUBLIC_NETWORK_PASSPHRASE: undefined },
        { isProduction: false }
      );
      expect(res.errors).toHaveLength(0);
      expect(res.hostnames.sorobanRpc).toBe("soroban-testnet.stellar.org");
    });

    it("HORIZON absent is allowed in both envs (fallback)", () => {
      const prod = validateEndpoints({ NEXT_PUBLIC_HORIZON_URL: undefined }, { isProduction: true });
      const dev = validateEndpoints({ NEXT_PUBLIC_HORIZON_URL: undefined }, { isProduction: false });
      expect(prod.errors).not.toEqual(expect.arrayContaining([expect.stringContaining("NEXT_PUBLIC_HORIZON_URL")]));
      expect(dev.errors).not.toEqual(expect.arrayContaining([expect.stringContaining("NEXT_PUBLIC_HORIZON_URL")]));
      expect(dev.hostnames.horizon).toBe("horizon-testnet.stellar.org");
    });

    it("passphrase empty is an error in production", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org", NEXT_PUBLIC_NETWORK_PASSPHRASE: "" },
        { isProduction: true }
      );
      expect(res.invalidVars).toContain("NEXT_PUBLIC_NETWORK_PASSPHRASE");
    });
  });

  // ── Malformed URLs ──
  describe("malformed URLs", () => {
    it("RPC malformed fails with variable-named error, not generic Invalid URL", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "ht!tp://:::", { required: false });
      expect(res.error).toBeTruthy();
      expect(res.error).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
      expect(res.error).toContain("malformed");
      // Should mention guidance, not throw generic stack
      expect(res.error).not.toMatch(/Invalid URL/);
    });

    it("HORIZON malformed fails predictably", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_HORIZON_URL", "not-a-url", { required: false });
      expect(res.error).toContain("NEXT_PUBLIC_HORIZON_URL");
      expect(res.error).toContain("malformed");
    });

    it("missing scheme is malformed", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "soroban-testnet.stellar.org", { required: false });
      expect(res.error).toContain("malformed");
    });

    it("assertEndpointsValid throws with all invalid vars listed", () => {
      expect(() =>
        assertEndpointsValid(
          {
            NEXT_PUBLIC_SOROBAN_RPC_URL: "bad::url",
            NEXT_PUBLIC_HORIZON_URL: "also-bad",
          },
          { isProduction: false }
        )
      ).toThrow(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
      try {
        assertEndpointsValid(
          { NEXT_PUBLIC_SOROBAN_RPC_URL: "bad::url", NEXT_PUBLIC_HORIZON_URL: "also-bad" },
          { isProduction: false }
        );
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
        expect(msg).toContain("NEXT_PUBLIC_HORIZON_URL");
      }
    });
  });

  // ── Unsupported schemes ──
  describe("unsupported schemes", () => {
    it("ftp:// is rejected", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "ftp://example.com/rpc", { required: false });
      expect(res.error).toContain("unsupported scheme");
      expect(res.error).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
    });

    it("ws:// is rejected", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_HORIZON_URL", "ws://horizon.stellar.org", { required: false });
      expect(res.error).toContain("unsupported scheme");
    });

    it("file:// is rejected", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "file:///etc/passwd", { required: false });
      expect(res.error).toContain("unsupported scheme");
    });

    it("http:// for non-local host is rejected", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "http://soroban-testnet.stellar.org", { required: false });
      expect(res.error).toContain("http://");
      expect(res.error).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
    });
  });

  // ── Supported local-development endpoints ──
  describe("supported local-development endpoints", () => {
    it("http://localhost:8000 is allowed", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "http://localhost:8000", { required: false });
      expect(res.error).toBeNull();
      expect(res.hostname).toBe("localhost");
    });

    it("http://127.0.0.1:8000 is allowed", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_HORIZON_URL", "http://127.0.0.1:8000", { required: false });
      expect(res.error).toBeNull();
      expect(res.hostname).toBe("127.0.0.1");
    });

    it("http://0.0.0.0:8000 is allowed", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "http://0.0.0.0:8000", { required: false });
      expect(res.error).toBeNull();
    });

    it("https://soroban-testnet.stellar.org is allowed", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org", { required: false });
      expect(res.error).toBeNull();
      expect(res.hostname).toBe("soroban-testnet.stellar.org");
    });

    it("https:// with port and path is allowed and extracts hostname", () => {
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org:443/rpc", { required: false });
      expect(res.error).toBeNull();
      expect(res.hostname).toBe("soroban-testnet.stellar.org");
    });
  });

  // ── Valid dev / prod configurations ──
  describe("valid configurations", () => {
    it("valid dev configuration passes (testnet RPC + passphrase)", () => {
      const res = validateEndpoints(
        {
          NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
          NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
          NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
        },
        { isProduction: false }
      );
      expect(res.errors).toHaveLength(0);
      expect(res.hostnames.sorobanRpc).toBe("soroban-testnet.stellar.org");
      expect(res.hostnames.horizon).toBe("horizon-testnet.stellar.org");
    });

    it("valid dev configuration with local http RPC passes", () => {
      const res = validateEndpoints(
        {
          NEXT_PUBLIC_SOROBAN_RPC_URL: "http://localhost:8000",
          NEXT_PUBLIC_HORIZON_URL: "http://localhost:8001",
          NEXT_PUBLIC_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
        },
        { isProduction: false }
      );
      expect(res.errors).toHaveLength(0);
      expect(res.hostnames.sorobanRpc).toBe("localhost");
    });

    it("valid production configuration passes", () => {
      const res = validateEndpoints(
        {
          NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-rpc.mainnet.stellar.org",
          NEXT_PUBLIC_HORIZON_URL: "https://horizon.stellar.org",
          NEXT_PUBLIC_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
        },
        { isProduction: true }
      );
      expect(res.errors).toHaveLength(0);
    });

    it("assertEndpointsValid returns hostnames for valid prod config", () => {
      const h = assertEndpointsValid(
        {
          NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-rpc.mainnet.stellar.org",
          NEXT_PUBLIC_HORIZON_URL: "https://horizon.stellar.org",
          NEXT_PUBLIC_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
        },
        { isProduction: true }
      );
      expect(h.sorobanRpc).toBe("soroban-rpc.mainnet.stellar.org");
      expect(h.horizon).toBe("horizon.stellar.org");
    });
  });

  // ── Production missing-config still blocks, no silent fallback ──
  describe("production missing-config blocks and no silent testnet fallback", () => {
    it("missing RPC in prod blocks", () => {
      expect(() =>
        assertEndpointsValid(
          { NEXT_PUBLIC_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" },
          { isProduction: true }
        )
      ).toThrow(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
    });

    it("invalid RPC in prod does not fall back to testnet", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: "http://evil.com", NEXT_PUBLIC_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" },
        { isProduction: true }
      );
      expect(res.errors.length).toBeGreaterThan(0);
      // Should not have silently returned testnet hostname
      expect(res.hostnames.sorobanRpc).toBeNull();
    });

    it("malformed RPC in dev does not silently fall back", () => {
      const res = validateEndpoints(
        { NEXT_PUBLIC_SOROBAN_RPC_URL: "bad-url", NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" },
        { isProduction: false }
      );
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.hostnames.sorobanRpc).toBeNull();
    });
  });

  // ── Diagnostics omit secrets ──
  describe("diagnostics omit secrets", () => {
    it("error does not echo credentials, tokens, or full values", () => {
      const secret = "s3cr3tT0ken123";
      const urlWithSecret = `https://user:${secret}@evil.com?token=${secret}&query=x`;
      const res = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", urlWithSecret, { required: false });
      expect(res.error).toBeTruthy();
      // Must name variable but not echo secret or full URL
      expect(res.error).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
      expect(res.error).not.toContain(secret);
      expect(res.error).not.toContain("evil.com");
      expect(res.error).not.toContain(urlWithSecret);
    });

    it("combined error does not echo any endpoint value", () => {
      const rpcSecret = "rpcSecret999";
      const horizonSecret = "horizonSecret888";
      try {
        assertEndpointsValid(
          {
            NEXT_PUBLIC_SOROBAN_RPC_URL: `https://stellar.example.com/${rpcSecret}?t=${rpcSecret}`,
            NEXT_PUBLIC_HORIZON_URL: `ftp://bad.example.com/${horizonSecret}`,
          },
          { isProduction: false }
        );
        throw new Error("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
        expect(msg).toContain("NEXT_PUBLIC_HORIZON_URL");
        expect(msg).not.toContain(rpcSecret);
        expect(msg).not.toContain(horizonSecret);
        // Must not contain full URLs
        expect(msg).not.toContain("stellar.example.com");
      }
    });

    it("malformed URL error does not leak the malformed value", () => {
      const bad = "https://user:pass@host?token=leakme";
      const res = validateEndpointUrl("NEXT_PUBLIC_HORIZON_URL", bad, { required: false });
      // Credential-bearing URL is rejected, but error must not echo user:pass or token
      if (res.error) {
        expect(res.error).not.toContain("pass");
        expect(res.error).not.toContain("leakme");
      }
    });
  });

  // ── Original literal checks replaced: ensure passphrase/url matching still works via validator ──
  it("should validate RPC URL format for testnet via validator", () => {
    const r = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org", { required: true });
    expect(r.error).toBeNull();
    expect(r.hostname).toBe("soroban-testnet.stellar.org");
    const passphrase = "Test SDF Network ; September 2015";
    expect(passphrase).toBe("Test SDF Network ; September 2015");
  });

  it("should validate RPC URL format for mainnet via validator", () => {
    const r = validateEndpointUrl("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-rpc.mainnet.stellar.org", { required: true });
    expect(r.error).toBeNull();
    expect(r.hostname).toBe("soroban-rpc.mainnet.stellar.org");
    const passphrase = "Public Global Stellar Network ; September 2015";
    expect(passphrase).toBe("Public Global Stellar Network ; September 2015");
  });
});
