"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ImageOff, Upload, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type {
  Product,
  ProductCategory,
  ProductCurrency,
  ProductUnit,
} from "@/types/product";
import {
  normalizeProductWriteInput,
  uploadProductImage,
} from "@/services/productService";
import { useCreateProduct, useUpdateProduct } from "@/hooks/queries/useProducts";
import { isTestMode } from "@/lib/testMode";
import { productFormSchema } from "@/lib/validation";
import { FormError } from "@/components/FormError";
import { logger } from "@/lib/logger";
import { useWallet } from "@/hooks/useWallet";

type Mode = "add" | "edit";

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
const CURRENCIES: ProductCurrency[] = ["XLM", "USDC"];
const UNITS: ProductUnit[] = ["kg", "bag", "crate", "piece", "litre", "dozen"];
const MAX_IMAGES = 8;

type PreviewStatus = "ready" | "uploading" | "done" | "error";

interface PreviewItem {
  id: string;
  file: File;
  url: string;
  progress: number;
  status: PreviewStatus;
  error?: string;
  previewFailed?: boolean;
}

let previewIdCounter = 0;
function nextPreviewId(): string {
  previewIdCounter += 1;
  return `img-${Date.now()}-${previewIdCounter}`;
}

const SELECT_CLASSES =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

interface ProductFormModalProps {
  open: boolean;
  mode: Mode;
  initialProduct?: Product | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export default function ProductFormModal({
  open,
  mode,
  initialProduct,
  onClose,
  onSuccess,
}: ProductFormModalProps) {
  const { authenticated, reauthenticate } = useWallet();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [currency, setCurrency] = useState<ProductCurrency>("XLM");
  const [unit, setUnit] = useState<ProductUnit>("kg");
  const [stockQuantity, setStockQuantity] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [location, setLocation] = useState("");
  const [deliveryWindow, setDeliveryWindow] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);

