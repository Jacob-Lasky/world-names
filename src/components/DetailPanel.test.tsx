import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailPanel } from './DetailPanel';
import { useSelection } from '../store/selection';
import { useCountryDetail } from '../data/use-country-detail';

vi.mock('../data/use-country-detail', () => ({
  useCountryDetail: vi.fn(),
}));

const mockedUseCountryDetail = vi.mocked(useCountryDetail);

describe('DetailPanel', () => {
  beforeEach(() => {
    useSelection.setState({ selectedCountry: null, hoveredId: null });
    mockedUseCountryDetail.mockReset();
    mockedUseCountryDetail.mockReturnValue({ status: 'idle', detail: null });
  });

  it('shows the empty-state prompt when nothing is selected', () => {
    render(<DetailPanel />);
    expect(screen.getByText(/Pick a country on the map/i)).toBeInTheDocument();
  });

  it('shows the polygon name and a loading hint while the DB is resolving', () => {
    useSelection.getState().selectCountry({ numericId: '276', name: 'Germany' });
    mockedUseCountryDetail.mockReturnValue({ status: 'loading', detail: null });
    render(<DetailPanel />);
    expect(screen.getByRole('heading')).toHaveTextContent('Germany');
    expect(screen.getByText(/Loading details/i)).toBeInTheDocument();
  });

  it('renders the endonym + ISO + language once the DB resolves', () => {
    useSelection.getState().selectCountry({ numericId: '276', name: 'Germany' });
    mockedUseCountryDetail.mockReturnValue({
      status: 'ready',
      detail: {
        iso3: 'DEU',
        name_en: 'Germany',
        endonym: 'Deutschland',
        language_code: 'deu',
        language_name: 'German',
      },
    });
    render(<DetailPanel />);
    expect(screen.getByRole('heading')).toHaveTextContent('Deutschland');
    expect(screen.getByText(/ISO DEU/)).toBeInTheDocument();
    expect(screen.getByText(/spoken language: German/)).toBeInTheDocument();
    // English name appears as a subhead clarifier when it differs from endonym
    expect(screen.getByText(/\(Germany\)/)).toBeInTheDocument();
  });

  it('falls back to English name when the country has no endonym (Wikidata gap)', () => {
    useSelection.getState().selectCountry({ numericId: '585', name: 'Palau' });
    mockedUseCountryDetail.mockReturnValue({
      status: 'ready',
      detail: {
        iso3: 'PLW',
        name_en: 'Palau',
        endonym: null,
        language_code: 'pau',
        language_name: 'Palauan',
      },
    });
    render(<DetailPanel />);
    // Wikidata has no Palau label in Palauan, so DetailPanel shows the English name.
    expect(screen.getByRole('heading')).toHaveTextContent('Palau');
    expect(screen.getByText(/ISO PLW/)).toBeInTheDocument();
  });

  it('shows a no-record placeholder when the DB returns null (Kosovo case)', () => {
    useSelection.getState().selectCountry({ numericId: '', name: 'Kosovo' });
    mockedUseCountryDetail.mockReturnValue({ status: 'ready', detail: null });
    render(<DetailPanel />);
    expect(screen.getByRole('heading')).toHaveTextContent('Kosovo');
    expect(screen.getByText(/no record in the data layer/i)).toBeInTheDocument();
  });

  it('surfaces a DB load error rather than failing silently', () => {
    useSelection.getState().selectCountry({ numericId: '276', name: 'Germany' });
    mockedUseCountryDetail.mockReturnValue({
      status: 'error',
      detail: null,
      error: 'fetch failed',
    });
    render(<DetailPanel />);
    expect(screen.getByText(/Failed to load details: fetch failed/i)).toBeInTheDocument();
  });
});
