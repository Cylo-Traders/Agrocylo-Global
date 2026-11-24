import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductFormModal from "./ProductFormModal";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const defaultProps = {
  open: true,
  mode: "add" as const,
  initialProduct: null,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function renderModal(props = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductFormModal {...defaultProps} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductFormModal image previews", () => {
  it("shows a preview, filename and accessible remove action", async () => {
    const user = userEvent.setup();
    renderModal();

    const file = new File(["test"], "tomato.jpg", { type: "image/jpeg" });
    const input = document.getElementById("prod-image-upload") as HTMLInputElement;
    await user.upload(input, file);

    const preview = await screen.findByAltText("tomato.jpg preview");
    expect(preview).toBeInTheDocument();
    expect(screen.getByText("tomato.jpg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove tomato.jpg" }),
    ).toBeInTheDocument();
  });

  it("removes a file and releases its object URL", async () => {
    const user = userEvent.setup();
    renderModal();

    const file = new File(["test"], "tomato.jpg", { type: "image/jpeg" });
    const input = document.getElementById("prod-image-upload") as HTMLInputElement;
    await user.upload(input, file);

    await user.click(screen.getByRole("button", { name: "Remove tomato.jpg" }));

    await waitFor(() => {
      expect(screen.queryByText("tomato.jpg")).not.toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-preview");
  });

  it("falls back gracefully when a preview fails to render", async () => {
    const user = userEvent.setup();
    renderModal();

    const file = new File(["test"], "broken.jpg", { type: "image/jpeg" });
    const input = document.getElementById("prod-image-upload") as HTMLInputElement;
    await user.upload(input, file);

    const preview = await screen.findByAltText("broken.jpg preview");
    fireEvent.error(preview);

    expect(
      await screen.findByText(/Preview unavailable for broken.jpg/i),
    ).toBeInTheDocument();
    // The file and its remove control remain usable.
    expect(
      screen.getByRole("button", { name: "Remove broken.jpg" }),
    ).toBeInTheDocument();
  });
});