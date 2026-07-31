"use client";

import { useEffect } from "react";
import { consumeHandoffToken } from "@/lib/authHandoff";
import { setAccessToken } from "@/lib/authToken";
import { saveWalletSession } from "@/lib/walletSession";

/** Consumes a ?handoff= SSO token from the root app on first load (Issue #686). */
export default function HandoffConsumer() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("handoff");
    if (!token) return;

    // Strip the token from the URL immediately — it is single-use, so it
    // must not linger in browser history/bookmarks either way.
    url.searchParams.delete("handoff");
    window.history.replaceState({}, "", url.toString());

    void consumeHandoffToken(token).then((session) => {
      if (!session) return;
      setAccessToken(session.accessToken);
      saveWalletSession({ address: session.walletAddress, connectedAt: Date.now() });
    });
  }, []);

  return null;
}
