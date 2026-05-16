import { describe, it, expect, vi } from 'vitest';
import type { Feature, Geometry } from 'geojson';
import {
  featureId,
  isTouchEvent,
  handleCountrySelect,
  handleCountryInspect,
  handleTouchTap,
  handleBackgroundDeselect,
  handleBackgroundDismissInspection,
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

describe('isTouchEvent', () => {
  describe('PointerEvent shape', () => {
    it('returns true when pointerType is touch', () => {
      expect(isTouchEvent({ event: { srcEvent: { pointerType: 'touch' } } })).toBe(true);
    });
    it('returns false for mouse', () => {
      expect(isTouchEvent({ event: { srcEvent: { pointerType: 'mouse' } } })).toBe(false);
    });
    it('returns false for pen (treat as desktop — click=SELECT, hover=INSPECT)', () => {
      expect(isTouchEvent({ event: { srcEvent: { pointerType: 'pen' } } })).toBe(false);
    });
  });

  describe('TouchEvent shape (Hammer.js path on Android browsers)', () => {
    // Regression coverage for the Android Firefox bug — deck.gl's
    // Hammer.js layer hands us a TouchEvent (no pointerType), and the
    // old code returned false here, dropping every tap into the
    // desktop SELECT branch.
    it('returns true for touchstart', () => {
      expect(isTouchEvent({ event: { srcEvent: { type: 'touchstart' } } })).toBe(true);
    });
    it('returns true for touchend (the most common — fires on tap release)', () => {
      expect(isTouchEvent({ event: { srcEvent: { type: 'touchend' } } })).toBe(true);
    });
    it('returns true for touchmove', () => {
      expect(isTouchEvent({ event: { srcEvent: { type: 'touchmove' } } })).toBe(true);
    });
    it('returns true for touchcancel', () => {
      expect(isTouchEvent({ event: { srcEvent: { type: 'touchcancel' } } })).toBe(true);
    });
    it('returns false for mousedown / click (similar shape but not touch)', () => {
      expect(isTouchEvent({ event: { srcEvent: { type: 'mousedown' } } })).toBe(false);
      expect(isTouchEvent({ event: { srcEvent: { type: 'click' } } })).toBe(false);
    });
  });

  describe('malformed input', () => {
    it('returns false when the carrier is null or missing fields', () => {
      expect(isTouchEvent(null)).toBe(false);
      expect(isTouchEvent(undefined)).toBe(false);
      expect(isTouchEvent({})).toBe(false);
      expect(isTouchEvent({ event: {} })).toBe(false);
      expect(isTouchEvent({ event: { srcEvent: {} } })).toBe(false);
    });
  });
});

describe('handleCountrySelect', () => {
  it('selects the clicked feature with id and name', () => {
    const actions = makeActions();
    handleCountrySelect(makeFeature(276, 'Germany'), actions);
    expect(actions.selectCountry).toHaveBeenCalledWith({
      numericId: '276',
      name: 'Germany',
    });
  });

  it('clears hover state on selection — prevents stuck hover on touch devices', () => {
    const actions = makeActions();
    handleCountrySelect(makeFeature(276, 'Germany'), actions);
    expect(actions.hover).toHaveBeenCalledWith(null);
  });

  it('falls back to "Unknown" if the feature has no name', () => {
    const actions = makeActions();
    const f = makeFeature(0, '') as unknown as CountryFeature;
    f.properties = { name: '' };
    handleCountrySelect(f, actions);
    expect(actions.selectCountry).toHaveBeenCalledWith({
      numericId: '0',
      name: '',
    });
  });
});

describe('handleCountryInspect', () => {
  it('sets hover to the inspected feature when different from selected', () => {
    const actions = makeActions();
    handleCountryInspect(makeFeature(250, 'France'), actions, '276');
    expect(actions.hover).toHaveBeenCalledWith('250');
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });

  it('clears hover if user inspects the country that is already selected', () => {
    // Inspecting "self" has nothing extra to show in the panel, so we just
    // clear the inspection rather than highlighting the selected country
    // a second way.
    const actions = makeActions();
    handleCountryInspect(makeFeature(276, 'Germany'), actions, '276');
    expect(actions.hover).toHaveBeenCalledWith(null);
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });

  it('works with no current selection (inspect on an empty board)', () => {
    const actions = makeActions();
    handleCountryInspect(makeFeature(250, 'France'), actions, null);
    expect(actions.hover).toHaveBeenCalledWith('250');
  });
});

describe('handleBackgroundDeselect', () => {
  it('clears selection AND hover when the click missed a feature', () => {
    const actions = makeActions();
    handleBackgroundDeselect(undefined, actions);
    expect(actions.selectCountry).toHaveBeenCalledWith(null);
    expect(actions.hover).toHaveBeenCalledWith(null);
  });

  it('does nothing if a feature was picked — layer-level onClick owns that case', () => {
    const actions = makeActions();
    handleBackgroundDeselect(makeFeature(276, 'Germany'), actions);
    expect(actions.selectCountry).not.toHaveBeenCalled();
    expect(actions.hover).not.toHaveBeenCalled();
  });
});

describe('handleTouchTap', () => {
  // Mobile UX rule: tap-on-country = SELECT when nothing's focused yet
  // (the entry point), and INSPECT once a focus exists.
  it('SELECTS on the first tap (no current selection — entry point)', () => {
    const actions = makeActions();
    handleTouchTap(makeFeature(276, 'Germany'), actions, null);
    expect(actions.selectCountry).toHaveBeenCalledWith({
      numericId: '276',
      name: 'Germany',
    });
    // SELECT also clears hover by contract.
    expect(actions.hover).toHaveBeenCalledWith(null);
  });

  it('INSPECTS once a country is already selected', () => {
    const actions = makeActions();
    handleTouchTap(makeFeature(250, 'France'), actions, '276');
    expect(actions.hover).toHaveBeenCalledWith('250');
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });

  it('clears the inspection when tapping the country that is already selected', () => {
    // Inherits handleCountryInspect's "don't inspect self" rule —
    // tapping the focused country a second time has nothing extra to
    // show, so we collapse the inspection card.
    const actions = makeActions();
    handleTouchTap(makeFeature(276, 'Germany'), actions, '276');
    expect(actions.hover).toHaveBeenCalledWith(null);
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });
});

describe('handleBackgroundDismissInspection', () => {
  it('clears only hover when the tap missed a feature — selection sticks', () => {
    // Mobile background tap shouldn't deselect; wayward taps during pan
    // are too common. Just dismiss the inspection card.
    const actions = makeActions();
    handleBackgroundDismissInspection(undefined, actions);
    expect(actions.hover).toHaveBeenCalledWith(null);
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });

  it('does nothing if a feature was tapped — layer-level onClick handles it', () => {
    const actions = makeActions();
    handleBackgroundDismissInspection(makeFeature(276, 'Germany'), actions);
    expect(actions.hover).not.toHaveBeenCalled();
    expect(actions.selectCountry).not.toHaveBeenCalled();
  });
});
