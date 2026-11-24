import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  formatProductCategory,
  parseProductCategory,
  type Product,
} from "@/types";
import { CATEGORIES, MarketplaceFilters } from "@/components/MarketplaceFilters";
import { ProductCard } from "@/components/ProductCard";
import { parseCategory } from "@/app/marketplace/page";

const SERVER_CATEGORY_ENUM = [
  "GRAINS",
  "VEGETABLES",
  "FRUITS",
  "LIVESTOCK",
  "DAIRY",
  "OTHER",
] as const;

describe("Marketplace category filters & display labels (Issue #1439)", () => {
  it("aligns PRODUCT_CATEGORIES exactly with the server ProductCategorySchema enum", () => {
    expect([...PRODUCT_CATEGORIES]).toEqual([...SERVER_CATEGORY_ENUM]);

    const filterValues = CATEGORIES.map((c) => c.value).filter(Boolean);
    expect(filterValues).toEqual([...SERVER_CATEGORY_ENUM]);
  });

  it("maps legacy lowercase values (including meat/poultry) to canonical uppercase enum values and rejects unknown categories", () => {
    expect(parseCategory("VEGETABLES")).toBe("VEGETABLES");
    expect(parseCategory("vegetables")).toBe("VEGETABLES");
    expect(parseCategory("fruits")).toBe("FRUITS");
    expect(parseCategory("grains")).toBe("GRAINS");
    expect(parseCategory("dairy")).toBe("DAIRY");
    expect(parseCategory("meat")).toBe("LIVESTOCK");
    expect(parseCategory("poultry")).toBe("LIVESTOCK");
    expect(parseCategory("other")).toBe("OTHER");
    expect(parseCategory("invalid-cat")).toBe("");
    expect(parseCategory(null)).toBe("");
  });

  it("renders human-readable category labels in MarketplaceFilters while emitting canonical uppercase enum values", () => {
    const onCategoryChange = vi.fn();
    render(
      <MarketplaceFilters
        category=""
        location=""
        minPrice=""
        maxPrice=""
        filterErrors={[]}
        onCategoryChange={onCategoryChange}
        onLocationChange={vi.fn()}
        onMinPriceChange={vi.fn()}
        onMaxPriceChange={vi.fn()}
        onFilterErrorsClear={vi.fn()}
      />,
    );

    const select = screen.getByLabelText(/category/i) as HTMLSelectElement;
    const options = Array.from(select.options);

    for (const cat of SERVER_CATEGORY_ENUM) {
      const opt = options.find((o) => o.value === cat);
      expect(opt).toBeDefined();
      expect(opt?.textContent).toBe(PRODUCT_CATEGORY_LABELS[cat]);
      expect(opt?.textContent).not.toBe(cat);
    }

    fireEvent.change(select, { target: { value: "VEGETABLES" } });
    expect(onCategoryChange).toHaveBeenCalledWith("VEGETABLES");
  });

  it("displays human-readable category labels on ProductCard instead of raw uppercase enum IDs", () => {
    const sampleProduct: Product = {
      id: "prod-1",
      name: "Fresh Maize",
      description: "Golden sweet maize",
      imageUrl: null,
      pricePerUnit: "10000000",
      amountUnit: "stroops",
      currency: "XLM",
      campaignId: null,
      category: "GRAINS",
      unit: "bag",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      quantity: 25,
      location: "Kano",
      farmerAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
      isActive: true,
      isSellable: true,
    };

    render(<ProductCard product={sampleProduct} />);
    expect(screen.getByText("Grains")).toBeInTheDocument();
    expect(screen.queryByText("GRAINS")).not.toBeInTheDocument();
    expect(formatProductCategory("LIVESTOCK")).toBe("Livestock");
    expect(parseProductCategory("poultry")).toBe("LIVESTOCK");
  });
});
