import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    trackFunnelStep: vi.fn(),
    trackFeatureAdoption: vi.fn(),
  }),
}));

import Complete from "./Complete";

describe("Complete onboarding step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-redirects a farmer to /dashboard", () => {
    render(<Complete role="farmer" />);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("auto-redirects a buyer to /market", () => {
    render(<Complete role="buyer" />);
    expect(mockReplace).toHaveBeenCalledWith("/market");
  });
});
