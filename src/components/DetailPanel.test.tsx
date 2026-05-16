import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailPanel } from './DetailPanel';
import { useSelection } from '../store/selection';

describe('DetailPanel', () => {
  beforeEach(() => {
    useSelection.setState({ selectedCountry: null, hoveredId: null });
  });

  it('shows the empty-state prompt when nothing is selected', () => {
    render(<DetailPanel />);
    expect(screen.getByText(/Pick a country on the map/i)).toBeInTheDocument();
  });

  it('shows the country name when a selection has only the polygon-derived fields', () => {
    useSelection.getState().selectCountry({ numericId: '276', name: 'Germany' });
    render(<DetailPanel />);
    expect(screen.getByRole('heading')).toHaveTextContent('Germany');
    expect(screen.getByText(/M49 276/)).toBeInTheDocument();
  });

  it('prefers the endonym over the English name once data-layer enrichment lands', () => {
    useSelection.getState().selectCountry({
      numericId: '276',
      name: 'Germany',
      iso3: 'DEU',
      endonym: 'Deutschland',
      language: 'German',
      blurb: 'Deutschland from Proto-Germanic þeudō, "people"…',
    });
    render(<DetailPanel />);
    expect(screen.getByRole('heading')).toHaveTextContent('Deutschland');
    expect(screen.getByText(/ISO DEU/)).toBeInTheDocument();
    expect(screen.getByText(/spoken language: German/)).toBeInTheDocument();
    expect(screen.getByText(/Proto-Germanic þeudō/)).toBeInTheDocument();
  });
});
