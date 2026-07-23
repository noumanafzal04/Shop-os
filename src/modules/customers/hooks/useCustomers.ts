import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customersService, type CreditPaymentInput, type CustomerInput } from "../services/customersService";

export function useCustomers(params?: { search?: string; page?: number }) {
  return useQuery({
    queryKey: ["customers", params],
    queryFn: () => customersService.list(params),
    placeholderData: keepPreviousData,
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
