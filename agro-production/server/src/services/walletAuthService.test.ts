import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const { mockAuthNonceCreate, mockAuthNonceFindUnique } = vi.hoisted(() => ({
  mockAuthNonceCreate: vi.fn(),
  mockAuthNonceFindUnique: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    authNonce: {
      create: mockAuthNonceCreate,
      findUnique: mockAuthNonceFindUnique,
    },
  },
}));

vi.mock("../config/index.js", () => ({
  config: {
    jwtSecret: "test-secret-at-least-32-chars-long!!",
  },
}));

const { verifyHandoffAndCreateSession } = await import("./walletAuthService.js");

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";
const HANDOFF_AUDIENCE = "agrocylo-sso-handoff";
const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function signHandoffToken(
  overrides: {
    walletAddress?: string;
    audience?: string;
    expiresIn?: jwt.SignOptions["expiresIn"];
    secret?: string;
  } = {},
): string {
  return jwt.sign(
    { walletAddress: overrides.walletAddress ?? WALLET },
    overrides.secret ?? JWT_SECRET,
    {
      expiresIn: overrides.expiresIn ?? "60s",
      audience: overrides.audience ?? HANDOFF_AUDIENCE,
      jwtid: "fixed-jti-for-test",
    },
  );
}

describe("verifyHandoffAndCreateSession (Issue #686)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthNonceCreate.mockResolvedValue({});
  });

  it("establishes a session for a validly signed, fresh token", async () => {
    const token = signHandoffToken();
    const session = await verifyHandoffAndCreateSession(token);

    expect(session.walletAddress).toBe(WALLET);
    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.sessionToken).toEqual(expect.any(String));
    // Consumes the jti (replay guard) and issues a session token.
    expect(mockAuthNonceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nonce: "fixed-jti-for-test", audience: "sso-handoff" }),
      }),
    );
    expect(mockAuthNonceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ audience: "session" }) }),
    );
  });

  it("rejects a token forged with the wrong secret", async () => {
    const forged = signHandoffToken({ secret: "a-completely-different-secret-value!!" });
    await expect(verifyHandoffAndCreateSession(forged)).rejects.toMatchObject({
      status: 401,
    });
    expect(mockAuthNonceCreate).not.toHaveBeenCalled();
  });

  it("rejects a token missing the handoff audience claim", async () => {
    const wrongAudience = signHandoffToken({ audience: "some-other-audience" });
    await expect(verifyHandoffAndCreateSession(wrongAudience)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an expired token", async () => {
    const expired = signHandoffToken({ expiresIn: "-1s" });
    await expect(verifyHandoffAndCreateSession(expired)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a replayed token (jti already consumed)", async () => {
    // Simulate the unique-constraint violation the DB raises on a repeat jti.
    mockAuthNonceCreate.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`nonce`)"), { code: "P2002" }),
    );

    const token = signHandoffToken();
    await expect(verifyHandoffAndCreateSession(token)).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("already used"),
    });
  });

  it("propagates a non-replay DB error instead of masking it as a replay", async () => {
    mockAuthNonceCreate.mockRejectedValueOnce(new Error("connection reset"));

    const token = signHandoffToken();
    await expect(verifyHandoffAndCreateSession(token)).rejects.toThrow("connection reset");
  });
});
