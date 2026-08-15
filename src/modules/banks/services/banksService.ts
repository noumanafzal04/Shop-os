import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

/**
 * Banks that fund a discount on their own cards.
 *
 * The thing to keep in mind reading any of this: the discount is NOT the
 * shop's. HBL runs the offer, the customer pays less, and HBL reimburses the
 * shop afterwards — so the figures here end up on an invoice to a bank, not
 * just on a receipt.
 */

export type BankOfferType = "percent" | "fixed";
export type CardType = "credit" | "debit";

export interface BankCardOffer {
  id: string;
  bank_id: string;
  label: string;
  type: BankOfferType;
  value: string | number;
  min_spend: string | number | null;
  max_discount: string | number | null;
  /** Empty means any card. Some deals are credit-only. */
  card_types: CardType[] | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  priority: number;
  is_active: boolean;
}

export interface Bank {
  id: string;
  name: string;
  /** Printed where a receipt line is 32 characters and "Habib Bank Limited" is not. */
  short_code: string | null;
  is_active: boolean;
  offers?: BankCardOffer[];
}

export interface BankInput {
  name: string;
  short_code?: string | null;
  is_active?: boolean;
}

export interface BankOfferInput {
  bank_id: string;
  label: string;
  type: BankOfferType;
  value: number;
  min_spend?: number | null;
  max_discount?: number | null;
  card_types?: CardType[] | null;
  starts_on?: string | null;
  ends_on?: string | null;
  days_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  priority?: number;
  is_active?: boolean;
}

/** What the counter is shown: only banks with something running right now. */
export interface LiveBank {
  id: string;
  name: string;
  short_code: string | null;
  offers: Array<{
    id: string;
    label: string;
    type: BankOfferType;
    value: number;
    min_spend: number | null;
    max_discount: number | null;
    card_types: CardType[];
  }>;
}

/**
 * What the server says comes off, for THIS card amount, right now.
 *
 * Display only, and deliberately so: the sale recomputes the same number from
 * the same offer when Complete is pressed. The till never works out money it
 * then sends back — that is the standing rule this whole feature is built
 * inside, the same one that keeps `unit_price` off the wire.
 */
export interface BankQuote {
  offer_id: string | null;
  label: string | null;
  discount: number;
  /** What the customer will actually tap. Worked out server-side. */
  card_payable: number;
}

export const banksService = {
  list: () => apiGet<Bank[]>("/banks"),
  create: (payload: BankInput) => apiPost<Bank>("/banks", payload),
  update: (id: string, payload: BankInput) => apiPut<Bank>(`/banks/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/banks/${id}`),

  createOffer: (payload: BankOfferInput) => apiPost<BankCardOffer>("/bank-offers", payload),
  updateOffer: (id: string, payload: Partial<BankOfferInput>) =>
    apiPut<BankCardOffer>(`/bank-offers/${id}`, payload),
  removeOffer: (id: string) => apiDelete<null>(`/bank-offers/${id}`),

  live: () => apiGet<LiveBank[]>("/banks/live"),

  quote: (payload: { bank_id: string; card_amount: number; card_type?: CardType | null }) =>
    apiPost<BankQuote>("/banks/quote", payload),
};
