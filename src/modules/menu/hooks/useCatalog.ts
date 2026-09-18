import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogService, type Category, type Product, type ProductQuery } from "../services/catalogService";

export function useProducts(query: ProductQuery) {
  return useQuery({
    queryKey: ["products", query],
    queryFn: async () => {
      const res = await catalogService.list(query);
      return { products: res.data, pagination: res.meta?.pagination };
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<Category[]> => (await catalogService.categories()).data,
    // Categories change about as often as the shop is repainted.
    staleTime: 10 * 60_000,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ["product", id],
    queryFn: async (): Promise<Product> => (await catalogService.show(id)).data,
  });
}

/**
 * ON AND OFF THE MENU, OPTIMISTICALLY.
 *
 * ── Why this one is optimistic and the order actions are not ─────────
 *
 * Because of WHEN it is pressed. The biryani has just run out, somebody is at
 * the counter, and the shopkeeper's thumb is already moving to the next thing.
 * A row that waits for a round trip before changing reads as a press that did
 * not register, and the second press is the one that puts it back on.
 *
 * Advancing an order is different: it is a decision with a customer message
 * behind it, made once, while looking at the screen.
 *
 * The server is idempotent for `markSoldOut` — a second press keeps the first
 * time — so the worst case here is a row that flips back on failure, which is
 * exactly what it should do.
 */
export function useSoldOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, soldOut }: { id: string; soldOut: boolean }) =>
      soldOut ? catalogService.markSoldOut(id) : catalogService.putBack(id),

    onMutate: async ({ id, soldOut }): Promise<{ before: Array<[readonly unknown[], { products: Product[] } | undefined]> }> => {
      await qc.cancelQueries({ queryKey: ["products"] });
      const before = qc.getQueriesData<{ products: Product[] }>({ queryKey: ["products"] }) as Array<
        [readonly unknown[], { products: Product[] } | undefined]
      >;

      for (const [key, value] of before) {
        if (!value) continue;
        qc.setQueryData(key, {
          ...value,
          products: value.products.map((p) =>
            p.id === id ? { ...p, sold_out_at: soldOut ? new Date().toISOString() : null } : p,
          ),
        });
      }

      // Handed to onError so a failure puts back exactly what was there,
      // rather than a refetch that races the next press.
      return { before };
    },

    onError: (_e, _vars, ctx) => {
      for (const [key, value] of ctx?.before ?? []) qc.setQueryData(key, value);
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      // The dashboard counts what is out of stock; it is the same fact.
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<Product> }) =>
      catalogService.update(id, changes),
    onSuccess: (_res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product", id] });
    },
  });
}