  const [imageItems, setImageItems] = useState<PreviewItem[]>([]);
  const [uploadAnnouncement, setUploadAnnouncement] = useState<string>("");
  const imageItemsRef = useRef<PreviewItem[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    imageItemsRef.current = imageItems;
  }, [imageItems]);

  // Release every object URL when the form closes or unmounts so previews do
  // not leak memory (#1402).
  useEffect(() => {
    return () => {
      for (const item of imageItemsRef.current) {
        URL.revokeObjectURL(item.url);
      }
    };
  }, []);

  const createProductMutation = useCreateProduct();
  const updateProductMutation = useUpdateProduct();
  const saving = createProductMutation.isPending || updateProductMutation.isPending;

  useEffect(() => {
    if (!open) {
      for (const item of imageItemsRef.current) {
        URL.revokeObjectURL(item.url);
      }
      imageItemsRef.current = [];
      setImageItems([]);
      setUploadAnnouncement("");
      return;
    }
    setErrors({});
    setSaveError(null);
    setName(initialProduct?.name ?? "");
    setCategory(initialProduct?.category ?? null);
    setPricePerUnit(initialProduct?.price_per_unit ?? "");
    setCurrency((initialProduct?.currency as ProductCurrency) ?? "XLM");
    setUnit((initialProduct?.unit as ProductUnit) ?? "kg");
    setStockQuantity(initialProduct?.stock_quantity ?? "");
    setDescription(initialProduct?.description ?? "");
    setLocation(initialProduct?.location ?? "");
    setDeliveryWindow(initialProduct?.delivery_window ?? "");
    setIsAvailable(initialProduct?.is_available ?? true);
    for (const item of imageItemsRef.current) {
      URL.revokeObjectURL(item.url);
    }
    imageItemsRef.current = [];
    setImageItems([]);
    setUploadAnnouncement("");
  }, [open, initialProduct]);

  function handleFileChange(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files);
    if (imageItems.length + next.length > MAX_IMAGES) {
      setSaveError(`Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }
    const items: PreviewItem[] = next.map((file) => ({
      id: nextPreviewId(),
      file,
      url: URL.createObjectURL(file),
      progress: 0,
      status: "ready",
    }));
    setImageItems((prev) => [...prev, ...items]);
  }

  function removeImage(id: string) {
    setImageItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((item) => item.id !== id);
    });
  }

  function validate(): boolean {
    const next: FormErrors = {};

    const result = productFormSchema.safeParse({
      name: name.trim(),
      category,
      pricePerUnit,
      currency,
      unit,
      stockQuantity: stockQuantity || "",
      description: description || "",
      isAvailable,
      location: isTestMode() ? location || "test" : location,
      deliveryWindow: isTestMode() ? deliveryWindow || "test" : deliveryWindow,
    });

    if (!result.success) {
      const fieldMap: Record<string, keyof FormErrors> = {
        name: "name",
        category: "category",
        pricePerUnit: "pricePerUnit",
        location: "location",
        deliveryWindow: "deliveryWindow",
      };

      for (const issue of result.success ? [] : result.error?.issues ?? []) {
        const field = issue.path?.[0] as string;
        const formKey = fieldMap[field];
        if (formKey && !next[formKey]) {
          next[formKey] = issue.message;
        }
      }
    }

    if (isTestMode()) {
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
    setSaveError(null);
    try {
      // Product writes and image uploads require the API session. The wallet
      // can still be connected after a reload while its short-lived JWT has
      // expired, so restore it before starting the multi-request save flow.
      if (!authenticated) {
        await reauthenticate();
      }
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

      const product =
        mode === "add"
          ? await createProductMutation.mutateAsync(payload)
          : await updateProductMutation.mutateAsync({
              id: initialProduct!.id,
              input: payload,
            });

      if (imageItems.length > 0) {
        const results = await Promise.all(
          imageItems.map(async (item) => {
            setImageItems((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? { ...p, status: "uploading", progress: 0, error: undefined }
                  : p,
              ),
            );
            setUploadAnnouncement(`Uploading ${item.file.name}…`);
            try {
              await uploadProductImage(product.id, item.file, (fraction) => {
                const percent = Math.round(fraction * 100);
                setImageItems((prev) =>
                  prev.map((p) =>
                    p.id === item.id ? { ...p, progress: percent } : p,
                  ),
                );
                setUploadAnnouncement(
                  `Uploading ${item.file.name}: ${percent}%`,
                );
              });
              setImageItems((prev) =>
                prev.map((p) =>
                  p.id === item.id
                    ? { ...p, status: "done", progress: 100 }
                    : p,
                ),
              );
              setUploadAnnouncement(`${item.file.name} uploaded.`);
              return { id: item.id, ok: true as const };
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Upload failed.";
              setImageItems((prev) =>
                prev.map((p) =>
                  p.id === item.id
                    ? { ...p, status: "error", error: msg }
                    : p,
                ),
              );
              setUploadAnnouncement(
                `${item.file.name} failed to upload: ${msg}`,
              );
              return { id: item.id, ok: false as const, error: msg };
            }
          }),
        );
        const failed = results.find((r) => !r.ok);
        if (failed && "error" in failed) {
          throw new Error(failed.error);
        }
      }

      await onSuccess();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save.";
      setSaveError(msg);
      logger?.error("Product form save failed", {
        error: msg,
        mode,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add Product" : "Edit Listing"}
          </DialogTitle>
          <DialogDescription>
            Listings on AgroCylo can be priced in XLM or USDC and are
            settled by the Soroban escrow when a buyer confirms receipt.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={onSubmit}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Product Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              required
            />
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <select
                className={SELECT_CLASSES}
                value={category ?? ""}
                onChange={(e) =>
                  setCategory((e.target.value || null) as ProductCategory)
                }
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
              {errors.category && (
                <p className="text-destructive text-xs">{errors.category}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Price"
              type="number"
              min={0}
              step={0.01}
              value={pricePerUnit}
              onChange={(e) => setPricePerUnit(e.target.value)}
              error={errors.pricePerUnit}
              required
            />
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <select
                className={SELECT_CLASSES}
                value={currency}
                onChange={(e) =>
                  setCurrency(e.target.value as ProductCurrency)
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Unit</Label>
              <select
                className={SELECT_CLASSES}
                value={unit}
                onChange={(e) => setUnit(e.target.value as ProductUnit)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr] sm:items-end">
            <Input
              label="Stock quantity"
              hint="Leave blank for unlimited."
              type="number"
              min={0}
              step={1}
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
            />
            <div className="bg-secondary/40 flex h-12 items-center justify-between gap-3 rounded-md border px-4">
              <Label htmlFor="prod-available" className="cursor-pointer">
                Listed
              </Label>
              <Switch
                id="prod-available"
                checked={isAvailable}
                onCheckedChange={setIsAvailable}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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

          <div className="grid gap-1.5">
            <Label htmlFor="prod-description">
              Description &amp; Health Benefits
            </Label>
            <Textarea
              id="prod-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell buyers about origin, organic status, or health benefits..."
            />
          </div>

          <div className="grid gap-2">
            <Label>Product images</Label>
            <p className="text-muted-foreground text-xs">
              Up to {MAX_IMAGES} images. First image is the cover.
            </p>
            <label
              htmlFor="prod-image-upload"
              className="bg-secondary/40 hover:bg-secondary border-border hover:border-primary/40 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors"
            >
              <div className="bg-background grid size-10 place-content-center rounded-full border">
                <Upload className="text-muted-foreground size-4" />
              </div>
              <p className="text-sm font-medium">Click or drop images here</p>
              <p className="text-muted-foreground text-xs">
                PNG / JPG / WEBP · up to 2 MB each
              </p>
              <input
                id="prod-image-upload"
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files)}
              />
            </label>

            {imageItems.length > 0 && (
              <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
                {imageItems.map((item) => (
                  <figure
                    key={item.id}
                    className="border-border bg-secondary/40 relative overflow-hidden rounded-xl border"
                  >
                    <div className="relative aspect-square w-full">
                      {item.previewFailed ? (
                        <div className="text-muted-foreground grid size-full place-content-center">
                          <ImageOff className="size-6" />
                          <span className="sr-only">
                            Preview unavailable for {item.file.name}
                          </span>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={`${item.file.name} preview`}
                          className="size-full object-cover"
                          onError={() =>
                            setImageItems((prev) =>
                              prev.map((p) =>
                                p.id === item.id
                                  ? { ...p, previewFailed: true }
                                  : p,
                              ),
                            )
                          }
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      className="bg-background/80 text-foreground hover:bg-background absolute top-1 right-1 grid size-11 place-content-center rounded-full"
                      onClick={() => removeImage(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X className="size-4" />
                    </button>
                    <figcaption className="space-y-1 p-2">
                      <span className="block truncate text-xs" title={item.file.name}>
                        {item.file.name}
                      </span>
                      {item.status === "uploading" && (
                        <div
                          className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={item.progress}
                          aria-label={`Uploading ${item.file.name}`}
                        >
                          <div
                            className="bg-primary h-full transition-[width]"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      )}
                      {item.status === "done" && (
                        <span className="block text-xs text-emerald-700 dark:text-emerald-400">
                          Uploaded
                        </span>
                      )}
                      {item.status === "error" && (
                        <span
                          className="text-destructive flex items-start gap-1 text-xs"
                          role="alert"
                        >
                          <AlertCircle className="mt-0.5 size-3 shrink-0" />
                          {item.error ?? "Upload failed"}
                        </span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            <p className="sr-only" aria-live="polite">
              {uploadAnnouncement}
            </p>
          </div>

          {saveError && <FormError message={saveError} />}

          <Separator />

          <DialogFooter className="sticky bottom-0 flex-row justify-end gap-2 bg-background pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={saving} disabled={saving}>
              {mode === "add" ? "List Product" : "Update Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
