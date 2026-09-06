import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

/** One review this person wrote, and the shop it is about. */
export interface MyReview {
  id: string;
  shop_slug: string | null;
  shop_name: string | null;
  rating: number;
  comment: string | null;
  /** What the shop wrote back, if anything. Public, and worth showing. */
  reply: string | null;
  replied_at: string | null;
  created_at: string | null;
}

export const reviewService = {
  /**
   * Unpaginated, and that is the server's own bound rather than an oversight:
   * one review per shop, and a person reviews the shops they buy from.
   */
  mine: () => apiGet<MyReview[]>("/customer/reviews"),

  /**
   * ONE REVIEW PER SHOP — this both creates and replaces. The screen says
   * "Update" rather than "Post" when one already exists, because a person who
   * thinks they are adding a second and finds their first gone has been
   * misled by the button.
   */
  save: (payload: { shop_slug: string; rating: number; comment?: string | null }) =>
    apiPost<MyReview>("/customer/reviews", payload),

  remove: (id: string) => apiDelete<null>(`/customer/reviews/${id}`),
};
