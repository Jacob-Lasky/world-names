import { useMemo } from 'react';
import { useSelection } from '../store/selection';
import { useCountryDetail } from '../data/use-country-detail';
import { useClusterColors } from '../data/use-cluster-colors';
import { selectedHeadingColor } from '../lib/similarity';

export function DetailPanel() {
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

  if (!selected) {
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <p style={mutedText}>
          Pick a country on the map to see what it calls itself and how that name
          drifted across other languages.
        </p>
      </aside>
    );
  }

  // Loading: DB is initializing or query is in flight. Show the polygon name as
  // a stable placeholder so the user sees *something* immediately on click.
  if (detailState.status === 'loading') {
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={mutedText}>Loading details…</p>
      </aside>
    );
  }

  if (detailState.status === 'error') {
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={{ ...mutedText, color: '#ff6b6b' }}>
          Failed to load details: {detailState.error}
        </p>
      </aside>
    );
  }

  const d = detailState.detail;
  if (!d) {
    // DB resolved but no row for this M49. Kosovo (no M49) hits this path.
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <h2 style={{ ...headingStyle, color: headingColor }}>{selected.name}</h2>
        <p style={mutedText}>
          M49 {selected.numericId || '—'} · no record in the data layer for this
          polygon yet.
        </p>
      </aside>
    );
  }

  return (
    <aside data-testid="detail-panel" style={panelStyle}>
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
    </aside>
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
