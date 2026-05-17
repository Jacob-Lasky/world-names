import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL, { type DeckGLRef } from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useSelection } from '../store/selection';
import { useClusterColors } from '../data/use-cluster-colors';
import { clusterFill } from '../lib/similarity';
import { Legend } from './Legend';
import {
  featureId,
  isTouchEvent,
  handleCountrySelect,
  handleCountryInspect,
  handleTouchTap,
  handleBackgroundDeselect,
  handleBackgroundDismissInspection,
} from './world-map-handlers';

type CountryProps = { name: string };
// `id` is already optional on GeoJSON Feature; no need to redeclare.
type CountryFeature = Feature<Geometry, CountryProps>;

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 25,
  zoom: 1.2,
  minZoom: 0.5,
  maxZoom: 8,
  pitch: 0,
  bearing: 0,
};

const RGBA = {
  default: [40, 50, 65, 255] as [number, number, number, number],
  hover: [80, 95, 115, 255] as [number, number, number, number],
  // Fallback for the selected feature when its own cluster data hasn't
  // landed yet (or when its dominant language has no cluster covered by an
  // etl/roots/*.yaml). Near-white so the bold outline reads clearly even
  // before cluster colors flow in.
  selectedFallback: [240, 240, 240, 255] as [number, number, number, number],
  stroke: [20, 25, 32, 255] as [number, number, number, number],
  // Bold contrast outline for the selected polygon. Pure black against any
  // hue or near-white fill — works against the deutsch cluster's white tint
  // and against neighboring cluster hues uniformly.
  selectedStroke: [0, 0, 0, 255] as [number, number, number, number],
  // Inspection ring: matches the selection outline weight but in a softer
  // bluish-white so the eye reads "this is the inspected country, not the
  // selected one." Distinct enough to never confuse the two.
  inspectStroke: [220, 230, 245, 255] as [number, number, number, number],
  unclustered: [55, 65, 80, 255] as [number, number, number, number],
};

// Outline widths in pixels. Selected gets a bold 2.5px stroke, inspected
// gets a 1.5px medium stroke, everyone else stays at the thin 0.5px
// graticule width.
const STROKE_WIDTH_SELECTED = 2.5;
const STROKE_WIDTH_INSPECTED = 1.5;
const STROKE_WIDTH_DEFAULT = 0.5;

// Alpha applied to non-matching countries when the user has clicked a
// Legend chip to focus a cluster. Low enough to drop visual weight (the
// focused cluster pops), high enough to keep the dimmed hue readable
// as context.
const FOCUS_DIM_ALPHA = 70;

// Long-press threshold for touch — 500ms feels deliberate without dragging
// out for so long the user thinks the tap was ignored. iOS uses 500ms for
// its system-level long-press; matching feels native.
const LONG_PRESS_MS = 500;
// If the touch moves more than this many pixels during the press window,
// treat it as a pan and cancel the long-press timer. Prevents accidental
// selection changes when the user is scrolling/zooming the map.
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

function dataUrl(): string {
  // Respects Vite's base path so this works both at /world-names/ and locally.
  return `${import.meta.env.BASE_URL}countries-50m.json`;
}


