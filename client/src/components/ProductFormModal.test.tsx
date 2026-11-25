import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductFormModal, {
  FRIENDLY_PRODUCT_SAVE_ERROR,
} from "./ProductFormModal";
import * as productService from "@/services/productService";
import * as useProductsHook from "@/hooks/queries/useProducts";
import * as useWalletHook from "@/hooks/useWallet";
import * as testModeModule from "@/lib/testMode";
import { ApiRequestError } from "@/lib/apiHelper";

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

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Product Name"), "Tomato");
  const categorySelect = screen.getAllByRole("combobox")[0];
  await user.selectOptions(categorySelect, "Vegetables");
  await user.type(screen.getByLabelText("Price"), "5");
  await user.type(screen.getByLabelText("Farm Location (Region)"), "Accra");
  await user.type(screen.getByLabelText("Delivery Window"), "2-3 days");
}

describe("ProductFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(testModeModule, "isTestMode").mockReturnValue(false);
    vi.spyOn(useWalletHook, "useWallet").mockReturnValue({
      authenticated: true,
      reauthenticate: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useWalletHook.useWallet>);
    vi.spyOn(productService, "uploadProductImage").mockResolvedValue({
      image_url: "https://example.com/image.jpg",
    });
  });

  it("renders in add mode with empty fields", () => {
    renderModal();
    expect(screen.getByText("Add Product")).toBeInTheDocument();
    expect(screen.getByLabelText("Product Name")).toHaveValue("");
    expect(screen.getByLabelText("Price")).toHaveValue(null);
    expect(screen.getByLabelText("Stock quantity")).toHaveValue(null);
    expect(screen.getByLabelText("Farm Location (Region)")).toHaveValue("");
    expect(screen.getByLabelText("Delivery Window")).toHaveValue("");
  });

  it("renders in edit mode with initial product data", () => {
    const product = {
      id: "prod-1",
      name: "Tomato",
      category: "Vegetables" as const,
      price_per_unit: "5",
      currency: "XLM" as const,
      unit: "kg" as const,
      stock_quantity: "100",
      description: "Fresh tomatoes",
      location: "Accra",
      delivery_window: "2-3 days",
      is_available: true,
      image_url: null,
      farmer_wallet: "farmer1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
      expect(screen.getByText("Product name is required")).toBeInTheDocument();
    });
  });

  it("validates minimum price as 0", async () => {
    const user = userEvent.setup();
    renderModal();

    const priceInput = screen.getByLabelText("Price") as HTMLInputElement;

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
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("shows error message on submission failure", async () => {
    const errorMessage = "Failed to create product";
    vi.spyOn(useProductsHook, "useCreateProduct").mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error(errorMessage)),
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      status: "idle",
      mutate: vi.fn(),
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it("maps rejected /auth/nonce (TypeError: Failed to fetch) to friendly copy, keeps form values & images, and allows Retry (#1420)", async () => {
    const reauthMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(undefined);

    vi.spyOn(useWalletHook, "useWallet").mockReturnValue({
      authenticated: false,
      reauthenticate: reauthMock,
    } as unknown as ReturnType<typeof useWalletHook.useWallet>);

    const createMock = vi.fn().mockResolvedValue({
      id: "prod-1",
      name: "Tomato",
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
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    const file = new File(["img"], "cover.jpg", { type: "image/jpeg" });
    const fileInput = document.getElementById(
      "prod-image-upload",
    ) as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(
        screen.getByText(FRIENDLY_PRODUCT_SAVE_ERROR),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();

    // Form values and selected images are preserved
    expect(screen.getByLabelText("Product Name")).toHaveValue("Tomato");
    expect(screen.getByLabelText("Farm Location (Region)")).toHaveValue("Accra");
    expect(screen.getByText("cover.jpg")).toBeInTheDocument();

    // Clicking Retry succeeds
    const retryButton = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(reauthMock).toHaveBeenCalledTimes(2);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("maps rejected POST /products NETWORK_ERROR to friendly copy without raw 'Failed to fetch' (#1420)", async () => {
    const createMock = vi.fn().mockRejectedValue(
      new ApiRequestError({
        code: "NETWORK_ERROR",
        message: "Failed to fetch",
        status: 0,
      }),
    );

    vi.spyOn(useProductsHook, "useCreateProduct").mockReturnValue({
      mutateAsync: createMock,
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      status: "idle",
      mutate: vi.fn(),
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(
        screen.getByText(FRIENDLY_PRODUCT_SAVE_ERROR),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Failed to fetch/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Product Name")).toHaveValue("Tomato");
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("skips reauthenticate() in demo/test mode and saves locally without contacting /auth/nonce (#1420)", async () => {
    vi.spyOn(testModeModule, "isTestMode").mockReturnValue(true);
    const reauthMock = vi.fn();
    vi.spyOn(useWalletHook, "useWallet").mockReturnValue({
      authenticated: false,
      reauthenticate: reauthMock,
    } as unknown as ReturnType<typeof useWalletHook.useWallet>);

    const createMock = vi.fn().mockResolvedValue({
      id: "demo-1",
      name: "Tomato",
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
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /List Product/i }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(mockOnSuccess).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
    expect(reauthMock).not.toHaveBeenCalled();
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
    } as unknown as ReturnType<typeof useProductsHook.useCreateProduct>);

    const user = userEvent.setup();
    renderModal();

    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    const input = document.getElementById(
      "prod-image-upload",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("test.jpg")).toBeInTheDocument();
    });
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
