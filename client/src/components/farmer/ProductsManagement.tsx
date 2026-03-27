"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, Text, Button, Input, Badge } from "@/components/ui";
import { listProducts, createProduct, updateProduct, softDeleteProduct } from "@/services/productService";
import { useWallet } from "@/hooks/useWallet";
import type { ProductCategory, ProductCurrency, ProductUnit, Product } from "@/types/product";

interface ProductsManagementProps {
  farmerAddress: string;
}

export default function ProductsManagement({ farmerAddress }: ProductsManagementProps) {
  const { address } = useWallet();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: null as ProductCategory | null,
    price_per_unit: "",
    currency: "XLM" as ProductCurrency,
    unit: "kg" as ProductUnit,
    stock_quantity: "",
    location: "",
    delivery_window: "",
    is_available: true,
  });

  const fetchProducts = useCallback(async () => {
    if (!farmerAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await listProducts({
        farmer: farmerAddress,
        includeUnavailable: true,
      });
      setProducts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch products");
    } finally {
      setIsLoading(false);
    }
  }, [farmerAddress]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;

    setIsLoading(true);
    setError(null);

    try {
      if (editingProduct) {
        // Update existing product
        const updated = await updateProduct(address, editingProduct.id, formData);
        setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
        setEditingProduct(null);
      } else {
        // Create new product
        const created = await createProduct(address, formData);
        setProducts(prev => [created, ...prev]);
        setShowAddForm(false);
      }

      // Reset form
      setFormData({
        name: "",
        description: "",
        category: null,
        price_per_unit: "",
        currency: "XLM",
        unit: "kg",
        stock_quantity: "",
        location: "",
        delivery_window: "",
        is_available: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || "",
      category: product.category,
      price_per_unit: product.price_per_unit,
      currency: product.currency,
      unit: product.unit,
      stock_quantity: product.stock_quantity || "",
      location: product.location,
      delivery_window: product.delivery_window,
      is_available: product.is_available,
    });
  };

  const handleDelete = async (productId: string) => {
    if (!address) return;
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      await softDeleteProduct(address, productId);
      setProducts(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete product");
    }
  };

  const toggleAvailability = async (product: Product) => {
    if (!address) return;

    try {
      const updated = await updateProduct(address, product.id, {
        is_available: !product.is_available,
      });
      setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update availability");
    }
  };

  const categories: ProductCategory[] = ["Vegetables", "Fruits", "Grains", "Tubers", "Livestock", "Other"];
  const currencies: ProductCurrency[] = ["STRK", "USDC"];
  const units: ProductUnit[] = ["kg", "bag", "crate", "piece", "litre", "dozen"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Text variant="h3" as="h3">Products Management</Text>
          <Text variant="body" muted>Manage your product listings</Text>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowAddForm(true)}
          disabled={showAddForm || editingProduct !== null}
        >
          Add Product
        </Button>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingProduct) && (
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>
              {editingProduct ? "Edit Product" : "Add New Product"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Product Name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
                <Input
                  label="Price per Unit"
                  value={formData.price_per_unit}
                  onChange={(e) => setFormData(prev => ({ ...prev, price_per_unit: e.target.value }))}
                  type="number"
                  step="0.01"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Category</label>
                  <select
                    value={formData.category || ""}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      category: e.target.value as ProductCategory || null 
                    }))}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Currency</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      currency: e.target.value as ProductCurrency 
                    }))}
                    className="w-full p-2 border rounded-md"
                  >
                    {currencies.map(curr => (
                      <option key={curr} value={curr}>{curr}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Unit</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      unit: e.target.value as ProductUnit 
                    }))}
                    className="w-full p-2 border rounded-md"
                  >
                    {units.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Stock Quantity"
                  value={formData.stock_quantity}
                  onChange={(e) => setFormData(prev => ({ ...prev, stock_quantity: e.target.value }))}
                  placeholder="Leave empty if unlimited"
                />
                <Input
                  label="Location"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full p-2 border rounded-md"
                  rows={3}
                />
              </div>

              <Input
                label="Delivery Window"
                value={formData.delivery_window}
                onChange={(e) => setFormData(prev => ({ ...prev, delivery_window: e.target.value }))}
                placeholder="e.g., 2-3 days"
                required
              />

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_available"
                  checked={formData.is_available}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_available: e.target.checked }))}
                />
                <label htmlFor="is_available" className="text-sm">
                  Available for purchase
                </label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={isLoading}>
                  {isLoading ? "Saving..." : (editingProduct ? "Update" : "Create")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingProduct(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Products List */}
      {products.length === 0 && !isLoading ? (
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-8">
            <Text variant="h4" as="h4" className="mb-2 text-muted">
              No Products Listed
            </Text>
            <Text variant="body" muted>
              Start by adding your first product to the marketplace.
            </Text>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <Card key={product.id} variant="elevated" padding="lg">
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <Text variant="h4" as="h4">{product.name}</Text>
                    <Badge variant={product.is_available ? "success" : "secondary"}>
                      {product.is_available ? "Available" : "Unavailable"}
                    </Badge>
                  </div>
                  <Text variant="h3" as="h3" className="text-primary">
                    {product.price_per_unit} {product.currency}
                  </Text>
                </div>

                {product.description && (
                  <Text variant="bodySmall" muted>
                    {product.description}
                  </Text>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <Text variant="caption" muted>Category:</Text>
                    <Text variant="bodySmall">{product.category || "N/A"}</Text>
                  </div>
                  <div className="flex justify-between">
                    <Text variant="caption" muted>Unit:</Text>
                    <Text variant="bodySmall">{product.unit}</Text>
                  </div>
                  <div className="flex justify-between">
                    <Text variant="caption" muted>Stock:</Text>
                    <Text variant="bodySmall">
                      {product.stock_quantity || "Unlimited"}
                    </Text>
                  </div>
                  <div className="flex justify-between">
                    <Text variant="caption" muted>Location:</Text>
                    <Text variant="bodySmall">{product.location}</Text>
                  </div>
                  <div className="flex justify-between">
                    <Text variant="caption" muted>Delivery:</Text>
                    <Text variant="bodySmall">{product.delivery_window}</Text>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(product)}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAvailability(product)}
                    className="flex-1"
                  >
                    {product.is_available ? "Hide" : "Show"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(product.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Card variant="elevated" padding="lg" className="bg-red-50 border-red-200">
          <CardContent>
            <Text variant="body" className="text-red-700">
              Error: {error}
            </Text>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
