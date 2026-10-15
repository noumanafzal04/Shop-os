import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersService, type CreditPaymentInput, type CustomerFilter, type CustomerInput } from "../services/customersService";

export function useCustomers(params?: { search?: string; page?: number; standing?: CustomerFilter }) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: () => customersService.list(params),
    placeholderData: keepPreviousData,
  });
}

/** The counts on the list's filters — under ["customers"], so a payment refreshes them. */
export function useCustomerSummary() {
  return useQuery({
    queryKey: ["customers", "summary"],
    queryFn: async () => (await customersService.summary()).data,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customers", "detail", id],
    queryFn: async () => (await customersService.show(id!)).data,
    enabled: !!id,
  });
}

export function useCustomerMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["customers"] });

  const create = useMutation({ mutationFn: (p: CustomerInput) => customersService.create(p), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, ...p }: { id: string } & Partial<CustomerInput>) => customersService.update(id, p),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => customersService.remove(id), onSuccess: invalidate });
  const recordPayment = useMutation({
    mutationFn: ({ id, ...p }: { id: string } & CreditPaymentInput) => customersService.recordPayment(id, p),
    onSuccess: invalidate,
  });

  return { create, update, remove, recordPayment };
}
