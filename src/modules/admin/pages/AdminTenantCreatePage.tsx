import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useAdminCities, usePlans, useTenantMutations } from "../hooks/useAdmin";
import { useBusinessTypes } from "../../shop/hooks/useShop";

export default function AdminTenantCreatePage() {
  const navigate = useNavigate();
  const cities = useAdminCities();
  const plans = usePlans();
  const businessTypes = useBusinessTypes();
  const { create } = useTenantMutations();

  const [form, setForm] = useState({
    business_name: "",
    email: "",
    phone: "",
    business_type: "",
    city_id: "",
    plan_id: "",
    owner_name: "",
    owner_email: "",
    owner_password: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        business_name: form.business_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        business_type: form.business_type,
        city_id: form.city_id || undefined,
        plan_id: form.plan_id || undefined,
        owner: {
          name: form.owner_name.trim(),
          email: form.owner_email.trim() || undefined,
          password: form.owner_password,
        },
      },
      { onSuccess: ({ data }) => navigate(`/admin/tenants/${data.id}`) },
    );
  };

  return (
    <>
      <PageMeta title="Create Tenant | ShopOS Admin" description="New business" />
      <div className="mb-6">
        <Link to="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Back to tenants</Link>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">Create Tenant</h2>
      </div>

      {generalError && <div className="mb-5 max-w-2xl"><Alert variant="error" title="Couldn't create" message={generalError} /></div>}

      <form onSubmit={submit} className="max-w-2xl space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Business</h3>
          <div className="space-y-4">
            <div>
              <Label>Business name <span className="text-error-500">*</span></Label>
              <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
              {errorFor("business_name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("business_name")}</p>}
            </div>
            <div>
              <Label>Business type <span className="text-error-500">*</span></Label>
              <Select
                value={form.business_type}
                options={(businessTypes.data ?? []).filter((t) => t.available).map((t) => ({ value: t.code, label: t.label }))}
                placeholder={businessTypes.isLoading ? "Loading…" : "Choose the business type"}
                onChange={(v) => set("business_type", v)}
              />
              <p className="mt-1 text-theme-xs text-gray-400">Drives the tenant's features, default categories and terminology. The owner can't change this.</p>
              {errorFor("business_type") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("business_type")}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                {errorFor("email") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("email")}</p>}
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                {errorFor("phone") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("phone")}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>City</Label>
                <Select
                  options={[{ value: "", label: "—" }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  placeholder="—"
                  onChange={(v) => set("city_id", v)}
                />
              </div>
              <div>
                <Label>Plan</Label>
                <Select
                  options={[{ value: "", label: "No plan yet" }, ...(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
                  placeholder="No plan yet"
                  onChange={(v) => set("plan_id", v)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Owner account</h3>
          <div className="space-y-4">
            <div>
              <Label>Owner name <span className="text-error-500">*</span></Label>
              <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
              {errorFor("owner.name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.name")}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Owner email <span className="text-error-500">*</span></Label>
                <Input type="email" value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} />
                {errorFor("owner.email") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.email")}</p>}
              </div>
              <div>
                <Label>Temp password <span className="text-error-500">*</span></Label>
                <Input type="text" value={form.owner_password} onChange={(e) => set("owner_password", e.target.value)} placeholder="Min. 8 chars" />
                {errorFor("owner.password") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.password")}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button size="sm" disabled={create.isPending || !form.business_name.trim() || !form.business_type || !form.owner_name.trim() || !form.owner_email.trim() || !form.owner_password}>
            {create.isPending ? "Creating…" : "Create tenant"}
          </Button>
          <Link to="/admin/tenants"><Button size="sm" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </>
  );
}
