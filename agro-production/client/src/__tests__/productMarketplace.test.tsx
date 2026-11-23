import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductImage } from "@/components/ProductImage";
import { validateProductFilters } from "@/services/productService";
import { describeApiError } from "@/services/apiDiagnostics";

const product = {
  name: "Organic Tomatoes",
};

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

describe("product API diagnostics", () => {
  it("distinguishes missing API configuration from a server error", () => {
    const missing = describeApiError({ code: "MISSING_API_URL" });
    const server = describeApiError({ code: "SERVER_ERROR" });

    expect(missing.kind).toBe("configuration");
    expect(server.kind).toBe("server");
    expect(missing.message).not.toBe(server.message);
  });

  it("maps connectivity failures to actionable copy without leaking internals", () => {
    const result = describeApiError({ code: "NETWORK_ERROR" });

    expect(result.kind).toBe("connectivity");
    expect(result.retryable).toBe(true);
    expect(result.message).not.toMatch(/stack|http|token|secret/i);
  });
});
