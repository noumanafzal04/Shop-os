import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogService,
  type Category,
  type CollectionRow,
  type NewProduct,
  type Product,
  type ProductQuery,
} from "../services/catalogService";

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

/**
 * ADD AN ITEM, THEN ITS PICTURE.
 *
 * Two requests, because the server takes them as two: the product is created
 * first and the image is posted against its id. They are NOT one mutation with
 * a rollback — a product that saved and a photo that failed is a product the
 * shop has, and deleting it to keep the two in step would throw away the work.
 * The photo failing says so and the item stays.
 */
export function useCreateProduct() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      body,
      photo,
    }: {
      body: NewProduct;
      photo?: { uri: string; name: string; type: string } | null;
    }) => {
      const created = (await catalogService.create(body)).data;
      if (photo) {
        try {
          await catalogService.uploadImage(created.id, photo);
        } catch {
          // Reported by the screen as a partial success. Swallowed HERE
          // rather than thrown, or the caller cannot tell "no product" from
          // "product, no photo" — two different things to tell somebody.
          return { product: created, photoFailed: true };
        }
      }
      return { product: created, photoFailed: false };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Add, rename and remove — one hook, because they invalidate the same list. */
export function useCategoryEdits() {
  const qc = useQueryClient();
  const after = () => {
    void qc.invalidateQueries({ queryKey: ["categories"] });
    // A product's category name is drawn on its row.
    void qc.invalidateQueries({ queryKey: ["products"] });
  };

  return {
    add: useMutation({ mutationFn: (name: string) => catalogService.createCategory(name), onSuccess: after }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => catalogService.renameCategory(id, name),
      onSuccess: after,
    }),
    remove: useMutation({ mutationFn: (id: string) => catalogService.removeCategory(id), onSuccess: after }),
  };
}

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<CollectionRow[]> => (await catalogService.collections()).data,
  });
}

/** Add, rename, show/hide and remove — one hook, one invalidation. */
export function useCollectionEdits() {
  const qc = useQueryClient();
  const after = () => {
    void qc.invalidateQueries({ queryKey: ["collections"] });
  };

  return {
    add: useMutation({
      mutationFn: (name: string) =>
        // A new shelf is VISIBLE by default. A collection nobody can see is a
        // collection somebody will build and then wonder about.
        catalogService.createCollection({ name, visible_in_marketplace: true }),
      onSuccess: after,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        catalogService.updateCollection(id, { name }),
      onSuccess: after,
    }),
    setVisible: useMutation({
      mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
        catalogService.updateCollection(id, { visible_in_marketplace: visible }),
      onSuccess: after,
    }),
    remove: useMutation({ mutationFn: (id: string) => catalogService.removeCollection(id), onSuccess: after }),
  };
}

export type { Category, CollectionRow };
