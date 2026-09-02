import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import PageMeta from "../../../components/common/PageMeta";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";
import { useGallery, useGalleryMutations } from "../hooks/useShop";

/**
 * Portfolio / gallery — showcase photos on the public storefront (salon work,
 * workshop jobs, storefront shots). Distinct from product images.
 */
export default function PortfolioPage() {
  const toast = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const gallery = useGallery();
  const { upload, remove } = useGalleryMutations();

  if (!hasPermission("settings.manage")) {
    return <Alert variant="error" title="No access" message="You don't have permission to manage the portfolio." />;
  }

  const images = gallery.data ?? [];

  return (
    <>
      <PageMeta title="Portfolio | CartZe" description="Showcase gallery" />
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Portfolio</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Showcase photos shown on your storefront.</p>
        </div>
        <label className="cursor-pointer rounded-lg border border-brand-500 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
          {upload.isPending ? "Uploading…" : "+ Add photos"}
          <input
            type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
            disabled={upload.isPending}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) upload.mutate(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {upload.error instanceof ApiError && (
        <div className="mb-4"><Alert variant="error" title="Upload failed" message={upload.error.message} /></div>
      )}

      {gallery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />)}
        </div>
      ) : images.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No photos yet — add work samples or storefront shots.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              <img src={img.url ?? ""} alt={img.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
              <button
                onClick={() => remove.mutate(img.id, failed(toast, "That picture is still on your page."))}
                disabled={remove.isPending}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white opacity-0 transition group-hover:opacity-100"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
