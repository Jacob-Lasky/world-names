// Shared shape for the data layer.
//
// `CountryDetail` is what the DetailPanel renders once a country is selected
// and the DB has resolved its endonym + dominant language. Optional fields
// reflect either "data still loading" or "Wikidata has no label in this
// country's dominant language" (the 9 known endonym gaps).

export type CountryDetail = {
  iso3: string;
  name_en: string;
  endonym: string | null;
  language_code: string | null;
  language_name: string | null;
};

export type Exonym = {
  observer_language_code: string;
  exonym: string;
};

// One row's worth of "what does country X call country Y" detail — the
// secondary card the DetailPanel shows when the user hovers (desktop) or
// taps (mobile) a non-selected country. All fields except observer_name_en
// + exonym can be null when the cluster YAML hasn't covered this pair yet.
export type InspectionDetail = {
  observer_iso3: string;
  observer_name_en: string;
  observer_language_name: string | null;
  exonym: string;
  cluster_label: string | null;
  etymology_origin: string | null;
  hue: number | null;
  similarity: number | null;
};