export function WorldMap() {
  const [features, setFeatures] = useState<CountryFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedId = useSelection((s) => s.selectedCountry?.numericId ?? null);
  const hoveredId = useSelection((s) => s.hoveredId);
  const focusedClusterId = useSelection((s) => s.focusedClusterId);
  const selectCountry = useSelection((s) => s.selectCountry);
  const hover = useSelection((s) => s.hover);

  // When a country is selected, fetch every other country's cluster + hue +
  // orthographic similarity for that target. The map recolors live: each
  // country gets the hue of its dominant language's etymological-root cluster
  // for the selected country's name, with lightness driven by how similar the
  // exonym is to the selected country's endonym.
  const clusterColorsState = useClusterColors(selectedId);
  const clusterColors = clusterColorsState.status === 'ready' ? clusterColorsState.colors : null;

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const r = await fetch(dataUrl(), { signal: controller.signal });
        if (!r.ok) throw new Error(`countries-50m.json: HTTP ${r.status}`);
        const topo = (await r.json()) as Topology<{ countries: GeometryCollection<CountryProps> }>;
        const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, CountryProps>;
        setFeatures(fc.features as CountryFeature[]);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => controller.abort();
  }, []);

  // Long-press bookkeeping. Refs (not state) so press lifecycle doesn't
  // trigger re-renders. `pressTimer` schedules the select; `pressStart`
  // remembers where the press began so we can pick at that point even if
  // the finger drifted slightly. `longPressFired` blocks the subsequent
  // touchend → onClick from firing inspect on the same press.
  //
  // `lastInputWasTouch` is the source-of-truth for "was this a touch
  // interaction" because deck.gl's info.event metadata isn't reliable
  // across browsers (Android Firefox emits TouchEvents through Hammer.js
  // which lack pointerType). We set it from our own React PointerEvent
  // handler — pointer events are universal in modern browsers and React
  // normalizes them consistently. isTouchEvent(info) is kept as a
  // fallback layer for synthetic clicks that may not have a paired
  // pointerdown (e.g. screen-reader-triggered activation).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<DeckGLRef | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ clientX: number; clientY: number } | null>(null);
  const longPressFired = useRef(false);
  const lastInputWasTouch = useRef(false);

  function pickAt(clientX: number, clientY: number): CountryFeature | null {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const info = deckRef.current?.pickObject({ x, y, radius: 5 });
    return (info?.object as CountryFeature | undefined) ?? null;
  }

  function cancelPress() {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Record the input modality on EVERY pointerdown so the subsequent
    // onClick (which may arrive without reliable event metadata) can read
    // it from a ref instead of trying to introspect deck.gl's info.event.
    lastInputWasTouch.current = e.pointerType === 'touch';
    // Mouse/pen path stays on deck.gl's onClick (no long-press needed —
    // desktop clicks are unambiguous). Only touch needs the long-press
    // gesture.
    if (e.pointerType !== 'touch') return;
    // If the press started on the Legend overlay, don't arm the long-
    // press timer. The legend chips have their own click handlers; an
    // accidental long-press through the chip would otherwise pickObject
    // at whatever country happens to sit beneath the legend and switch
    // selection unexpectedly.
    if ((e.target as Element | null)?.closest('[data-testid="cluster-legend"]')) return;
    cancelPress();
    longPressFired.current = false;
    pressStart.current = { clientX: e.clientX, clientY: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      const start = pressStart.current;
      if (!start) return;
      const f = pickAt(start.clientX, start.clientY);
      pressTimer.current = null;
      pressStart.current = null;
      if (!f) return;
      longPressFired.current = true;
      handleCountrySelect(f, { selectCountry, hover });
      // Best-effort haptic feedback. Not all touch devices support it, and
      // browser policy varies — wrapped to never throw.
      try {
        if ('vibrate' in navigator) (navigator as Navigator).vibrate?.(40);
      } catch { /* ignore */ }
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch' || !pressStart.current) return;
    const dx = e.clientX - pressStart.current.clientX;
    const dy = e.clientY - pressStart.current.clientY;
    if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      cancelPress();
    }
  }

  function onPointerEnd() {
    cancelPress();
  }

  // Layer handlers extracted as stable callbacks so the ref-access lint rule
  // (react-hooks/refs) doesn't trip on `longPressFired.current` references
  // inside the useMemo body. Reading a ref inside a user-fired handler is
  // safe (handlers run after render, not during it).
  const onLayerClick = useCallback((info: PickingInfo) => {
    const f = info.object as CountryFeature | undefined;
    if (!f) return;
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    // Two signals: our own pointerdown ref (most reliable; covers Android
    // Firefox where deck.gl emits TouchEvents with no pointerType) plus
    // isTouchEvent on info (covers synthetic clicks with no paired
    // pointerdown). Either being true = touch.
    const isTouch = lastInputWasTouch.current || isTouchEvent(info);
    if (isTouch) {
      handleTouchTap(f, { selectCountry, hover }, selectedId);
    } else {
      handleCountrySelect(f, { selectCountry, hover });
    }
  }, [selectCountry, hover, selectedId]);

  const onLayerHover = useCallback((info: PickingInfo) => {
    // Touch-derived hover events fire on touchstart and would race with the
    // explicit tap → onClick path. Inspection on touch is owned exclusively
    // by onClick (tap) and the press timer (long-press).
    if (lastInputWasTouch.current || isTouchEvent(info)) return;
    const f = info.object as CountryFeature | undefined;
    if (f) {
      // Desktop hover is INSPECT-only — never SELECT, even when nothing is
      // selected (otherwise the user can't move the mouse without
      // accidentally focusing every country it passes over). With no
      // selection, INSPECT just highlights the polygon under the cursor.
      handleCountryInspect(f, { selectCountry, hover }, selectedId);
    } else {
      hover(null);
    }
  }, [selectCountry, hover, selectedId]);

  const layers = useMemo(() => {
    if (!features) return [];
    // ref access (longPressFired) is encapsulated inside onLayerClick (a
    // useCallback). The handler only runs in response to user input, not
    // during render. The rule's static analysis can't see across the
    // callback boundary, so this is a known false-positive that the
    // React team's own pattern produces.
    // eslint-disable-next-line react-hooks/refs
    return [new GeoJsonLayer<CountryProps>({
        id: 'countries',
        data: features,
        filled: true,
        stroked: true,
        pickable: true,
        autoHighlight: false,
        // Pixel-mode stroke widths so the bold selected outline reads at
        // every zoom level without scaling away on zoom-out.
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: STROKE_WIDTH_DEFAULT,
        // Natural Earth's Russia polygon crosses the antimeridian (Chukotka). The
        // raw GeoJSON has consecutive vertex pairs that jump >180° in longitude,
        // which deck.gl renders as horizontal stripes across the map (and the
        // stripes pick up as Russia on hover, since they ARE Russia, badly drawn).
        //
        // GeoJsonLayer internally hardcodes _normalize=false on its polygon
        // sub-layers. Override via _subLayerProps so the tesselator runs
        // cutPolygonByMercatorBounds and splits the polygon at ±180°.
        _subLayerProps: {
          'polygons-fill': { _normalize: true, wrapLongitude: true },
          'polygons-stroke': { _normalize: true, wrapLongitude: true },
        },
        getFillColor: (f) => {
          const id = featureId(f);
          // Selected country: route through the cluster fill so it inherits
          // its OWN cluster's hue at near-white (similarity=1). The exonym
          // row for (target's dominant lang, target) equals the endonym by
          // definition, so the precomputed similarity is 1.0. If cluster
          // data hasn't landed (or there's no YAML coverage for the
          // dominant language), fall back to near-white so the bold outline
          // alone communicates selection. The selected country is the
          // focal point and never dims, regardless of the legend focus.
          if (id === selectedId) {
            const c = clusterColors?.get(id);
            if (c?.hue != null) {
              const [r, g, b] = clusterFill(c.hue, c.similarity ?? 1);
              return [r, g, b, 255];
            }
            return RGBA.selectedFallback;
          }
          if (clusterColors) {
            const c = clusterColors.get(id);
            if (c?.hue != null) {
              // similarity null shouldn't happen post-Phase-2 since ETL
              // populates it for every (target, observer) pair where the
              // target has an endonym, but default to 0 (fully saturated
              // base hue) to keep rendering deterministic.
              const sim = c.similarity ?? 0;
              const [r, g, b] = clusterFill(c.hue, sim);
              // Legend dim: if the user has pinned focus to a cluster
              // from the Legend overlay, every non-matching country drops
              // to a low alpha. The hue stays so you can still see what
              // cluster they're in, but the visual weight collapses onto
              // the focused cluster.
              const dim = focusedClusterId != null && c.cluster_id !== focusedClusterId;
              return [r, g, b, dim ? FOCUS_DIM_ALPHA : 255];
            }
            // We have cluster data for the selected target, but this country
            // has no exonym row or no cluster yet (uncovered observer language).
            // When a cluster is focused, dim these too — they're not in any
            // cluster, so they're not in the focused one either.
            if (focusedClusterId != null) {
              return [RGBA.unclustered[0], RGBA.unclustered[1], RGBA.unclustered[2], FOCUS_DIM_ALPHA];
            }
            return RGBA.unclustered;
          }
          // No selection yet — hover gets a lighter wash so the user can
          // see what they're about to pick.
          if (id === hoveredId) return RGBA.hover;
          return RGBA.default;
        },
        getLineColor: (f) => {
          const id = featureId(f);
          if (id === selectedId) return RGBA.selectedStroke;
          if (id === hoveredId) return RGBA.inspectStroke;
          return RGBA.stroke;
        },
        getLineWidth: (f) => {
          const id = featureId(f);
          if (id === selectedId) return STROKE_WIDTH_SELECTED;
          if (id === hoveredId) return STROKE_WIDTH_INSPECTED;
          return STROKE_WIDTH_DEFAULT;
        },
        // Force the GPU attribute buffers to refresh when selection/hover/data changes.
        updateTriggers: {
          getFillColor: [selectedId, hoveredId, clusterColors, focusedClusterId],
          getLineColor: [selectedId, hoveredId],
          getLineWidth: [selectedId, hoveredId],
        },
        // Layer-level handlers: onClick fires after a tap (touch) or click
        // (mouse). Mouse → SELECT, touch tap → INSPECT, touch long-press
        // → SELECT (via the pointerdown timer; the trailing onClick is
        // suppressed via the longPressFired ref). onHover only acts on
        // mouse events; touch-derived hover from deck.gl is ignored so
        // the inspection state is driven exclusively by the explicit tap
        // path. Both handlers extracted to useCallback above so the
        // ref-access lint rule doesn't flag the useMemo body.
        onClick: onLayerClick,
        onHover: onLayerHover,
      })];
  }, [features, selectedId, hoveredId, clusterColors, focusedClusterId, onLayerClick, onLayerHover]);

  function onDeckClick(info: PickingInfo): void {
    // Background click handling. Mouse → deselect (clear selection + hover);
    // touch → dismiss inspection only (selection persists; wayward
    // background taps during pan shouldn't blow away focus).
    if (lastInputWasTouch.current || isTouchEvent(info)) {
      handleBackgroundDismissInspection(info.object, { selectCountry, hover });
    } else {
      handleBackgroundDeselect(info.object, { selectCountry, hover });
    }
  }

  return (
    <div
      ref={wrapperRef}
      data-testid="world-map"
      style={{
        position: 'relative',
        background: 'var(--panel)',
        borderRight: '1px solid var(--rule)',
        minHeight: 0,
        overflow: 'hidden',
        // touch-action: none gives us full control over touch gestures.
        // Without this, the browser may steal pointermoves for native
        // scroll and cancel our long-press timer. deck.gl's controller
        // handles pan/zoom internally, so we don't need browser scroll.
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
    >
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: '1rem',
            color: '#ff6b6b',
            zIndex: 2,
          }}
        >
          Failed to load country polygons: {error}
        </div>
      )}
      <DeckGL
        ref={deckRef}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        onClick={onDeckClick}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      <Legend />
    </div>
  );
}
