"use client";

import { useState, useRef, ChangeEvent, FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const MAX_IMAGES = 8;
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

interface ImagePreview {
  file: File;
  url: string;
}

export default function SellPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [imageErrors, setImageErrors] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const errors: string[] = [];
    const accepted: ImagePreview[] = [];

    for (const file of selected) {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`${file.name}: unsupported type (use PNG, JPG, or WEBP)`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        errors.push(`${file.name}: exceeds the 2 MB limit`);
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }

    setImages((prev) => {
      const remaining = MAX_IMAGES - prev.length;
      if (accepted.length > remaining) {
        errors.push(
          `Only ${MAX_IMAGES} images allowed; ${accepted.length - remaining} not added`
        );
      }
      return [...prev, ...accepted.slice(0, Math.max(remaining, 0))];
    });

    setImageErrors(errors);

    // Clear the native input so the same file can be selected again.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) {
        URL.revokeObjectURL(removed.url);
      }
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (images.length === 0) {
      setError("Please add at least one image.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("price", price);
      formData.append("description", description);
      images.forEach(({ file }) => formData.append("images", file));

      const response = await fetch("/api/products", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to create product");
      }

      router.push("/marketplace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Sell a product</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="images">
            Images
          </label>
          <p className="mb-2 text-xs text-gray-500">
            PNG, JPG, or WEBP up to 2 MB each (max {MAX_IMAGES}).
          </p>
          <input
            id="images"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={handleImageChange}
            className="block w-full text-sm"
          />
          {imageErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {imageErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {images.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {images.map((image, index) => (
                <div key={image.url} className="relative">
                  <Image
                    src={image.url}
                    alt={image.file.name}
                    width={160}
                    height={160}
                    unoptimized
                    className="h-32 w-full rounded object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-2 py-1 text-xs text-white"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="price">
            Price
          </label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-green-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Create product"}
        </button>
      </form>
    </main>
  );
}
