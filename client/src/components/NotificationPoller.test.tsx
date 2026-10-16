import React from "react";
import { render, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NotificationPoller from "./NotificationPoller";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockListUnreadNotifications = vi.fn();
const mockMarkNotificationsRead = vi.fn();
const mockShowOrderEventToast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// useWallet is controlled per-test via the `walletState` object so we can
// simulate account changes without re-importing the module.
const walletState = {
  address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" as
    string | null,
  connected: true,
};

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ ...walletState }),
}));

vi.mock("@/services/notification/api", () => ({
  listUnreadNotifications: (...args: unknown[]) =>
    mockListUnreadNotifications(...args),
  markNotificationsRead: (...args: unknown[]) =>
    mockMarkNotificationsRead(...args),
}));

vi.mock("@/services/notification", () => ({
  showOrderEventToast: (...args: unknown[]) => mockShowOrderEventToast(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WALLET_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const WALLET_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC";

const POLL_INTERVAL_MS = 15_000;

function makeNotification(id: string, orderId = "42") {
  return {
    id,
    walletAddress: walletState.address ?? WALLET_A,
    message: `Notification ${id}`,
    orderId,
    type: "created",
    isRead: false,
    createdAt: "2026-04-24T12:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("NotificationPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    walletState.address = WALLET_A;
    walletState.connected = true;
    // Restore document.visibilityState to visible so interval ticks are not
    // suppressed during tests.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Baseline — existing behaviour preserved
  // -------------------------------------------------------------------------

  it("polls unread notifications, shows a toast, and wires navigation to the order page", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    render(<NotificationPoller />);

    await waitFor(() => {
      expect(mockListUnreadNotifications).toHaveBeenCalledWith(WALLET_A);
    });

    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);
    expect(mockMarkNotificationsRead).toHaveBeenCalledWith(WALLET_A, ["n1"]);

    const openOrder = mockShowOrderEventToast.mock.calls[0]?.[1];
    expect(typeof openOrder).toBe("function");
    openOrder("42");
    expect(mockPush).toHaveBeenCalledWith("/orders/42");
  });

  // -------------------------------------------------------------------------
  // AC-1 / AC-2: failed ack retried on next poll — no duplicate toast
  // -------------------------------------------------------------------------

  it("retries a failed acknowledgement on the next poll without re-showing the toast", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    // First ack attempt fails transiently.
    mockMarkNotificationsRead.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    // Second attempt succeeds.
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    render(<NotificationPoller />);

    // First poll: toast shown, ack fails.
    await waitFor(() =>
      expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1),
    );
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1);

    // Subsequent polls return the same notification (still unread on server
    // because ack failed), but the toast must NOT fire again.
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);

    // Advance clock to trigger the next poll interval.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(2),
    );

    // Toast was only shown once despite two polls returning the same item.
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);

    // The second ack call carries the same ID.
    expect(mockMarkNotificationsRead).toHaveBeenNthCalledWith(2, WALLET_A, [
      "n1",
    ]);
  });

  // -------------------------------------------------------------------------
  // AC-2: retry fires even when all fetched notifications are already toasted
  // -------------------------------------------------------------------------

  it("retries pending ack when every fetched notification is already in the toast-dedup set", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    // First ack fails.
    mockMarkNotificationsRead.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    // Retry succeeds.
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    render(<NotificationPoller />);

    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1),
    );
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);

    // Next poll: list still returns n1 (server hasn't seen the ack), but
    // n1 is already in shownToastIds — untoasted set will be empty.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    // Pending ack must have been flushed even though untoasted was empty.
    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(2),
    );
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1); // still only once
  });

  // -------------------------------------------------------------------------
  // AC-3: successfully acknowledged IDs leave pending and don't re-POST
  // -------------------------------------------------------------------------

  it("does not re-POST IDs that were successfully acknowledged", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    render(<NotificationPoller />);

    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1),
    );

    // After success, the next two polls find n1 already toasted and already
    // acked — no further markNotificationsRead calls should occur.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    // list returns empty after the first poll (server marks it read).
    mockListUnreadNotifications.mockResolvedValue([]);

    await waitFor(() =>
      expect(mockListUnreadNotifications).toHaveBeenCalledTimes(3),
    );
    // Still exactly one ack call — no redundant POSTs.
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Prolonged failure: bounded backoff, no hot retry loop
  // -------------------------------------------------------------------------

  it("applies bounded backoff and does not loop endlessly on repeated ack failure", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    // All ack attempts fail.
    mockMarkNotificationsRead.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    render(<NotificationPoller />);

    // First poll: toast shown, first ack fails (count → 1).
    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1),
    );
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);

    // Three more poll intervals — each triggers exactly one retry attempt,
    // not a tight loop of retries.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(POLL_INTERVAL_MS);
      });
    }

    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(4),
    );

    // Toast was shown exactly once despite four ack failures.
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // AC-4: wallet/identity change cancels old work and resets state
  // -------------------------------------------------------------------------

  it("resets all state and scopes retries to the new wallet after an account change", async () => {
    // Wallet A has one unread notification; ack initially fails.
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    mockMarkNotificationsRead.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    mockMarkNotificationsRead.mockResolvedValue({ count: 1 });

    const { rerender } = render(<NotificationPoller />);

    // First poll for wallet A: toast shown, ack fails.
    await waitFor(() =>
      expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1),
    );
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1);
    expect(mockMarkNotificationsRead).toHaveBeenLastCalledWith(WALLET_A, [
      "n1",
    ]);

    // Switch to wallet B.
    walletState.address = WALLET_B;
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n2")]);

    rerender(<NotificationPoller />);

    // Wallet B's first poll should toast n2.
    await waitFor(() =>
      expect(mockShowOrderEventToast).toHaveBeenCalledTimes(2),
    );

    // Any ack calls after the wallet switch must use WALLET_B, not WALLET_A.
    const ackCallsAfterSwitch = mockMarkNotificationsRead.mock.calls.filter(
      (call) => call[0] === WALLET_B,
    );
    expect(ackCallsAfterSwitch.length).toBeGreaterThanOrEqual(1);
    expect(ackCallsAfterSwitch[0]).toEqual([WALLET_B, ["n2"]]);

    // The stale pending ack from wallet A must not have been re-attempted
    // against wallet B's session.
    const staleAckCalls = mockMarkNotificationsRead.mock.calls.filter(
      (call) =>
        call[0] === WALLET_A &&
        call[1].includes("n1") &&
        // Only count calls that happened after the wallet switch (call index >= 1).
        mockMarkNotificationsRead.mock.calls.indexOf(call) >= 1,
    );
    expect(staleAckCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Permanent / auth errors: clear pending, stop retrying
  // -------------------------------------------------------------------------

  it("clears pending acks and stops retrying on a permanent (4xx) error", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);

    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockMarkNotificationsRead.mockRejectedValue(authError);

    render(<NotificationPoller />);

    // First poll — toast shown, ack hits 401.
    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1),
    );
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);

    // Subsequent polls must not retry the ack after a permanent failure.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(mockListUnreadNotifications).toHaveBeenCalledTimes(3),
    );
    // Auth errors must not cause repeated ack calls.
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // First-attempt failure + later success (explicit sequence)
  // -------------------------------------------------------------------------

  it("succeeds on the second attempt after a transient first-attempt failure", async () => {
    mockListUnreadNotifications.mockResolvedValue([makeNotification("n1")]);
    mockMarkNotificationsRead
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ count: 1 });

    render(<NotificationPoller />);

    // First poll: toast shown, ack fails.
    await waitFor(() =>
      expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1),
    );
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(1);

    // Next poll: retry succeeds.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    await waitFor(() =>
      expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(2),
    );

    // Only one toast, second ack call succeeded.
    expect(mockShowOrderEventToast).toHaveBeenCalledTimes(1);
    expect(mockMarkNotificationsRead).toHaveBeenNthCalledWith(2, WALLET_A, [
      "n1",
    ]);

    // After success, a third poll must not re-POST n1.
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(mockListUnreadNotifications).toHaveBeenCalledTimes(3),
    );
    expect(mockMarkNotificationsRead).toHaveBeenCalledTimes(2);
  });
});
