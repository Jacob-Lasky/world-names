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
            {selected.endonym ?? selected.name}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 0 }}>
            {selected.iso3 ? `ISO ${selected.iso3} · ` : ''}
            {selected.language ? `spoken language: ${selected.language}` : `M49 ${selected.numericId}`}
          </p>
          <p>
            {selected.blurb ?? (
              <span style={{ color: 'var(--muted)' }}>
                Etymology blurb arrives once the ETL ships data. For now, polygons
                are live and selection state is wired through Zustand.
              </span>
            )}
          </p>
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
