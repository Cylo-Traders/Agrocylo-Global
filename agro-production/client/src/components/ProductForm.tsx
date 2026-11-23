import { useState } from 'react';
import { useWallet } from '../context/WalletContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function isLocalhostApi(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

function describeCreateError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'The request timed out. Check your connection and try again.';
  }
  if (err instanceof TypeError) {
    return `Could not reach the API at ${API_URL}. This is usually a network or CORS configuration problem. Check your connection and try again.`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Something went wrong while creating the product. Please try again.';
}

export default function ProductForm() {
  const { address, signMessage } = useWallet();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const configError =
    process.env.NODE_ENV === 'production' && isLocalhostApi(API_URL)
      ? `The API URL is misconfigured (${API_URL}). Set NEXT_PUBLIC_API_URL to your deployed API origin.`
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (configError) {
      setError(configError);
      return;
    }
    if (!address) {
      setError('Connect your wallet before creating a product.');
      return;
    }

    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const signature = await signMessage('Create product');
      const res = await fetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': address,
          'X-Wallet-Signature': signature,
        },
        body: JSON.stringify({ name, price, description }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = `The server rejected the request (${res.status}).`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // keep default message
        }
        throw new Error(message);
      }

      setName('');
      setPrice('');
      setDescription('');
    } catch (err) {
      setError(describeCreateError(err));
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {configError && (
        <p role="alert" className="form-error">
          {configError}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Price
        <input value={price} onChange={(e) => setPrice(e.target.value)} required />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create product'}
      </button>
    </form>
  );
}
