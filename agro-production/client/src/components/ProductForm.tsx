import { useState, useRef, ChangeEvent, FormEvent } from 'react';

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGES = 8;

interface ProductFormProps {
  onSubmit?: (data: { name: string; price: string; images: File[] }) => void;
}

interface ImageError {
  filename: string;
  reason: string;
}

export default function ProductForm({ onSubmit }: ProductFormProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imageErrors, setImageErrors] = useState<ImageError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const errors: ImageError[] = [];
    const accepted: File[] = [];

    for (const file of selected) {
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        errors.push({
          filename: file.name,
          reason: 'Unsupported file type. Use PNG, JPG, or WEBP.',
        });
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        errors.push({
          filename: file.name,
          reason: 'File exceeds the 2 MB size limit.',
        });
        continue;
      }
      accepted.push(file);
    }

    setImageErrors(errors);
    if (accepted.length > 0) {
      setImages((prev) => {
        const combined = [...prev, ...accepted];
        if (combined.length > MAX_IMAGES) {
          setImageErrors((current) => [
            ...current,
            {
              filename: accepted[accepted.length - 1].name,
              reason: `You can upload at most ${MAX_IMAGES} images.`,
            },
          ]);
          return combined.slice(0, MAX_IMAGES);
        }
        return combined;
      });
    }

    // Clear the native input so the same rejected file can be selected again.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.({ name, price, images });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="product-name">Name</label>
        <input
          id="product-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="product-price">Price</label>
        <input
          id="product-price"
          type="text"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="product-images">Images</label>
        <input
          id="product-images"
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={handleImageChange}
        />
        <p>PNG, JPG, or WEBP up to 2 MB each (max {MAX_IMAGES} images).</p>

        {imageErrors.length > 0 && (
          <ul role="alert">
            {imageErrors.map((error, index) => (
              <li key={`${error.filename}-${index}`}>
                {error.filename}: {error.reason}
              </li>
            ))}
          </ul>
        )}

        {images.length > 0 && (
          <ul>
            {images.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                {file.name}
                <button type="button" onClick={() => handleRemoveImage(index)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="submit">Save product</button>
    </form>
  );
}
