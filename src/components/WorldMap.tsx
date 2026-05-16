import { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useSelection } from '../store/selection';

type CountryProps = { name: string };
type CountryFeature = Feature<Geometry, CountryProps> & { id?: string | number };

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

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl())
      .then((r) => {
        if (!r.ok) throw new Error(`countries-50m.json: HTTP ${r.status}`);
        return r.json() as Promise<Topology<{ countries: GeometryCollection<CountryProps> }>>;
      })
      .then((topo) => {
        if (cancelled) return;
        const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, CountryProps>;
        setFeatures(fc.features as CountryFeature[]);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const layers = useMemo(() => {
    if (!features) return [];
    return [
      new GeoJsonLayer<CountryFeature>({
        id: 'countries',
        data: features,
        filled: true,
        stroked: true,
        pickable: true,
        autoHighlight: false,
        getFillColor: (f) => {
          const id = String(f.id ?? '');
          if (id === selectedId) return RGBA.selected;
          if (id === hoveredId) return RGBA.hover;
          return RGBA.default;
        },
        getLineColor: RGBA.stroke,
        lineWidthMinPixels: 0.5,
        // Force the GPU attribute buffers to refresh when selection/hover changes.
        updateTriggers: {
          getFillColor: [selectedId, hoveredId],
        },
        // Layer-level handlers: fire when a pick lands on a feature in this
        // layer. DeckGL's top-level onClick was unreliable in headless test
        // runs — feature picking belongs on the layer.
        onClick: (info: PickingInfo) => {
          const f = info.object as CountryFeature | undefined;
          if (!f) return;
          selectCountry({
            numericId: String(f.id ?? ''),
            name: f.properties?.name ?? 'Unknown',
          });
        },
        onHover: (info: PickingInfo) => {
          const f = info.object as CountryFeature | undefined;
          hover(f ? String(f.id ?? '') : null);
        },
      }),
    ];
  }, [features, selectedId, hoveredId, selectCountry, hover]);

  function onBackgroundClick(info: PickingInfo): void {
    // Clicks on water / empty background — clear the current selection.
    if (!info.object) selectCountry(null);
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
        onClick={onBackgroundClick}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
    </div>
  );
}
