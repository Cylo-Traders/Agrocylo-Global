import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductImage } from "@/components/ProductImage";
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

describe("product save phases", () => {
  type SavePhase = "product" | "images";

  interface SaveResult {
    productCreated: boolean;
    productId: string | null;
    failedImages: string[];
    uploadedImages: string[];
  }

  // Mirrors the form's two-phase save: create the product once, then upload
  // images independently so an upload failure never implies product failure.
  async function saveProduct(
    createProduct: () => Promise<{ id: string }>,
    uploadImage: (name: string) => Promise<string>,
    images: string[],
    existingProductId: string | null = null,
  ): Promise<SaveResult> {
    let productId = existingProductId;
    let productCreated = false;

    if (!productId) {
      const created = await createProduct();
      productId = created.id;
      productCreated = true;
    }

    const failedImages: string[] = [];
    const uploadedImages: string[] = [];
    await Promise.all(
      images.map(async (name) => {
        try {
          uploadedImages.push(await uploadImage(name));
        } catch {
          failedImages.push(name);
        }
      }),
    );

    return { productCreated, productId, failedImages, uploadedImages };
  }

  it("reports product success when every image upload fails", async () => {
    const createProduct = vi.fn().mockResolvedValue({ id: "prod-1" });
    const uploadImage = vi.fn().mockRejectedValue(new Error("upload failed"));

    const result = await saveProduct(createProduct, uploadImage, ["a.jpg", "b.jpg"]);

    expect(result.productCreated).toBe(true);
    expect(result.productId).toBe("prod-1");
    expect(result.failedImages.sort()).toEqual(["a.jpg", "b.jpg"]);
    expect(result.uploadedImages).toEqual([]);
  });

  it("reports product success and only the failed images on partial failure", async () => {
    const createProduct = vi.fn().mockResolvedValue({ id: "prod-2" });
    const uploadImage = vi.fn(async (name: string) => {
      if (name === "bad.jpg") throw new Error("upload failed");
      return `https://cdn.example/${name}`;
    });

    const result = await saveProduct(createProduct, uploadImage, ["good.jpg", "bad.jpg"]);

    expect(result.productCreated).toBe(true);
    expect(result.productId).toBe("prod-2");
    expect(result.failedImages).toEqual(["bad.jpg"]);
    expect(result.uploadedImages).toEqual(["https://cdn.example/good.jpg"]);
  });

  it("does not create a duplicate product when retrying failed uploads", async () => {
    const createProduct = vi.fn().mockResolvedValue({ id: "prod-3" });
    const uploadImage = vi.fn(async (name: string) => {
      if (name === "retry.jpg" && uploadImage.mock.calls.length === 1) {
        throw new Error("upload failed");
      }
      return `https://cdn.example/${name}`;
    });

    const first = await saveProduct(createProduct, uploadImage, ["retry.jpg"]);
    expect(first.productCreated).toBe(true);
    expect(first.failedImages).toEqual(["retry.jpg"]);

    const retry = await saveProduct(
      createProduct,
      uploadImage,
      first.failedImages,
      first.productId,
    );

    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(retry.productCreated).toBe(false);
    expect(retry.productId).toBe("prod-3");
    expect(retry.failedImages).toEqual([]);
    expect(retry.uploadedImages).toEqual(["https://cdn.example/retry.jpg"]);
  });
});
