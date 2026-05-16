import { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useSelection } from '../store/selection';
import { useClusterColors } from '../data/use-cluster-colors';
import { hslToRgb } from '../lib/similarity';
import {
  featureId,
  handleCountryClick,
  handleBackgroundClick,
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
  selected: [255, 184, 107, 255] as [number, number, number, number],
  stroke: [20, 25, 32, 255] as [number, number, number, number],
  unclustered: [55, 65, 80, 255] as [number, number, number, number],
};

function dataUrl(): string {
  // Respects Vite's base path so this works both at /world-names/ and locally.
  return `${import.meta.env.BASE_URL}countries-50m.json`;
}

export function WorldMap() {
  const [features, setFeatures] = useState<CountryFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedId = useSelection((s) => s.selectedCountry?.numericId ?? null);
  const hoveredId = useSelection((s) => s.hoveredId);
  const selectCountry = useSelection((s) => s.selectCountry);
  const hover = useSelection((s) => s.hover);

  // When a country is selected, fetch every other country's cluster + hue
  // for that target. The map recolors live: each country gets the hue of
  // its dominant language's etymological-root cluster for the selected
  // country's name.
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

  const layers = useMemo(() => {
    if (!features) return [];
    return [
      new GeoJsonLayer<CountryProps>({
        id: 'countries',
        data: features,
        filled: true,
        stroked: true,
        pickable: true,
        autoHighlight: false,
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
          if (id === selectedId) return RGBA.selected;
          if (id === hoveredId) return RGBA.hover;
          if (clusterColors) {
            const c = clusterColors.get(id);
            if (c?.hue != null) {
              const [r, g, b] = hslToRgb(c.hue);
              return [r, g, b, 255];
            }
            // We have cluster data for the selected target, but this country
            // has no exonym row or no cluster yet (uncovered observer language).
            return RGBA.unclustered;
          }
          return RGBA.default;
        },
        getLineColor: RGBA.stroke,
        lineWidthMinPixels: 0.5,
        // Force the GPU attribute buffers to refresh when selection/hover changes.
        updateTriggers: {
          getFillColor: [selectedId, hoveredId, clusterColors],
        },
        // Layer-level handlers: fire when a pick lands on a feature in this
        // layer. DeckGL's top-level onClick was unreliable in headless test
        // runs — feature picking belongs on the layer. Click + background
        // handlers are pure functions in world-map-handlers.ts so the state
        // transitions are unit-tested.
        onClick: (info: PickingInfo) => {
          const f = info.object as CountryFeature | undefined;
          if (f) handleCountryClick(f, { selectCountry, hover });
        },
        onHover: (info: PickingInfo) => {
          const f = info.object as CountryFeature | undefined;
          hover(f ? featureId(f) : null);
        },
      }),
    ];
  }, [features, selectedId, hoveredId, selectCountry, hover, clusterColors]);

  function onDeckClick(info: PickingInfo): void {
    handleBackgroundClick(info.object, { selectCountry, hover });
  }

  return (
    <div
      data-testid="world-map"
      style={{
        position: 'relative',
        background: 'var(--panel)',
        borderRight: '1px solid var(--rule)',
        minHeight: 0,
        overflow: 'hidden',
      }}
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
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        onClick={onDeckClick}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
    </div>
  );
}
