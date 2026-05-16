import { create } from 'zustand';

// Stored from clicking a polygon. The numericId is M49 (what the TopoJSON ships).
// Ideologically the join key for the dataset is ISO 3166-1 alpha-3, populated
// by the data layer once we have a numeric→alpha3 mapping in SQLite.
export type CountrySelection = {
  numericId: string;
  name: string;
  iso3?: string;
  endonym?: string;
  language?: string;
  blurb?: string;
};

type SelectionState = {
  selectedCountry: CountrySelection | null;
  hoveredId: string | null;
  selectCountry: (country: CountrySelection | null) => void;
  hover: (numericId: string | null) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  selectedCountry: null,
  hoveredId: null,
  selectCountry: (country) => set({ selectedCountry: country }),
  hover: (numericId) => set({ hoveredId: numericId }),
}));
