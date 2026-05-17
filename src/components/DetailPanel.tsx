import { useMemo } from 'react';
import { useSelection } from '../store/selection';
import { useCountryDetail } from '../data/use-country-detail';
import { useClusterColors } from '../data/use-cluster-colors';
import { useInspectionDetail } from '../data/use-inspection-detail';
import { clusterFill, selectedHeadingColor } from '../lib/similarity';
import { shortClusterLabel } from '../lib/cluster-label';

export function DetailPanel() {
  const selected = useSelection((s) => s.selectedCountry);

  if (!selected) {
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <p style={mutedText}>
          Pick a country on the map to see what it calls itself and how that name
          drifted across other languages.
        </p>
        <p style={{ ...mutedText, marginTop: '0.75rem', fontSize: '0.8rem' }}>
          Desktop: <strong>click</strong> a country to focus, <strong>hover</strong> another to peek.
        </p>
        <p style={{ ...mutedText, marginTop: '0.5rem', fontSize: '0.8rem' }}>
          Mobile: <strong>tap</strong> a country to focus, then <strong>tap</strong> another to peek
          and <strong>long-press</strong> to switch focus.
        </p>
      </aside>
    );
  }

  return (
    <aside data-testid="detail-panel" style={panelStyle}>
      <SelectedCard />
      <InspectionCard />
    </aside>
  );
}

function SelectedCard() {
  const selected = useSelection((s) => s.selectedCountry);
  const detailState = useCountryDetail(selected?.numericId ?? null);
  const clusterColors = useClusterColors(selected?.numericId ?? null);

  // Tint the heading with the selected country's own cluster hue at the
  // self-like end of the lightness gradient (similarity=1). This carries
  // the same color the polygon shows on the map into the detail panel, so
  // the heading text and its polygon read as a matched pair. Falls back
  // to the accent color while the SQLite query is in flight or when the
  // selected country has no cluster coverage in etl/roots/<iso3>.yaml yet.
  const headingColor = useMemo(() => {
    if (clusterColors.status !== 'ready' || !selected) return 'var(--accent)';
    const row = clusterColors.colors.get(selected.numericId);
    return selectedHeadingColor(row) ?? 'var(--accent)';
  }, [clusterColors, selected]);

  if (!selected) return null;

  // Loading: DB is initializing or query is in flight. Show the polygon name as
  // a stable placeholder so the user sees *something* immediately on click.
  if (detailState.status === 'loading') {
    return (
      <section data-testid="selected-card">
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={mutedText}>Loading details…</p>
      </section>
    );
  }

  if (detailState.status === 'error') {
    return (
      <section data-testid="selected-card">
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={{ ...mutedText, color: '#ff6b6b' }}>
          Failed to load details: {detailState.error}
        </p>
      </section>
    );
  }

  const d = detailState.detail;
  if (!d) {
    // DB resolved but no row for this M49. Kosovo (no M49) hits this path.
    return (
      <section data-testid="selected-card">
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={mutedText}>
          M49 {selected.numericId || '—'} · no record in the data layer for this
          polygon yet.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="selected-card">
      <h2 style={{ ...headingStyle, color: headingColor }}>{d.endonym ?? d.name_en}</h2>
      <p style={subheadStyle}>
        {d.endonym && d.endonym !== d.name_en ? `(${d.name_en}) · ` : ''}
        ISO {d.iso3}
        {d.language_name ? ` · spoken language: ${d.language_name}` : ''}
      </p>
      <p style={mutedText}>
        The map recolors by etymological-root cluster: each country's hue reflects
        which historical root its dominant language uses to refer to {d.endonym ?? d.name_en}.
      </p>
    </section>
  );
}

function InspectionCard() {
  const selected = useSelection((s) => s.selectedCountry);
  const hoveredId = useSelection((s) => s.hoveredId);

  // Render nothing when there's no inspection to show — same country as
  // selected, no hover, or no selection.
  const shouldShow = !!selected && !!hoveredId && hoveredId !== selected.numericId;
  // Always call the hook (rules of hooks), but pass null to short-circuit
  // when we won't render. The hook returns idle and skips its effect.
  const inspState = useInspectionDetail(
    shouldShow ? selected.numericId : null,
    shouldShow ? hoveredId : null,
  );

  if (!shouldShow) return null;

  if (inspState.status === 'loading' || inspState.status === 'idle') {
    return (
      <section data-testid="inspection-card" style={inspectionSectionStyle}>
        <p style={{ ...mutedText, fontSize: '0.8rem', fontStyle: 'italic' }}>Loading…</p>
      </section>
    );
  }

  if (inspState.status === 'error') {
    return (
      <section data-testid="inspection-card" style={inspectionSectionStyle}>
        <p style={{ ...mutedText, color: '#ff6b6b', fontSize: '0.8rem' }}>
          Couldn't load inspection: {inspState.error}
        </p>
      </section>
    );
  }

  const d = inspState.detail;
  if (!d) {
    return (
      <section data-testid="inspection-card" style={inspectionSectionStyle}>
        <p style={{ ...mutedText, fontSize: '0.85rem' }}>
          No exonym recorded for this country's dominant language yet.
        </p>
      </section>
    );
  }

  // Tint the exonym in the observer's cluster color at the observed
  // similarity — matches the polygon color on the map exactly, so the
  // user's eye links the polygon to the text without effort.
  const exonymTint = d.hue != null
    ? `rgb(${clusterFill(d.hue, d.similarity ?? 0).join(', ')})`
    : 'var(--muted)';

  return (
    <section data-testid="inspection-card" style={inspectionSectionStyle}>
      <p style={inspectionLabelStyle}>
        {d.observer_name_en} calls it
      </p>
      <p style={{ ...inspectionExonymStyle, color: exonymTint }}>
        {d.exonym}
      </p>
      {d.cluster_label && (
        <p style={inspectionMetaStyle}>
          <strong>{shortClusterLabel(d.cluster_label)}</strong> cluster
          {d.etymology_origin ? ` · ${d.etymology_origin}` : ''}
        </p>
      )}
      {d.observer_language_name && (
        <p style={{ ...inspectionMetaStyle, fontStyle: 'italic' }}>
          in {d.observer_language_name}
        </p>
      )}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  padding: '1.5rem',
  background: 'var(--panel)',
  overflowY: 'auto',
  minHeight: 0,
};

// Base style; the `color` is merged in at the call site from the computed
// `headingColor` (cluster tint when ready, --accent fallback otherwise).
const headingStyle: React.CSSProperties = {
  marginTop: 0,
  fontSize: '1.4rem',
  fontFamily: 'ui-serif, Georgia, serif',
  lineHeight: 1.2,
};

const subheadStyle: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: '0.85rem',
  marginTop: '0.25rem',
};

const mutedText: React.CSSProperties = {
  color: 'var(--muted)',
};

// Inspection card lives below the selected card, separated by a hairline so
// the two read as distinct cards rather than one continuous body.
const inspectionSectionStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  paddingTop: '1.25rem',
  borderTop: '1px solid var(--rule)',
};

const inspectionLabelStyle: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: 0,
};

const inspectionExonymStyle: React.CSSProperties = {
  fontSize: '1.6rem',
  fontFamily: 'ui-serif, Georgia, serif',
  marginTop: '0.25rem',
  marginBottom: '0.5rem',
  lineHeight: 1.1,
};

const inspectionMetaStyle: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: '0.85rem',
  marginTop: '0.25rem',
  marginBottom: 0,
};
