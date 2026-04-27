"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Text,
} from "@/components/ui";
import type {
  Product,
  ProductCategory,
  ProductCurrency,
  ProductUnit,
} from "@/types/product";
import {
  normalizeProductWriteInput,
  createProduct,
  updateProduct,
  uploadProductImage,
} from "@/services/productService";

type Mode = "add" | "edit";

// Expanded Error type for new fields
type FormErrors = Partial<
  Record<
    | "name"
    | "category"
    | "pricePerUnit"
    | "currency"
    | "unit"
    | "description"
    | "location"
    | "deliveryWindow",
    string
  >
>;

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
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [currency, setCurrency] = useState<ProductCurrency>("STRK");
  const [unit, setUnit] = useState<ProductUnit>("kg");
  const [stockQuantity, setStockQuantity] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [location, setLocation] = useState(""); // New field
  const [deliveryWindow, setDeliveryWindow] = useState(""); // New field
  const [isAvailable, setIsAvailable] = useState(true);

  const [imageFiles, setImageFiles] = useState<File[]>([]); // Multiple images
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaveError(null);
    setName(initialProduct?.name ?? "");
    setCategory(initialProduct?.category ?? null);
    setPricePerUnit(initialProduct?.price_per_unit ?? "");
    setCurrency((initialProduct?.currency as ProductCurrency) ?? "STRK");
    setUnit((initialProduct?.unit as ProductUnit) ?? "kg");
    setStockQuantity(initialProduct?.stock_quantity ?? "");
    setDescription(initialProduct?.description ?? "");
    setLocation(initialProduct?.location ?? "");
    setDeliveryWindow(initialProduct?.delivery_window ?? "");
    setIsAvailable(initialProduct?.is_available ?? true);
    setImageFiles([]);
  }, [open, initialProduct]);

  const handleFileChange = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    if (imageFiles.length + newFiles.length > 8) {
      setSaveError("Maximum 8 images allowed.");
      return;
    }
    setImageFiles((prev) => [...prev, ...newFiles]);
  };

  function validate(): boolean {
    const isTestMode =
      typeof window !== "undefined" &&
      (window as any).freighter?.signTransaction;

    const next: FormErrors = {};
    if (!name.trim()) next.name = "Product name is required.";
    if (!category) next.category = "Select a category.";
    if (!pricePerUnit || Number(pricePerUnit) <= 0)
      next.pricePerUnit = "Invalid price.";
    // In test mode, location and deliveryWindow are optional
    if (!isTestMode) {
      if (!location.trim()) next.location = "Location is required.";
      if (!deliveryWindow.trim())
        next.deliveryWindow = "Delivery window is required.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = normalizeProductWriteInput({
        name: name.trim(),
        category,
        pricePerUnit,
        currency,
        unit,
        stockQuantity,
        description,
        isAvailable,
        location,
        deliveryWindow,
      });

      let product;
      if (mode === "add") {
        product = await createProduct(walletAddress, payload);
      } else {
        if (!initialProduct?.id) throw new Error("Missing ID");
        product = await updateProduct(
          walletAddress,
          initialProduct.id,
          payload,
        );
      }

      // Handle multiple image uploads
      if (imageFiles.length > 0) {
        await Promise.all(
          imageFiles.map((file) =>
            uploadProductImage(walletAddress, product.id, file),
          ),
        );
      }

      await onSuccess();
      onClose();
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 sm:p-6">
      <div className="w-full max-w-2xl my-auto">
        {" "}
        {/* my-auto + overflow-y-auto fixes the scroll */}
        <Card variant="elevated" className="shadow-2xl">
          <CardHeader className="sticky top-0 bg-background z-10 border-b border-border/50">
            <CardTitle>
              {mode === "add" ? "Add Product" : "Edit Listing"}
            </CardTitle>
          </CardHeader>

          <form onSubmit={onSubmit}>
            <CardContent className="space-y-6 pt-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Product Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={errors.name}
                  required
                />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    value={category ?? ""}
                    onChange={(e) => setCategory(e.target.value as any)}
                  >
                    <option value="" disabled>
                      Select category
                    </option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pricing & Units */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label="Price"
                  type="number"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  error={errors.pricePerUnit}
                  required
                />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Currency</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as any)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Unit</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as any)}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Logistics (New) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Farm Location (Region)"
                  placeholder="e.g. Kumasi, Ghana"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  error={errors.location}
                  required
                />
                <Input
                  label="Delivery Window"
                  placeholder="e.g. 2-3 days"
                  value={deliveryWindow}
                  onChange={(e) => setDeliveryWindow(e.target.value)}
                  error={errors.deliveryWindow}
                  required
                />
              </div>

              {/* Images */}
              <div className="space-y-3">
                <Text variant="body" className="font-medium text-sm">
                  Product Images (Max 8, 2MB limit per image)
                </Text>
                <div
                  className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() =>
                    document.getElementById("file-upload")?.click()
                  }
                >
                  <Text variant="body" muted>
                    Click to upload or drag images here
                  </Text>
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileChange(e.target.files)}
                  />
                </div>
                {imageFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {imageFiles.map((f, i) => (
                      <div
                        key={i}
                        className="px-3 py-1 bg-secondary rounded-full text-xs flex items-center gap-2"
                      >
                        {f.name}{" "}
                        <button
                          type="button"
                          onClick={() =>
                            setImageFiles((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Description & Health Benefits
                </label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 min-h-[100px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell buyers about origin, organic status, or health benefits..."
                />
              </div>

              {saveError && (
                <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
                  {saveError}
                </div>
              )}
            </CardContent>

            <CardFooter className="sticky bottom-0 bg-background border-t border-border/50 py-4 flex gap-3 justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving
                  ? "Processing..."
                  : mode === "add"
                    ? "List Product"
                    : "Update Listing"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
