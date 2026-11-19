import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { registerProductionServiceWorker } from "./pwaSetup";

describe("production PWA shell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes an installable manifest identity and maskable icon", () => {
    const appManifest = manifest();
    expect(appManifest.name).toBe("Agrocylo Production");
    expect(appManifest.display).toBe("standalone");
    expect(appManifest.icons?.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
  });

  it("does not register a service worker outside production", async () => {
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubEnv("NODE_ENV", "development");

    expect(await registerProductionServiceWorker()).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the shell worker in production", async () => {
    const registration = { scope: "/" };
    const register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubEnv("NODE_ENV", "production");

    await expect(registerProductionServiceWorker()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });
});
