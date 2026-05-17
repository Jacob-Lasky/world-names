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
  // The legend chip the user has zoomed in on, if any. When set, the map
  // dims every country whose cluster doesn't match this id — lets the
  // user scan "everyone who calls Germany something Slavic-rooted" in
  // one glance. Cleared automatically on a new SELECT so the focus
  // doesn't carry stale meaning across selections.
  focusedClusterId: string | null;
  selectCountry: (country: CountrySelection | null) => void;
  hover: (numericId: string | null) => void;
  focusCluster: (clusterId: string | null) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  selectedCountry: null,
  hoveredId: null,
  focusedClusterId: null,
  selectCountry: (country) => set({ selectedCountry: country, focusedClusterId: null }),
  hover: (numericId) => set({ hoveredId: numericId }),
  focusCluster: (clusterId) => set({ focusedClusterId: clusterId }),
}));
