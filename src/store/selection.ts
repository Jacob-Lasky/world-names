import { create } from 'zustand';

export type CountrySelection = {
  iso3: string;
  endonym: string;
  language: string;
  blurb?: string;
};

type SelectionState = {
  selectedCountry: CountrySelection | null;
  hoveredIso3: string | null;
  selectCountry: (country: CountrySelection | null) => void;
  hover: (iso3: string | null) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  selectedCountry: null,
  hoveredIso3: null,
  selectCountry: (country) => set({ selectedCountry: country }),
  hover: (iso3) => set({ hoveredIso3: iso3 }),
}));
