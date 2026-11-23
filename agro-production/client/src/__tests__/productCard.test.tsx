import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProductCard } from "../components/ProductCard";
import type { Product } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; "aria-label"?: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/services/productService", () => ({
  formatPrice: (raw: string) => raw,
}));

const baseProduct: Product = {
  id: "prod-1",
  name: "Organic Tomatoes",
  description: "Fresh from the farm",
  imageUrl: null,
  campaignId: null,
  category: "VEGETABLES",
  currency: "XLM",
  amountUnit: "stroops",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  unit: "kg",
  quantity: 100,
  pricePerUnit: "5000000",
  location: "Lagos",
  farmerAddress: "GABC1234567890",
  isActive: true,
  isSellable: true,
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

describe("ProductCard", () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it("renders product name", () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText("Organic Tomatoes")).toBeTruthy();
  });

  it("renders location", () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText("Lagos")).toBeTruthy();
  });

  it("renders unit in aria-label", () => {
    render(<ProductCard product={baseProduct} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toContain("kg");
  });

  it("shows a cached/read-only indicator when offline", () => {
    setOnline(false);
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText(/cached/i)).toBeTruthy();
  });

  it("hides the cached indicator when online", () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.queryByText(/cached/i)).toBeNull();
  });

  it("updates the indicator when connectivity changes", () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.queryByText(/cached/i)).toBeNull();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/cached/i)).toBeTruthy();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/cached/i)).toBeNull();
  });
});
