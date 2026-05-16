import { describe, it, expect, vi } from 'vitest';
import type { Feature, Geometry } from 'geojson';
import {
  featureId,
  handleCountryClick,
  handleBackgroundClick,
} from './world-map-handlers';

type CountryFeature = Feature<Geometry, { name: string }>;

function makeFeature(id: string | number | undefined, name: string): CountryFeature {
  return {
    type: 'Feature',
    id,
    properties: { name },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

function makeActions() {
  return {
    selectCountry: vi.fn(),
    hover: vi.fn(),
  };
}

describe('featureId', () => {
  it('stringifies numeric ids', () => {
    expect(featureId(makeFeature(276, 'Germany'))).toBe('276');
  });
  it('preserves string ids', () => {
    expect(featureId(makeFeature('DEU', 'Germany'))).toBe('DEU');
  });
  it('returns empty string for undefined id', () => {
    expect(featureId(makeFeature(undefined, 'Nowhere'))).toBe('');
  });
});

describe('handleCountryClick', () => {
  it('selects the clicked feature with id and name', () => {
    const actions = makeActions();
    handleCountryClick(makeFeature(276, 'Germany'), actions);
    expect(actions.selectCountry).toHaveBeenCalledWith({
      numericId: '276',
      name: 'Germany',
    });
  });

  it('clears hover state on selection — prevents stuck hover on touch devices', () => {
    const actions = makeActions();
    handleCountryClick(makeFeature(276, 'Germany'), actions);
    expect(actions.hover).toHaveBeenCalledWith(null);
  });

  it('falls back to "Unknown" if the feature has no name', () => {
    const actions = makeActions();
    const f = makeFeature(0, '') as unknown as CountryFeature;
    f.properties = { name: '' };
    handleCountryClick(f, actions);
    expect(actions.selectCountry).toHaveBeenCalledWith({
      numericId: '0',
      name: '',
    });
  });
});

describe('handleBackgroundClick', () => {
  it('clears selection AND hover when the click missed a feature', () => {
    const actions = makeActions();
    handleBackgroundClick(undefined, actions);
    expect(actions.selectCountry).toHaveBeenCalledWith(null);
    expect(actions.hover).toHaveBeenCalledWith(null);
  });

  it('does nothing if a feature was picked — layer-level onClick owns that case', () => {
    const actions = makeActions();
    handleBackgroundClick(makeFeature(276, 'Germany'), actions);
    expect(actions.selectCountry).not.toHaveBeenCalled();
    expect(actions.hover).not.toHaveBeenCalled();
  });
});
