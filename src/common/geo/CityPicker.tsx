import { useMemo, useState } from "react";

import Label from "../../components/form/Label";
import Select from "../../components/form/Select";
import { useCities, useCountries, useProvinces, type PlaceCity } from "./places";

/**
 * Country → province → city, as one control.
 *
 * Eight cities fitted one dropdown; 458 do not. A province narrows the list,
 * and choosing a city straight away fills its province in — a counter that
 * knows its city should not have to know its province first. The country is
 * always shown, Pakistan by default, so a country added later is one more
 * line in this list and nothing else changes.
 *
 * The city is a native select labelled "City", as it always was, so every
 * screen, test and screen reader that found it there still does. Renders its
 * fields side by side as siblings, so it sits in whatever grid holds it.
 */
export function CityPicker({
  value,
  onChange,
  required = false,
  error,
  placeholder = "Choose a city",
}: {
  value: string;
  onChange: (cityId: string, city: PlaceCity | null) => void;
  required?: boolean;
  error?: string | null;
  placeholder?: string;
}) {
  const countries = useCountries();
  const provinces = useProvinces();
  const cities = useCities();
  const all = useMemo(() => cities.data ?? [], [cities.data]);
  const chosen = all.find((c) => c.id === value) ?? null;

  // A chosen city decides its own province and country — including one set
  // from outside, by a map pin. What the person narrowed to only matters
  // while no city is chosen; narrowing elsewhere clears the city.
  const [pickedCountry, setCountry] = useState<number | null>(null);
  const [pickedProvince, setProvince] = useState<number | null>(null);
  const home = countries.data?.find((c) => c.iso2 === "PK") ?? countries.data?.[0] ?? null;
  const countryId = chosen?.country_id ?? pickedCountry ?? home?.id ?? null;
  const provinceId = chosen ? chosen.province_id : pickedProvince;

  const provinceList = (provinces.data ?? []).filter((p) => countryId === null || p.country_id === countryId);
  const provinceName = new Map((provinces.data ?? []).map((p) => [p.id, p.name]));

  const shown = all.filter((c) =>
    (provinceId === null || c.province_id === provinceId)
    && (countryId === null || c.country_id === null || c.country_id === countryId),
  );
  // Two real Nasirabads: say which, when both are on the list.
  const named = new Map<string, number>();
  for (const c of shown) named.set(c.name, (named.get(c.name) ?? 0) + 1);
  const label = (c: PlaceCity) =>
    (named.get(c.name) ?? 0) > 1 && c.province_id !== null ? `${c.name} (${provinceName.get(c.province_id) ?? ""})` : c.name;

  return (
    <>
      {(countries.data?.length ?? 0) > 0 && (
        <div>
          <Label>Country</Label>
          <Select
            aria-label="Country"
            value={countryId === null ? "" : String(countryId)}
            options={(countries.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            placeholder={null}
            onChange={(v) => {
              setCountry(Number(v));
              setProvince(null);
              // A city in another country is no longer the answer.
              if (chosen !== null && chosen.country_id !== Number(v)) onChange("", null);
            }}
          />
        </div>
      )}
      <div>
        <Label>Province</Label>
        <Select
          aria-label="Province"
          value={provinceId === null ? "" : String(provinceId)}
          options={[{ value: "", label: "All provinces" }, ...provinceList.map((p) => ({ value: String(p.id), label: p.name }))]}
          placeholder={null}
          onChange={(v) => {
            const next = v === "" ? null : Number(v);
            setProvince(next);
            // A city in another province is no longer the answer.
            if (chosen !== null && chosen.province_id !== next) onChange("", null);
          }}
        />
      </div>
      <div>
        <Label>
          City {required && <span className="text-error-500">*</span>}
        </Label>
        <Select
          aria-label="City"
          value={value}
          options={[...(required ? [] : [{ value: "", label: "—" }]), ...shown.map((c) => ({ value: c.id, label: label(c) }))]}
          placeholder={cities.isLoading ? "Loading cities…" : placeholder}
          onChange={(id) => {
            const city = all.find((c) => c.id === id) ?? null;
            if (city !== null) setProvince(city.province_id);
            onChange(id, city);
          }}
        />
        {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
      </div>
    </>
  );
}
