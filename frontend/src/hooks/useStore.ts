import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, send, getSession } from "../services/api";
import type { Session, Store, Cart, Product, ProductList } from "../types";
export const useSession = () =>
  useQuery<Session>({
    queryKey: ["session"],
    queryFn: getSession,
    enabled: typeof window !== "undefined",
    retry: 1,
    staleTime: 5 * 60000,
  });
export const useStore = () =>
  useQuery<Store>({
    queryKey: ["store"],
    queryFn: () => api("/store"),
    staleTime: 60000,
  });
export const useProducts = (params = "") =>
  useQuery<ProductList>({
    queryKey: ["products", params],
    queryFn: () => api(`/products${params ? "?" + params : ""}`),
    staleTime: 30000,
  });
export const useProduct = (slug: string) =>
  useQuery<Product>({
    queryKey: ["product", slug],
    queryFn: () => api(`/products/${slug}`),
    staleTime: 30000,
  });
export function useCart() {
  const session = useSession();
  return useQuery<Cart>({
    queryKey: ["cart"],
    queryFn: () => api("/cart"),
    enabled: !!session.data,
    staleTime: 15000,
  });
}
export function useCartUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { variantId: string; quantity: number }) =>
      send<Cart>("/cart/items", input, "PUT"),
    onSuccess: (cart) => qc.setQueryData(["cart"], cart),
  });
}
