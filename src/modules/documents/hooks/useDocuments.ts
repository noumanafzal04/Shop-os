import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentService } from "../services/documentService";
import type { CreateDocumentInput, DocumentKind } from "../services/documentService";

const KEY = ["sale-documents"] as const;

export function useDocuments(params: {
  kind?: DocumentKind;
  status?: string;
  search?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async () => {
      const res = await documentService.list(params);
      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * The counter's headline numbers. Refetched after every write, because the one
 * that matters — how much of the customers' money the shop is holding — is
 * exactly the figure that goes stale silently.
 */
export function useDocumentSummary() {
  return useQuery({
    queryKey: [...KEY, "summary"],
    queryFn: async () => (await documentService.summary()).data,
    staleTime: 30_000,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, "one", id],
    queryFn: async () => (await documentService.show(id!)).data,
    enabled: !!id,
  });
}

export function useDocumentMutations(id?: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    // Holding goods changes what's sellable, and collecting changes the till.
    void qc.invalidateQueries({ queryKey: ["products"] });
    void qc.invalidateQueries({ queryKey: ["pos"] });
  };

  return {
    create: useMutation({
      mutationFn: (payload: CreateDocumentInput) => documentService.create(payload),
      onSuccess: refresh,
    }),
    deposit: useMutation({
      mutationFn: (payload: { amount: number; method?: string; reference?: string; note?: string }) =>
        documentService.deposit(id!, payload),
      onSuccess: refresh,
    }),
    convert: useMutation({
      mutationFn: (payload: Parameters<typeof documentService.convert>[1]) =>
        documentService.convert(id!, payload),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (payload: Parameters<typeof documentService.cancel>[1]) =>
        documentService.cancel(id!, payload),
      onSuccess: refresh,
    }),
  };
}
