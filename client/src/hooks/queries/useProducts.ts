"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { queryKeys } from "@/lib/queryKeys";
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  softDeleteProduct,
  adminSetProductVisibility,
  adminDelistProduct,
  type ListProductsParams,
} from "@/services/productService";
import type { ProductWriteInput } from "@/types/product";

/** All products (public market listing). */
export function useProducts(params: ListProductsParams = {}) {
  return useQuery({
    queryKey: queryKeys.products.list(params as Record<string, unknown>),
    queryFn: () => listProducts(params),
  });
}

/** Authenticated farmer's own products. */
export function useMyProducts() {
  const { address, connected } = useWallet();
  return useQuery({
    queryKey: queryKeys.products.mine(address ?? ""),
    queryFn: () =>
      listProducts({ farmer: address!, includeUnavailable: true, pageSize: 100 }),
    enabled: connected && !!address,
  });
}

/** Single product detail. */
export function useProduct(id: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => getProductById(id),
    enabled: !!id,
  });
}

/** Create product (farmer only). Invalidates related lists on success. */
export function useCreateProduct() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductWriteInput) =>
      createProduct(address!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}

/** Update product. Invalidates lists and the specific detail. */
export function useUpdateProduct() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProductWriteInput }) =>
      updateProduct(address!, id, input),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.products.detail(updated.id), updated);
      qc.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}

/** Admin: hide or unhide any product. */
export function useAdminSetVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      adminSetProductVisibility(id, isAvailable),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}

/** Admin: permanently delist a product. */
export function useAdminDelistProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminDelistProduct(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: queryKeys.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}

/** Soft-delete product. */
export function useDeleteProduct() {
  const { address } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteProduct(address!, id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: queryKeys.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.all() });
    },
  });
}
