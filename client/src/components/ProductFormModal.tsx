"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Container,
  Input,
  Text,
} from "@/components/ui";
import type { Product, ProductCategory, ProductCurrency, ProductUnit } from "@/types/product";
import {
  normalizeProductWriteInput,
  createProduct,
  updateProduct,
  uploadProductImage,
} from "@/services/productService";

type Mode = "add" | "edit";

type FormErrors = Partial<Record<"name" | "category" | "pricePerUnit" | "currency" | "unit" | "description", string>>;

const CATEGORIES: ProductCategory[] = [
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];

const CURRENCIES: ProductCurrency[] = ["STRK", "USDC"];

const UNITS: ProductUnit[] = ["kg", "bag", "crate", "piece", "litre", "dozen"];

export default function ProductFormModal({
  open,
  mode,
  walletAddress,
  initialProduct,
  onClose,
  onSuccess,
}: {
  open: boolean;
  mode: Mode;
  walletAddress: string;
  initialProduct?: Product | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const existingImageUrl = initialProduct?.image_url ?? null;

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [currency, setCurrency] = useState<ProductCurrency>("STRK");
  const [unit, setUnit] = useState<ProductUnit>("kg");
  const [stockQuantity, setStockQuantity] = useState<string>(""); // blank => unlimited
  const [description, setDescription] = useState<string>("");
  const [isAvailable, setIsAvailable] = useState(true);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const activePreviewUrl = imagePreviewUrl ?? existingImageUrl;

  useEffect(() => {
    if (!open) return;

    setErrors({});
    setSaveError(null);
    setSaving(false);

    setName(initialProduct?.name ?? "");
    setCategory(initialProduct?.category ?? null);
    setPricePerUnit(initialProduct?.price_per_unit ?? "");
    setCurrency((initialProduct?.currency as ProductCurrency) ?? "STRK");
    setUnit((initialProduct?.unit as ProductUnit) ?? "kg");
    setStockQuantity(initialProduct?.stock_quantity ?? "");
    setDescription(initialProduct?.description ?? "");
    setIsAvailable(initialProduct?.is_available ?? true);

    setImageFile(null);
    setImagePreviewUrl(null);
  }, [open, initialProduct]);

  // Object URL cleanup
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const accepts = useMemo(
    () => ["image/png", "image/jpeg", "image/webp"],
    [],
  );

  function setFile(file: File | null) {
    if (!file) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (!accepts.includes(file.type)) {
      setErrors((prev) => ({
        ...prev,
        description: "Unsupported image type. Use JPG/PNG/WebP.",
      }));
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  function validate(): boolean {
    const next: FormErrors = {};
    if (!name.trim()) next.name = "Product name is required.";
    if (!category) next.category = "Please select a category.";
    if (!pricePerUnit || Number(pricePerUnit) <= 0) next.pricePerUnit = "Price must be a positive number.";
    if (!currency) next.currency = "Please select a currency.";
    if (!unit) next.unit = "Please select a unit.";
    if (description && description.length > 500) next.description = "Description must be 500 characters or less.";

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      setSaveError("Wallet is not connected.");
      return;
    }
    if (!validate()) return;

    setSaving(true);
    setSaveError(null);
    try {
      const normalized = normalizeProductWriteInput({
        name: name.trim(),
        category,
        pricePerUnit: pricePerUnit.trim(),
        currency,
        unit,
        stockQuantity: stockQuantity.trim() === "" ? null : stockQuantity.trim(),
        description: description.trim() === "" ? null : description.trim(),
        isAvailable,
      });

      if (mode === "add") {
        const created = await createProduct(walletAddress, normalized);
        if (imageFile) {
          await uploadProductImage(walletAddress, created.id, imageFile);
        }
      } else {
        if (!initialProduct?.id) throw new Error("Missing product to update.");
        await updateProduct(walletAddress, initialProduct.id, normalized);
        if (imageFile) {
          await uploadProductImage(walletAddress, initialProduct.id, imageFile);
        }
      }

      await onSuccess();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl">
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>{mode === "add" ? "Add Product" : "Edit Product"}</CardTitle>
          </CardHeader>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Input
                  label="Product Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Organic Tomatoes"
                  error={errors.name}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    value={category ?? ""}
                    onChange={(e) => setCategory((e.target.value || null) as ProductCategory | null)}
                  >
                    <option value="" disabled>
                      Select a category
                    </option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {errors.category && <Text variant="body" className="text-error">{errors.category}</Text>}
                </div>

                <div className="space-y-2">
                  <Input
                    label="Price per unit"
                    type="number"
                    value={pricePerUnit}
                    min={0}
                    step={0.01}
                    onChange={(e) => setPricePerUnit(e.target.value)}
                    placeholder="e.g. 10.5"
                    error={errors.pricePerUnit}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Currency</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as ProductCurrency)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {errors.currency && <Text variant="body" className="text-error">{errors.currency}</Text>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Unit</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as ProductUnit)}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  {errors.unit && <Text variant="body" className="text-error">{errors.unit}</Text>}
                </div>
              </div>

              <div className="space-y-2">
                <Input
                  label="Stock quantity (optional)"
                  type="number"
                  value={stockQuantity}
                  min={0}
                  step={1}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  placeholder="Leave blank for unlimited"
                  hint="Quantity at the farm right now"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description (max 500 chars)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description..."
                  className={[
                    "w-full rounded-lg border bg-background px-4 py-2.5 text-foreground text-base transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-24 sm:py-3",
                    errors.description ? "border-error focus:ring-error" : "border-border",
                  ].join(" ")}
                  aria-invalid={!!errors.description}
                />
                {errors.description && (
                  <Text variant="body" className="text-error text-sm">
                    {errors.description}
                  </Text>
                )}
                <Text variant="body" muted className="text-xs">
                  {description.length}/500
                </Text>
              </div>

              <div className="space-y-2">
                <Text variant="body" muted className="text-sm">
                  Product Image (optional)
                </Text>

                <div
                  className="border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-3"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) setFile(file);
                  }}
                >
                  {activePreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activePreviewUrl} alt="Product preview" className="w-32 h-32 object-cover rounded-lg" />
                  ) : (
                    <Container size="sm" className="text-center">
                      <Text variant="body" muted>
                        Drag & drop an image here
                      </Text>
                    </Container>
                  )}

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => document.getElementById("product-image-input")?.click()}>
                      Choose image
                    </Button>
                    <input
                      id="product-image-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    {imageFile && (
                      <Button type="button" variant="ghost" onClick={() => setFile(null)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Text variant="body" className="font-medium">
                  Availability
                </Text>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => setIsAvailable(e.target.checked)}
                  />
                  <Text variant="body" muted>
                    {isAvailable ? "Listed" : "Unlisted"}
                  </Text>
                </label>
              </div>

              {saveError && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3">
                  <Text variant="body" className="text-error">
                    {saveError}
                  </Text>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex gap-3 justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : mode === "add" ? "Create Product" : "Save Changes"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

