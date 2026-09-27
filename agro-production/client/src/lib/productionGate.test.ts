/**
 * Production feature gate (issue #1038) — regression tests.
 *
 * The original failure was a redirect loop: the root layout redirected to `/`,
 * and `/` renders through that same layout. These tests pin the resolution
 * rules and assert that the gate never produces a redirect target, so
 * reintroducing a self-redirect fails here rather than in a browser.
 */
import { describe, it, expect } from "vitest";
import { PRODUCTION_FLAG_VALUE, resolveProductionGate } from "./productionGate";

describe("resolveProductionGate", () => {
  describe("production build", () => {
    it("is enabled only when the flag is exactly 'true'", () => {
      const gate = resolveProductionGate(
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: PRODUCTION_FLAG_VALUE },
        "production",
      );
      expect(gate.enabled).toBe(true);
      expect(gate.status).toBe("enabled");
      expect(gate.isProduction).toBe(true);
    });

    it("is disabled when the flag is missing", () => {
      const gate = resolveProductionGate({}, "production");
      expect(gate.enabled).toBe(false);
      expect(gate.status).toBe("disabled");
      expect(gate.reason).toContain("not set");
    });

    // Regression guard: this was the blank-client bug. The gate must resolve to
    // a rendered state, never to a redirect, and certainly never to '/'.
    it("never produces a redirect, so no state can loop", () => {
      const states = [
        {},
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "" },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "1" },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "yes" },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "TRUE" },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "true " },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "false" },
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: PRODUCTION_FLAG_VALUE },
      ];
      for (const env of states) {
        const gate = resolveProductionGate(env, "production");
        // A redirect target would have to be a field here; there is none, and
        // that is the property under test.
        expect(gate).not.toHaveProperty("redirect");
        expect(gate).not.toHaveProperty("redirectTo");
        expect(["enabled", "disabled"]).toContain(gate.status);
      }
    });

    it.each(["1", "yes", "TRUE", "True", "true ", " true", "on", "enabled"])(
      "treats near-miss value %j as disabled",
      (value) => {
        const gate = resolveProductionGate(
          { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: value },
          "production",
        );
        expect(gate.enabled).toBe(false);
      },
    );

    it("names the expected value in the reason without echoing the value", () => {
      const gate = resolveProductionGate(
        { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "a".repeat(500) },
        "production",
      );
      expect(gate.reason).toContain(PRODUCTION_FLAG_VALUE);
      // A malformed value can be arbitrarily long; the reason is rendered in
      // the DOM, so it must not echo it back.
      expect(gate.reason).not.toContain("a".repeat(500));
    });
  });

  describe("non-production build", () => {
    it("never gates, regardless of the flag", () => {
      for (const nodeEnv of ["development", "test", undefined]) {
        const gate = resolveProductionGate({}, nodeEnv);
        expect(gate.enabled).toBe(true);
        expect(gate.isProduction).toBe(false);
      }
    });

    it("does not report a dev build as a disabled production build", () => {
      const gate = resolveProductionGate({}, "development");
      expect(gate.status).toBe("enabled");
      expect(gate.isProduction).toBe(false);
    });
  });

  describe("purity", () => {
    it("does not mutate the environment it is given", () => {
      const env = { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: "1" };
      const snapshot = { ...env };
      resolveProductionGate(env, "production");
      expect(env).toEqual(snapshot);
    });

    it("returns the same decision for the same input", () => {
      const env = { NEXT_PUBLIC_AGRO_PRODUCTION_ENABLED: PRODUCTION_FLAG_VALUE };
      const a = resolveProductionGate(env, "production");
      const b = resolveProductionGate(env, "production");
      expect(a).toEqual(b);
    });
  });
});
