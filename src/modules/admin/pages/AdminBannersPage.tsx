import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import { BoxCubeIcon } from "../../../icons";
import { Card, Empty, PageHeader } from "../components/kit";
import BannerPreview from "../components/BannerPreview";
import HeroBannerPreview from "../components/HeroBannerPreview";
import {
  contrastWithWhite,
  HERO_MIN_CONTRAST,
  HERO_PICTURE_DEFAULT,
  HERO_PICTURE_MAX,
  HERO_PICTURE_MIN,
  HERO_SWATCHES,
  isHex,
  readsUnderWhite,
} from "../heroColor";
import { bannerShapeProblem, measureImage } from "../bannerShape";
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
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { PKR, platformMoney } from "../../../common/format/currency";

const money = (n: string | number) => platformMoney(n);

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
   * A TOP-HEADER BANNER heads the app's home in its own colour and is shown
   * nowhere else. Made of words (colour, title, line, button, picture) or as
   * one finished image — both asked for.
   */
  const isTop = form.placement === "home_top";
  const heroStyle: "words" | "artwork" = form.hero_style === "artwork" ? "artwork" : "words";
  const wordsTop = isTop && heroStyle === "words";
  const colour = form.hero_color ?? "";
  const colourProblem = !isTop
    ? null
    : !isHex(colour)
      ? "Pick a colour."
      : !readsUnderWhite(colour)
        ? `White text is hard to read on ${colour} (contrast ${contrastWithWhite(colour)}:1, needs ${HERO_MIN_CONTRAST}:1). Pick a darker one.`
        : null;
  const setTop = (on: boolean) =>
    setForm((f) => ({
      ...f,
      placement: on ? "home_top" : "home",
      hero_style: f.hero_style || "words",
      hero_color: f.hero_color || HERO_SWATCHES[0],
      hero_image_size: f.hero_image_size || String(HERO_PICTURE_DEFAULT),
    }));

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

  /**
   * ONE PLACE FOR "THIS FILE WILL NOT DO", whichever thing is wrong with it.
   *
   * Size and shape were going to be two independent red lines under one input,
   * which reads as two problems when it is one file to replace.
   */
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  const pickFile = async (f: File | null) => {
    if (f == null) {
      setFileProblem(null);
      setFile(null);
      setPreview(null);
      return;
    }

    if (f.size > MAX_BYTES) {
      setFileProblem(
        `That image is ${(f.size / 1024 / 1024).toFixed(1)} MB. Banners must be under 2 MB — ` +
          "saving it as JPG rather than PNG usually does it.",
      );
      setFile(null);
      setPreview(null);
      return;
    }

    /**
     * THE SHAPE, BEFORE THE UPLOAD.
     *
     * `BannerRequest::checkShape()` is the gate and refuses this anyway. Asking
     * here as well buys the clock: the same sentence in a hundred milliseconds
     * rather than after two megabytes have crossed a phone network to be
     * thrown away. Same arrangement as the size check above.
     */
    // A picture beside a top banner's words may be any shape — only artwork
    // that FILLS a card is held to 2:1.
    const measured = wordsTop ? null : await measureImage(f);
    const shape = measured ? bannerShapeProblem(measured.width, measured.height) : null;
    if (shape != null) {
      setFileProblem(shape);
      setFile(null);
      setPreview(null);
      return;
    }

    setFileProblem(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
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
      body: b.body ?? "", cta_label: b.cta_label ?? "", hero_color: b.hero_color ?? "", hero_style: b.hero_style ?? "",
      hero_image_size: b.hero_image_size != null ? String(b.hero_image_size) : "",
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
    if (!canSave) return;
    const fd = new FormData();
    if (file) fd.append("image", file);
    fd.append("target_type", form.target_type || "shop");
    fd.append("placement", form.placement || "home");
    fd.append("is_active", form.is_active === "0" ? "0" : "1");
    for (const k of ["title", "tenant_id", "target_url", "starts_at", "ends_at", "amount", "paid_at"]) {
      if (form[k]) fd.append(k, form[k]);
    }
    if (isTop) {
      fd.append("hero_style", heroStyle);
      fd.append("hero_color", colour);
      // Sent even when empty, so clearing the line or the button on an edit
      // clears it on the phone too.
      fd.append("body", form.body ?? "");
      fd.append("cta_label", form.cta_label ?? "");
      fd.append("hero_image_size", form.hero_image_size || String(HERO_PICTURE_DEFAULT));
    }
    const opts = { onSuccess: () => editor.closeModal() };
    if (editing) update.mutate({ id: editing.id, data: fd }, opts);
    else create.mutate(fd, opts);
  };

  const hasPicture = !!file || !!editing?.image_url;
  const canSave =
    !colourProblem &&
    (wordsTop ? !!(form.title ?? "").trim() : hasPicture);

  const rows = banners.data ?? [];

  return (
    <>
      <PageMeta title="Banners" area="Admin" description="Promo banners / paid ads" />
      <PageHeader
        icon={<BoxCubeIcon />}
        tone="purple"
        title="Banners & Ads"
        subtitle="Paid ads shown on the app's home. A tap opens the advertiser's shop."
        actions={<Button size="sm" onClick={openCreate}>+ New banner</Button>}
      />

      {banners.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}</div>
      ) : rows.length === 0 ? (
        <ListEmpty from={banners} what="the banners">
          <Card>
            <Empty
              icon={<BoxCubeIcon />}
              title="No banners yet"
              hint="A banner is a picture on the app's home that opens one shop. Make the first one for a shop that has paid for the space."
              action={<Button size="sm" onClick={openCreate}>+ New banner</Button>}
            />
          </Card>
        </ListEmpty>
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <div key={b.id} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
              {b.placement === "home_top" ? (
                <div
                  className="flex h-16 w-28 shrink-0 items-center justify-end overflow-hidden rounded-lg px-1"
                  style={{ backgroundColor: b.hero_color ?? undefined }}
                >
                  {b.image_url && (
                    <img src={b.image_url} alt="" className={b.hero_style === "artwork" ? "h-full w-full rounded object-cover" : "h-12 w-12 object-contain"} />
                  )}
                </div>
              ) : (
                <img src={b.image_url ?? ""} alt="" className="h-16 w-28 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 dark:text-white/90">{b.title || "(untitled)"}</span>
                  {b.placement === "home_top" && <Badge size="sm" color="primary">Top header</Badge>}
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

      <Modal isOpen={editor.isOpen} onClose={editor.closeModal} className={`${isTop ? "max-w-4xl" : "max-w-lg"} p-6`}>
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{editing ? "Edit banner" : "New banner"}</h3>
        {err && <div className="mb-3"><Alert variant="error" title="Couldn't save" message={err} /></div>}
        <label className="mb-3 flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
          <input type="checkbox" className="mt-0.5" checked={isTop} onChange={(e) => setTop(e.target.checked)} />
          <span>
            <span className="font-medium">Top header banner</span>
            <span className="block text-theme-xs text-gray-400">
              Shows only at the very top of the app's home, and the whole header takes its colour. Unticked, it shows in the strip further down.
            </span>
          </span>
        </label>
        <div className={isTop ? "grid gap-6 md:grid-cols-[1fr_auto]" : ""}>
        <div className="space-y-3">
          {isTop && (
            <>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How it is made">
                {([
                  ["words", "Design it here", "Colour, words, button and a picture"],
                  ["artwork", "Upload full image", "One finished 1200×600 image"],
                ] as const).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={heroStyle === value}
                    onClick={() => { set("hero_style", value); pickFile(null); }}
                    className={`rounded-xl border p-3 text-left text-sm ${heroStyle === value ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-gray-200 dark:border-gray-700"}`}
                  >
                    <span className="block font-medium text-gray-800 dark:text-white/90">{label}</span>
                    <span className="block text-theme-xs text-gray-400">{hint}</span>
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-theme-xs text-gray-400">Header colour</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="color"
                    aria-label="Header colour"
                    value={isHex(colour) ? colour : HERO_SWATCHES[0]}
                    onChange={(e) => set("hero_color", e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded border border-gray-200 bg-transparent dark:border-gray-700"
                  />
                  <div className="w-28"><Input value={colour} onChange={(e) => set("hero_color", e.target.value.trim())} placeholder="#03444a" /></div>
                  {HERO_SWATCHES.map((sw) => (
                    <button
                      key={sw}
                      type="button"
                      aria-label={`Use ${sw}`}
                      onClick={() => set("hero_color", sw)}
                      className={`h-7 w-7 rounded-full border-2 ${colour.toLowerCase() === sw ? "border-gray-900 dark:border-white" : "border-transparent"}`}
                      style={{ backgroundColor: sw }}
                    />
                  ))}
                </div>
                {colourProblem && <p className="mt-1 text-theme-xs text-error-500">{colourProblem}</p>}
              </div>
            </>
          )}
          <div>
            <label className="mb-1 block text-theme-xs text-gray-400">
              {wordsTop ? "Picture or icon (optional, any shape — a PNG with a clear background looks best)" : "Banner image"} {editing && "(leave empty to keep)"}
            </label>
            {/*
              THE PREVIEW, where the decision is made.

              It shows both shapes, because they are not the same shape: the
              phone lays a banner out at 2:1 and the website at roughly 3.5:1,
              both with `object-cover` — so the same artwork keeps its top and
              bottom on one and loses them on the other. There was no way to
              know that without publishing and going to look.
            */}
            {!isTop && (
              <BannerPreview
                src={preview ?? editing?.image_url ?? null}
                title={form.title}
                action={targetSentence}
              />
            )}

            <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} className="text-sm" />
            {/*
              2:1, because that is the ratio the phone draws.

              This said 1200x480 — 2.5:1 — while `PromoCarousel` lays the card
              out at `width / 2`.

              And it went on to blame the phone: "the app crops the edges on
              narrow phones". The card is the screen width less 32 points and
              half that in height, so it is 2:1 at EVERY width — the crop comes
              from the file's ratio and never from the screen. That sentence
              sent somebody looking for a phone-size problem that does not
              exist.

              A too-wide file is scaled to the card's HEIGHT and spills
              sideways, so 1200x480 lost a fifth of its WIDTH — a tenth off
              each side, which is where a logo and a price sit. This comment
              said top and bottom.
            */}
            {wordsTop && (preview || editing?.image_url) && (
              <div className="mt-2">
                <label className="block text-theme-xs text-gray-400">
                  Picture size: {form.hero_image_size || HERO_PICTURE_DEFAULT}
                </label>
                <input
                  type="range"
                  aria-label="Picture size"
                  min={HERO_PICTURE_MIN}
                  max={HERO_PICTURE_MAX}
                  step={4}
                  value={Number(form.hero_image_size || HERO_PICTURE_DEFAULT)}
                  onChange={(e) => set("hero_image_size", e.target.value)}
                  className="w-full"
                />
              </div>
            )}
            {!wordsTop && <p className="mt-1 text-theme-xs text-gray-400">
              1200×600 (2:1), JPG under 2 MB. Anything else is refused — the app fills a 2:1 card, so a taller or wider file loses its edges. The ratio is the same on every phone.
            </p>}
            {fileProblem && (
              <p className="mt-1 text-theme-xs text-error-500">{fileProblem}</p>
            )}
          </div>
          <Input
            placeholder={wordsTop ? "Title (shown big on the header)" : "Title / caption (optional)"}
            value={form.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
          />
          {wordsTop && (
            <>
              <Input placeholder="Description (one short line, optional)" value={form.body ?? ""} onChange={(e) => set("body", e.target.value)} />
              <Input placeholder="Button text, e.g. Order now (optional)" value={form.cta_label ?? ""} onChange={(e) => set("cta_label", e.target.value)} />
            </>
          )}
          <div className={isTop ? "" : "grid grid-cols-2 gap-3"}>
            <Select defaultValue={form.target_type} options={[{ value: "shop", label: "Opens a shop" }, { value: "url", label: "Opens a link (URL)" }, { value: "none", label: "No action" }]} placeholder="Target" onChange={(v) => set("target_type", v)} />
            {!isTop && (
              <Select defaultValue={form.placement} options={[{ value: "home", label: "Home" }, { value: "marketplace_top", label: "Marketplace top" }]} placeholder="Placement" onChange={(v) => set("placement", v)} />
            )}
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
                    <ListEmpty from={shopResults} what="the shops">
                      <div className="px-3 py-2 text-sm text-gray-400">No shops found.</div>
                    </ListEmpty>
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
            <div><label className="text-theme-xs text-gray-400">Ad fee ({PKR.symbol})</label><Input type="number" min="0" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></div>
            <div><label className="text-theme-xs text-gray-400">Paid on</label><Input type="date" value={form.paid_at ?? ""} onChange={(e) => set("paid_at", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={form.is_active !== "0"} onChange={(e) => set("is_active", e.target.checked ? "1" : "0")} /> Active
          </label>
        </div>
        {isTop && (
          <div className="md:sticky md:top-0 md:self-start">
            <HeroBannerPreview
              colour={colour}
              style={heroStyle}
              title={form.title ?? ""}
              body={form.body ?? ""}
              cta={form.cta_label ?? ""}
              picture={preview ?? editing?.image_url ?? null}
              pictureSize={Number(form.hero_image_size || HERO_PICTURE_DEFAULT)}
            />
          </div>
        )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={editor.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={mutation.isPending || !canSave}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Modal>
    </>
  );
}
