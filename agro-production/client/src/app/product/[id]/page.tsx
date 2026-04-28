import React from 'react';
import type { Metadata } from 'next';
import { getProduct } from '@/lib/productService';

export const metadata: Metadata = {
  title: 'Product Detail',
};

export default async function ProductDetail({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  return (
    <section className="max-w-2xl mx-auto p-4 bg-[var(--color-background)] text-[var(--color-foreground)]">
      <img src={product.image} alt={product.name} className="w-full h-auto rounded" />
      <h1 className="text-2xl font-bold mt-4" style={{ color: 'var(--color-primary-500)' }}>{product.name}</h1>
      <p className="mt-2" style={{ color: 'var(--color-secondary-500)' }}>Price: ${product.price}</p>
      <div className="mt-4 flex items-center">
        <img src={product.farmer.avatar} alt={product.farmer.name} className="w-10 h-10 rounded-full mr-2" />
        <span>{product.farmer.name}</span>
      </div>
      <button
        className="mt-6 px-4 py-2 bg-[var(--color-primary-600)] text-white rounded hover:bg-[var(--color-primary-700)]"
        onClick={() => alert('Buy clicked')}
      >
        Buy
      </button>
    </section>
  );
}
