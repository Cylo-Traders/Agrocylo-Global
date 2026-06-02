"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImagePlus, UploadCloud, X, Info, Camera } from "lucide-react";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per photo
const MAX_FILES = 6;
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
];
const ACCEPTED_TYPES_STRING = ACCEPTED_TYPES.join(",");

function bytesToLabel(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function canvasEncodeImage(file: File, quality = 0.85): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    const maxDimension = 1920;
    let { naturalWidth: width, naturalHeight: height } = image;
    if (width > maxDimension || height > maxDimension) {
      const scale = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return file;
    }

    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        file.type === "image/png" ? "image/png" : "image/jpeg",
        quality,
      );
    });

    if (!blob) {
      return file;
    }

    return new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function stripExifMetadata(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  // Re-encode the image through a canvas to remove EXIF metadata.
  return canvasEncodeImage(file, 0.95);
}

interface PhotoPreview {
  id: string;
  file: File;
  previewUrl: string;
}

export interface OrderPhotoUploadValue {
  files: File[];
}

interface OrderPhotoUploadProps {
  value?: File[];
  onChange?: (files: File[]) => void;
  maxFiles?: number;
  maxFileSizeMb?: number;
  disabled?: boolean;
  hint?: string;
}

export default function OrderPhotoUpload({
  value = [],
  onChange,
  maxFiles = MAX_FILES,
  maxFileSizeMb = 8,
  disabled = false,
  hint,
}: OrderPhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<PhotoPreview[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const maxBytes = maxFileSizeMb * 1024 * 1024;

  const acceptedText = useMemo(
    () => `Accepts JPG, PNG, WEBP, HEIC · up to ${maxFileSizeMb} MB each.`,
    [maxFileSizeMb],
  );

  const revertPreviews = useCallback(() => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));
  }, [previews]);

  useEffect(() => {
    if (value.length === 0) {
      setPreviews([]);
      setErrors([]);
      return;
    }

    const newPreviews = value.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    revertPreviews();
    setPreviews(newPreviews);
    return () => {
      newPreviews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));
    };
  }, [value, revertPreviews]);

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.previewUrl));
    };
  }, [previews]);

  const validateFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        return "Only JPG, PNG, WEBP, or HEIC images are allowed.";
      }
      if (file.size > maxBytes) {
        return `File is too large. Maximum size is ${bytesToLabel(maxBytes)}.`;
      }
      return null;
    },
    [maxBytes],
  );

  const updateFiles = useCallback(
    (files: File[]) => {
      const validFiles = files.slice(0, maxFiles);
      onChange?.(validFiles);
    },
    [maxFiles, onChange],
  );

  const processFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (disabled) {
        return;
      }

      const nextFiles = Array.from(fileList);
      const currentCount = previews.length;
      const allowedCount = Math.max(0, maxFiles - currentCount);
      const fileCandidates = nextFiles.slice(0, allowedCount);
      const nextErrors: string[] = [];
      const resultFiles: File[] = [...value];

      for (const file of fileCandidates) {
        const error = validateFile(file);
        if (error) {
          nextErrors.push(`${file.name}: ${error}`);
          continue;
        }

        try {
          const strippedFile = await stripExifMetadata(file);
          const normalizedFile = strippedFile.size > maxBytes ? await canvasEncodeImage(strippedFile, 0.8) : strippedFile;
          resultFiles.push(normalizedFile);
        } catch {
          nextErrors.push(`${file.name}: Failed to process image.`);
        }
      }

      if (nextErrors.length > 0) {
        setErrors(nextErrors);
      } else {
        setErrors([]);
      }

      if (resultFiles.length > maxFiles) {
        resultFiles.splice(maxFiles);
      }

      updateFiles(resultFiles);
    },
    [disabled, maxFiles, previews.length, updateFiles, validateFile, value, maxBytes],
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void processFiles(files);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) {
      void processFiles(event.dataTransfer.files);
    }
  };

  const handleRemove = (id: string) => {
    const next = previews.filter((preview) => preview.id !== id).map((preview) => preview.file);
    updateFiles(next);
  };

  const onBrowseClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="text-sm font-semibold">Upload delivery photos</p>
          <p className="text-muted-foreground text-sm">{hint ?? "Add clear photos that document received items and any damage."}</p>
        </div>
        <Button type="button" variant="outline" onClick={onBrowseClick} disabled={disabled}>
          <UploadCloud className="size-4" />
          Select photos
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES_STRING}
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />

      <div
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={onBrowseClick}
        className={cn(
          "rounded-3xl border border-dashed p-5 text-center transition-colors sm:p-6",
          dragOver ? "border-primary bg-primary/5" : "border-border bg-secondary/40",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
          <Camera className="size-5" />
        </div>
        <p className="mt-4 text-sm font-medium">Drag & drop up to {maxFiles} images, or click to browse.</p>
        <p className="mt-2 text-xs text-muted-foreground">{acceptedText}</p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <Info className="size-4 mt-0.5" />
            <div>
              <p className="font-semibold">Photo upload issues</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-destructive/90">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {previews.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {previews.map((preview) => (
            <div key={preview.id} className="group relative overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <button
                type="button"
                onClick={() => handleRemove(preview.id)}
                className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition hover:bg-destructive hover:text-white"
                aria-label={`Remove ${preview.file.name}`}
              >
                <X className="size-4" />
              </button>
              <div className="overflow-hidden rounded-t-3xl bg-zinc-950/5">
                <img
                  src={preview.previewUrl}
                  alt={preview.file.name}
                  className="h-44 w-full object-cover transition duration-200 hover:scale-[1.02]"
                />
              </div>
              <div className="space-y-1 p-3 text-sm">
                <p className="font-medium truncate">{preview.file.name}</p>
                <p className="text-muted-foreground">{bytesToLabel(preview.file.size)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
