import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProductCard } from "../components/ProductCard";
import type { Product } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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
  priceTokens: "5000000",
  campaignId: null,
  inventoryCount: 100,
  category: "VEGETABLES",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  unit: "kg",
  quantity: 100,
  pricePerUnit: "5000000",
  location: "Lagos",
  farmerAddress: "GABC1234567890",
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
});
