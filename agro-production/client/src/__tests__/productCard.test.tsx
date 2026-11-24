import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProductCard } from "../components/ProductCard";
import { ProductCardSkeleton } from "../components/marketplace/ProductGrid";
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

describe("ProductCard", () => {
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

  it("renders a product that was created even when its image upload failed", () => {
    render(<ProductCard product={{ ...baseProduct, imageUrl: null }} />);
    expect(screen.getByText("Organic Tomatoes")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("kg");
  });
});

describe("ProductCardSkeleton", () => {
  it("is decorative and hidden from assistive tech", () => {
    const { container } = render(<ProductCardSkeleton />);
    const skeleton = container.firstElementChild as HTMLElement;
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not expose any accessible text", () => {
    render(<ProductCardSkeleton />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
