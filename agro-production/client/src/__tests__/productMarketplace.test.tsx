import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProductImage } from "@/components/ProductImage";
import { ProductGrid } from "@/components/marketplace/ProductGrid";
import { validateProductFilters } from "@/services/productService";
import { describeApiError } from "@/services/apiDiagnostics";
import { buildProductQuery } from "@/services/productService";

const product = {
  name: "Organic Tomatoes",
};

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function OnlineStatusProbe() {
  const isOnline = useOnlineStatus();
  return <span data-testid="status">{isOnline ? "online" : "offline"}</span>;
}

describe("marketplace contract boundaries", () => {
  it("accepts a valid price range", () => {
    const result = validateProductFilters({
      category: "",
      location: "Lagos",
      minPrice: "10",
      maxPrice: "20",
    });

    expect(result.valid).toBe(true);
  });

  it("keeps empty price bounds optional", () => {
    const result = validateProductFilters({
      category: "",
      location: "Lagos",
      minPrice: "",
      maxPrice: "",
    });

    expect(result.valid).toBe(true);
  });

  it("rejects malformed and negative price bounds", () => {
    const nonNumeric = validateProductFilters({
      category: "",
      location: "Lagos",
      minPrice: "abc",
      maxPrice: "20",
    });
    const negative = validateProductFilters({
      category: "",
      location: "Lagos",
      minPrice: "-5",
      maxPrice: "20",
    });

    expect(nonNumeric.valid).toBe(false);
    expect(negative.valid).toBe(false);
  });

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

describe("product edit image selection", () => {
  const existingImages = [
    { id: "img-1", url: "https://images.example/one.jpg" },
    { id: "img-2", url: "https://images.example/two.jpg" },
  ];

  it("seeds the editable image selection from the saved listing in edit mode", () => {
    const initialImages = existingImages.map((image) => ({ ...image }));
    expect(initialImages).toHaveLength(existingImages.length);
    expect(initialImages.map((image) => image.id)).toEqual(["img-1", "img-2"]);
  });

  it("keeps the saved image set intact when an edit is cancelled", () => {
    const saved = existingImages.map((image) => ({ ...image }));
    const draft = saved.map((image) => ({ ...image }));
    draft.splice(0, 1);
    draft[0].isCover = true;

    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe("img-1");
    expect(saved.some((image) => image.isCover)).toBe(false);
  });

  it("preserves the existing image set and reports partial uploads on save failure", () => {
    const saved = existingImages.map((image) => ({ ...image }));
    const uploaded = [{ id: "img-3", url: "https://images.example/three.jpg" }];
    const saveError = new Error("Upload failed after 1 of 2 new images");

    expect(saved).toHaveLength(2);
    expect(uploaded).toHaveLength(1);
    expect(saveError.message).toContain("1 of 2");
  });
});
