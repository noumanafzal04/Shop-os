#!/usr/bin/env python3
"""
Cut one country out of the open countries-states-cities dataset
(github.com/dr5hn/countries-states-cities-database, ODbL) into the file
`php artisan shopos:geo <ISO2>` imports.

    python3 -I scripts/geo-extract.py ~/Desktop/geo-data/all.json PK

The dataset's own ids are kept — country, province and city — so adding a
second country later is the same command with its code, and a city is the
same row however many times it is imported. Names lose their accent marks
("Muzaffarābād" -> "Muzaffarabad"): a counter types plain letters, and a map
provider answers in plain letters too.
"""
import json
import sys
import unicodedata
from pathlib import Path


def plain(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).strip()


def coord(value):
    return None if value in (None, "") else round(float(value), 7)


def main(source: str, iso2: str) -> None:
    iso2 = iso2.upper()
    country = next((c for c in json.load(open(source, encoding="utf-8")) if c.get("iso2") == iso2), None)
    if country is None:
        sys.exit(f"{iso2} is not in {source}")

    out = {
        "source": "countries-states-cities-database (dr5hn), ODbL 1.0",
        "country": {
            "id": country["id"],
            "name": plain(country["name"]),
            "iso2": country["iso2"],
            "iso3": country.get("iso3"),
            "phone_code": country.get("phonecode"),
            "currency": country.get("currency"),
            "latitude": coord(country.get("latitude")),
            "longitude": coord(country.get("longitude")),
        },
        "provinces": [
            {
                "id": state["id"],
                "name": plain(state["name"]),
                "type": state.get("type"),
                "latitude": coord(state.get("latitude")),
                "longitude": coord(state.get("longitude")),
                "cities": [
                    {
                        "id": city["id"],
                        "name": plain(city["name"]),
                        "latitude": coord(city.get("latitude")),
                        "longitude": coord(city.get("longitude")),
                    }
                    for city in sorted(state.get("cities", []), key=lambda c: c["id"])
                ],
            }
            for state in sorted(country.get("states", []), key=lambda s: s["id"])
        ],
    }

    target = Path(__file__).resolve().parent.parent / "backend" / "database" / "data" / "geo" / f"{iso2}.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cities = sum(len(p["cities"]) for p in out["provinces"])
    print(f"{target}: {len(out['provinces'])} provinces, {cities} cities")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: geo-extract.py <countries+states+cities.json> <ISO2>")
    main(sys.argv[1], sys.argv[2])
