import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import BannerPreview from "../components/BannerPreview";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useToast } from "../../../components/ui/toast";
import { useAdminTenants, useBanners, useBannerMutations } from "../hooks/useAdmin";
import type { Banner } from "../services/adminService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

export default function AdminBannersPage() {
  const confirm = useConfirm();
  const banners = useBanners();
  const { create, update, remove } = useBannerMutations();
  const editor = useModal();
  const toast = useToast();

  /**
   * A delete that fails silently is the worst version of this: the row simply
   * stays, and the shopkeeper is left pressing Delete on something that will
   * never go. Most refusals here are a REASON — a banner still referenced by
   * something else — so the server's message is what gets shown.
   */
  const removeWithFeedback = (id: string, name: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success(`${name} deleted`),
      onError: (e) => toast.error(e instanceof Error ? e.message : `Couldn't delete this banner.`),
    });


  const [editing, setEditing] = useState<Banner | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ target_type: "shop", placement: "home" });

  // Searchable advertiser picker
  const [shopSearch, setShopSearch] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopOpen, setShopOpen] = useState(false);
  const shopResults = useAdminTenants({ search: shopSearch || undefined });

  const mutation = editing ? update : create;
  const err = mutation.error instanceof ApiError ? mutation.error.firstFieldError() ?? mutation.error.message : null;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * WHAT THE SERVER WILL ACTUALLY TAKE.
   *
   * PHP's own `upload_max_filesize` defaults to 2M, and a file over that never
   * reaches Laravel — the upload arrives invalid and the only thing that comes
   * back is "The image failed to upload", which was reported here verbatim: a
   * 1200x600 PNG out of an image generator, refused with no reason anybody
   * could act on.
   *
   * The rule is 2 MB on both sides now. Checking it HERE as well is not
   * belt-and-braces — it is the difference between an answer in a hundred
   * milliseconds and an answer after a two-megabyte upload that was always
   * going to be thrown away.
   */
  const MAX_BYTES = 2 * 1024 * 1024;

  const [tooBig, setTooBig] = useState<string | null>(null);

  const pickFile = (f: File | null) => {
    if (f != null && f.size > MAX_BYTES) {
      setTooBig(
        `That image is ${(f.size / 1024 / 1024).toFixed(1)} MB. Banners must be under 2 MB — ` +
          "saving it as JPG rather than PNG usually does it.",
      );
      setFile(null);
      setPreview(null);
      return;
    }
    setTooBig(null);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const openCreate = () => {
    setEditing(null); pickFile(null); setShopSearch(""); setShopName(""); setShopOpen(false);
    setForm({ target_type: "shop", placement: "home", is_active: "1" });
    editor.openModal();
  };
  const openEdit = (b: Banner) => {
    setEditing(b); pickFile(null); setShopSearch(""); setShopOpen(false);
    setShopName(b.advertiser?.business_name ?? "");
    setForm({
      title: b.title ?? "", target_type: b.target_type, tenant_id: b.tenant_id ?? "", target_url: b.target_url ?? "",
      placement: b.placement, starts_at: b.starts_at?.slice(0, 10) ?? "", ends_at: b.ends_at?.slice(0, 10) ?? "",
      amount: b.amount != null ? String(b.amount) : "", paid_at: b.paid_at?.slice(0, 10) ?? "", is_active: b.is_active ? "1" : "0",
    });
    editor.openModal();
  };

  /**
   * What a tap will do, in one sentence.
   *
   * The target is three fields — a type, a shop, a URL — and whether they add
   * up to a working link is not readable from any one of them. Saying the
   * OUTCOME is the cheapest way to catch a banner pointing nowhere before it
   * is published, which is otherwise only findable by tapping it on a phone.
   */
  const targetSentence = ((): string | null => {
    const type = form.target_type || "shop";
    if (type === "none") return null;
    if (type === "url") return form.target_url ? `opens ${form.target_url}` : null;
    if (type === "shop") return shopName ? `opens ${shopName}` : null;
    if (type === "product") return form.target_product_id ? "opens that product" : null;
    return null;
  })();

  const save = () => {
    if (mutation.isPending) return;
    if (!editing && !file) return;
    const fd = new FormData();
    if (file) fd.append("image", file);
    fd.append("target_type", form.target_type || "shop");
    fd.append("placement", form.placement || "home");
    fd.append("is_active", form.is_active === "0" ? "0" : "1");
    for (const k of ["title", "tenant_id", "target_url", "starts_at", "ends_at", "amount", "paid_at"]) {
      if (form[k]) fd.append(k, form[k]);
    }
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, data: fd }, opts);
    else create.mutate(fd, opts);
  };

  const rows = banners.data ?? [];

  return (
    <>
      <PageMeta title="Banners | CartZe Admin" description="Promo banners / paid ads" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Promo Banners</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Paid ads shown on the app home. A tap opens the advertiser's shop.</p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New banner</Button>
      </div>

      {banners.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No banners yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <div key={b.id} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
              <img src={b.image_url ?? ""} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 dark:text-white/90">{b.title || "(untitled)"}</span>
                  {!b.is_active && <Badge size="sm" color="light">off</Badge>}
                </div>
                <div className="text-theme-xs text-gray-400">
                  {b.target_type === "shop" ? `→ ${b.advertiser?.business_name ?? "shop"}` : b.target_type === "url" ? `→ ${b.target_url}` : b.target_type}
                  {" · "}{b.impression_count} views · {b.click_count} clicks
                  {b.amount ? ` · fee ${money(b.amount)}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button className={ROW_ACTION} onClick={() => openEdit(b)}>Edit</button>
                <button className={ROW_ACTION_DANGER} onClick={async () => {
                  if (await confirm({ title: "Delete banner?", confirmLabel: "Delete", tone: "danger" })) removeWithFeedback(b.id, "Banner");
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit banner" : "New banner"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-theme-xs text-gray-400">Banner image {editing && "(leave empty to keep)"}</label>
            {/*
              THE PREVIEW, where the decision is made.

              It shows both shapes, because they are not the same shape: the
              phone lays a banner out at 2:1 and the website at roughly 3.5:1,
              both with `object-cover` — so the same artwork keeps its top and
              bottom on one and loses them on the other. There was no way to
              know that without publishing and going to look.
            */}
            <BannerPreview
              src={preview ?? editing?.image_url ?? null}
              title={form.title}
              action={targetSentence}
            />

            <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="text-sm" />
            {/*
              2:1, because that is the ratio the phone draws.

              This said 1200x480 — 2.5:1 — while `PromoCarousel` lays the card
              out at `width / 2`. Every banner uploaded to the old advice was
              being cropped top and bottom by the app, which is where a
              headline goes.
            */}
            <p className="mt-1 text-theme-xs text-gray-400">
              1200×600 (2:1), JPG under 2 MB. Keep text inside the middle 84% — the app crops the edges on narrow phones.
            </p>
            {tooBig && (
              <p className="mt-1 text-theme-xs text-error-500">{tooBig}</p>
            )}
          </div>
          <Input placeholder="Title / caption (optional)" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select defaultValue={form.target_type} options={[{ value: "shop", label: "Opens a shop" }, { value: "url", label: "Opens a URL" }, { value: "none", label: "No action" }]} placeholder="Target" onChange={(v) => set("target_type", v)} />
            <Select defaultValue={form.placement} options={[{ value: "home", label: "Home" }, { value: "marketplace_top", label: "Marketplace top" }]} placeholder="Placement" onChange={(v) => set("placement", v)} />
          </div>
          {form.target_type === "shop" && (
            <div className="relative">
              <label className="mb-1 block text-theme-xs text-gray-400">Advertiser shop</label>
              <Input
                placeholder="Search shop by name…"
                value={shopOpen ? shopSearch : shopName || shopSearch}
                onChange={(e) => { setShopSearch(e.target.value); setShopOpen(true); if (form.tenant_id) set("tenant_id", ""); }}
              />
              {shopOpen && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  {shopResults.isLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                  ) : (shopResults.data?.data ?? []).length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">No shops found.</div>
                  ) : (
                    (shopResults.data?.data ?? []).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { set("tenant_id", t.id); setShopName(t.business_name); setShopSearch(""); setShopOpen(false); }}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5 ${form.tenant_id === t.id ? "bg-brand-50 dark:bg-brand-500/10" : ""}`}
                      >
                        {t.business_name}
                      </button>
                    ))
                  )}
                </div>
              )}
              {form.tenant_id && !shopOpen && (
                <p className="mt-1 text-theme-xs text-success-500">
                  Selected: {shopName}{" "}
                  <button type="button" className="text-gray-400 underline" onClick={() => { set("tenant_id", ""); setShopName(""); setShopSearch(""); setShopOpen(true); }}>change</button>
                </p>
              )}
            </div>
          )}
          {form.target_type === "url" && <Input placeholder="https://…" value={form.target_url ?? ""} onChange={(e) => set("target_url", e.target.value)} />}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-theme-xs text-gray-400">Starts</label><Input type="date" value={form.starts_at ?? ""} onChange={(e) => set("starts_at", e.target.value)} /></div>
            <div><label className="text-theme-xs text-gray-400">Ends</label><Input type="date" value={form.ends_at ?? ""} onChange={(e) => set("ends_at", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-theme-xs text-gray-400">Ad fee (Rs)</label><Input type="number" min="0" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></div>
            <div><label className="text-theme-xs text-gray-400">Paid on</label><Input type="date" value={form.paid_at ?? ""} onChange={(e) => set("paid_at", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={form.is_active !== "0"} onChange={(e) => set("is_active", e.target.checked ? "1" : "0")} /> Active
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || (!editing && !file)}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>
    </>
  );
}
