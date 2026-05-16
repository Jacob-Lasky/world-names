import { useSelection } from '../store/selection';
import { useCountryDetail } from '../data/use-country-detail';

export function DetailPanel() {
  const selected = useSelection((s) => s.selectedCountry);
  const detailState = useCountryDetail(selected?.numericId ?? null);

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
        <h2 style={headingStyle}>{selected.name}</h2>
        <p style={mutedText}>Loading details…</p>
      </aside>
    );
  }

  if (detailState.status === 'error') {
    return (
      <aside data-testid="detail-panel" style={panelStyle}>
        <h2 style={headingStyle}>{selected.name}</h2>
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
        <h2 style={headingStyle}>{selected.name}</h2>
        <p style={mutedText}>
          M49 {selected.numericId || '—'} · no record in the data layer for this
          polygon yet.
        </p>
      </aside>
    );
  }

  return (
    <aside data-testid="detail-panel" style={panelStyle}>
      <h2 style={headingStyle}>{d.endonym ?? d.name_en}</h2>
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

const headingStyle: React.CSSProperties = {
  marginTop: 0,
  color: 'var(--accent)',
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
