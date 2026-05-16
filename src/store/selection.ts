import { create } from 'zustand';

// Click-time selection state. The DB layer enriches this (endonym, language,
// ISO3, etc.) via `useCountryDetail(numericId)` when a component needs it —
// the store stays minimal so the click handler doesn't need DB access.
export type CountrySelection = {
  numericId: string;  // M49 numeric, from the polygon
  name: string;       // English label, from the polygon
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
