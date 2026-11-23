import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductImage } from "@/components/ProductImage";
import { ProductGrid } from "@/components/marketplace/ProductGrid";
import { validateProductFilters } from "@/services/productService";

const product = {
  name: "Organic Tomatoes",
};

describe("marketplace contract boundaries", () => {
  it("rejects an inverted price range before making a request", () => {
    const result = validateProductFilters({
      category: "",
      location: "Lagos",
      minPrice: "20",
      maxPrice: "10",
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]?.message).toContain("cannot exceed");
  });

  it("uses a local fallback for an unapproved product image origin", () => {
    render(<ProductImage name={product.name} imageUrl="https://unapproved.example/image.jpg" />);
    expect(screen.getByAltText("Placeholder image for Organic Tomatoes")).toHaveAttribute(
      "src",
      "/product-placeholder.svg",
    );
  });

  it("switches to the local fallback when an approved image fails", () => {
    vi.stubEnv("NEXT_PUBLIC_PRODUCT_IMAGE_ORIGINS", "https://images.example");
    render(<ProductImage name={product.name} imageUrl="https://images.example/image.jpg" />);
    const image = screen.getByAltText("Image of Organic Tomatoes");
    image.dispatchEvent(new Event("error"));
    expect(image).toHaveAttribute("src", "/product-placeholder.svg");
    vi.unstubAllEnvs();
  });
});

describe("marketplace loading skeletons", () => {
  it("renders decorative skeleton cards and announces loading once", () => {
    const { container } = render(<ProductGrid products={[]} loading />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading products/i);
    expect(screen.getAllByRole("status")).toHaveLength(1);

    const skeletons = container.querySelectorAll("[data-testid='product-skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
    skeletons.forEach((skeleton) => {
      expect(skeleton).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("removes the skeleton once products resolve", () => {
    const { container } = render(
      <ProductGrid
        products={[
          {
            id: "1",
            name: "Organic Tomatoes",
            price: 10,
            unit: "kg",
            location: "Lagos",
            category: "Vegetables",
            imageUrl: "",
            farmerName: "Ada",
          },
        ]}
        loading={false}
      />,
    );

    expect(container.querySelector("[data-testid='product-skeleton']")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
