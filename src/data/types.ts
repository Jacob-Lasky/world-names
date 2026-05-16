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
