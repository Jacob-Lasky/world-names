import { useSelection } from '../store/selection';

export function DetailPanel() {
  const selected = useSelection((s) => s.selectedCountry);

  return (
    <aside
      data-testid="detail-panel"
      style={{
        padding: '1.5rem',
        background: 'var(--panel)',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      {selected ? (
        <>
          <h2 style={{ marginTop: 0, color: 'var(--accent)', fontSize: '1.1rem' }}>
            {selected.endonym}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>
            ISO {selected.iso3} &middot; spoken language: {selected.language}
          </p>
          <p>{selected.blurb ?? 'Etymology blurb arrives once the ETL ships.'}</p>
        </>
      ) : (
        <p style={{ color: 'var(--muted)' }}>
          Pick a country on the map to see what it calls itself and how that name
          drifted across other languages.
        </p>
      )}
    </aside>
  );
}
