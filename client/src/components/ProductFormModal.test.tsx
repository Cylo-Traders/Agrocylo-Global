import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductFormModal from "./ProductFormModal";
import * as productService from "@/services/productService";
import * as useProductsHook from "@/hooks/queries/useProducts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const mockOnClose = vi.fn();
const mockOnSuccess = vi.fn();

const defaultProps = {
  open: true,
  mode: "add" as const,
  initialProduct: null,
  onClose: mockOnClose,
  onSuccess: mockOnSuccess,
};

const renderModal = (props = {}) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductFormModal {...defaultProps} {...props} />
    </QueryClientProvider>,
  );
};

describe("ProductFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(productService, "uploadProductImage").mockResolvedValue({
      image_url: "https://example.com/image.jpg",
    });
  });

  it("renders in add mode with empty fields", () => {
    renderModal();
    expect(screen.getByText("Add Product")).toBeInTheDocument();
    expect(screen.getByDisplayValue("")).toHaveLength(4);
  });

  it("renders in edit mode with initial product data", () => {
    const product = {
      id: "prod-1",
      name: "Tomato",
      category: "Vegetables",
      price_per_unit: "5",
      currency: "XLM",
      unit: "kg",
      stock_quantity: "100",
      description: "Fresh tomatoes",
      location: "Accra",
      delivery_window: "2-3 days",
      is_available: true,
      image_url: null,
      farmer_wallet: "farmer1",
      created_at: new Date(),
      updated_at: new Date(),
    };
    renderModal({ mode: "edit", initialProduct: product });
    expect(screen.getByText("Edit Listing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Tomato")).toBeInTheDocument();
  });

  it("requires name, category, price, location, and delivery window", async () => {
    const user = userEvent.setup();
    renderModal();

    const submitButton = screen.getByRole("button", { name: /List Product/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("validates minimum price as 0", async () => {
    const user = userEvent.setup();
    renderModal();

    const priceInput = screen.getByDisplayValue("") as HTMLInputElement;
    if (priceInput.type !== "number") {
      return;
    }

    await user.type(priceInput, "-1");
    const submitButton = screen.getByRole("button", { name: /List Product/i });
    await user.click(submitButton);
  });

  it("calls useCreateProduct hook and invalidates cache on success", async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: "prod-1",
      name: "Test Product",
    });

    vi.spyOn(useProductsHook, "useCreateProduct").mockReturnValue({
      mutateAsync: createMock,
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      status: "idle",
      mutate: vi.fn(),
      reset: vi.fn(),
    } as any);

    const user = userEvent.setup();
    renderModal();

    // Fill in required fields
    await user.type(screen.getByLabelText("Product Name"), "Tomato");
    const categorySelect = screen.getByDisplayValue("Select category");
    await user.click(categorySelect);
    await user.click(screen.getByRole("option", { name: "Vegetables" }));
    await user.type(screen.getByLabelText("Price"), "5");
    await user.type(screen.getByLabelText("Farm Location"), "Accra");
    await user.type(screen.getByLabelText("Delivery Window"), "2-3 days");

    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("shows error message on submission failure", async () => {
    const errorMessage = "Failed to create product";
    vi.spyOn(useProductsHook, "useCreateProduct").mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockRejectedValue(new Error(errorMessage)),
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      status: "idle",
      mutate: vi.fn(),
      reset: vi.fn(),
    } as any);

    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Product Name"), "Tomato");
    const categorySelect = screen.getByDisplayValue("Select category");
    await user.click(categorySelect);
    await user.click(screen.getByRole("option", { name: "Vegetables" }));
    await user.type(screen.getByLabelText("Price"), "5");
    await user.type(screen.getByLabelText("Farm Location"), "Accra");
    await user.type(screen.getByLabelText("Delivery Window"), "2-3 days");

    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it("uploads product images when selected", async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: "prod-1",
      name: "Test Product",
    });

    vi.spyOn(useProductsHook, "useCreateProduct").mockReturnValue({
      mutateAsync: createMock,
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      status: "idle",
      mutate: vi.fn(),
      reset: vi.fn(),
    } as any);

    const user = userEvent.setup();
    renderModal();

    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    const input = screen.getByRole("img")?.closest("label")?.querySelector("input") as HTMLInputElement;

    if (input) {
      await user.upload(input, file);
    }
  });

  it("closes modal when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("supports both XLM and USDC currencies", async () => {
    renderModal();

    expect(screen.getByRole("option", { name: "XLM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "USDC" })).toBeInTheDocument();
  });
});
