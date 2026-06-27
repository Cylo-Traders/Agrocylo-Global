import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopyButton from "./copy-button";

describe("CopyButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with copy icon by default", () => {
    render(<CopyButton text="hello" />);
    expect(
      screen.getByRole("button", { name: /copy/i }),
    ).toBeInTheDocument();
  });

  it("shows copied state on successful clipboard write", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /copied/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows error state when clipboard write fails and fallback also fails", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });
    document.execCommand = vi.fn(() => false);

    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /copy failed/i }),
      ).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("has accessible aria-live region", () => {
    render(<CopyButton text="hello" />);

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-live", "polite");
  });

  it("shows error alert text on failure", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    document.execCommand = vi.fn(() => false);

    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      const alertEl = screen.getByRole("alert");
      expect(alertEl).toHaveTextContent("Copy failed");
    }, { timeout: 3000 });
  });
});
