import { useNavigate, useParams } from "react-router";
import ProductEditor from "./ProductFormPage";

/**
 * Route wrapper for the product editor drawer. Rendered as a CHILD of
 * ProductsPage's <Outlet>, so the list stays mounted underneath (filters and
 * scroll are preserved) while the drawer floats over it. Handles both
 * /products/new (no id → create) and /products/:id/edit.
 */
export default function ProductEditorRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <ProductEditor id={id} onClose={() => navigate("/tenant/products")} />;
}
