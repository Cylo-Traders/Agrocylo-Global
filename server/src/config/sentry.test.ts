import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sentryInit = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/node", () => ({
  init: sentryInit,
  captureMessage,
  captureException: vi.fn(),
  setTag: vi.fn(),
  expressIntegration: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
}));

describe("sentry config — without a DSN configured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("initSentry does not call Sentry.init when SENTRY_DSN is empty", async () => {
    vi.doMock("./index.js", () => ({ config: { sentryDsn: "", nodeEnv: "test", sentryTracesSampleRate: 0.1 } }));
    const { initSentry } = await import("./sentry.js");
    initSentry();
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("captureAlert logs but does not call Sentry.captureMessage when unconfigured", async () => {
    vi.doMock("./index.js", () => ({ config: { sentryDsn: "", nodeEnv: "test", sentryTracesSampleRate: 0.1 } }));
    const { captureAlert } = await import("./sentry.js");
    captureAlert("test_alert", "something happened");
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe("sentry config — with a DSN configured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("initSentry calls Sentry.init with the configured DSN", async () => {
    vi.doMock("./index.js", () => ({
      config: { sentryDsn: "https://example@sentry.io/1", nodeEnv: "production", sentryTracesSampleRate: 0.2 },
    }));
    const { initSentry } = await import("./sentry.js");
    initSentry();
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://example@sentry.io/1", environment: "production" }),
    );
  });

  it("captureAlert reports to Sentry tagged with alert_type", async () => {
    vi.doMock("./index.js", () => ({
      config: { sentryDsn: "https://example@sentry.io/1", nodeEnv: "production", sentryTracesSampleRate: 0.2 },
    }));
    const { captureAlert } = await import("./sentry.js");
    captureAlert("reconciliation_drift", "3 transactions drifted", { drifted: 3 });
    expect(captureMessage).toHaveBeenCalledWith(
      "3 transactions drifted",
      expect.objectContaining({
        level: "error",
        tags: { alert_type: "reconciliation_drift" },
        extra: { drifted: 3 },
      }),
    );
  });
});
