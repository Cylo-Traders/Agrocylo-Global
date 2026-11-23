import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProductImage } from "@/components/ProductImage";
import { validateProductFilters } from "@/services/productService";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

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

describe("offline-aware marketplace status", () => {
  beforeEach(() => setNavigatorOnline(true));
  afterEach(() => setNavigatorOnline(true));

  it("reflects the initial offline state", () => {
    setNavigatorOnline(false);
    render(<OnlineStatusProbe />);
    expect(screen.getByTestId("status")).toHaveTextContent("offline");
  });

  it("updates when connectivity is lost and restored", () => {
    render(<OnlineStatusProbe />);
    expect(screen.getByTestId("status")).toHaveTextContent("online");

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("status")).toHaveTextContent("offline");

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByTestId("status")).toHaveTextContent("online");
  });
});
