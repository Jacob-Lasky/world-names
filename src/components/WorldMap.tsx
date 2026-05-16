// Placeholder. Real implementation arrives in Task #3 — drops in Natural Earth
// polygons via @deck.gl/react GeoJsonLayer, hooks selection into the Zustand
// store, and renders cluster-based fills once the SQLite data layer lands.
export function WorldMap() {
  return (
    <div
      data-testid="world-map"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--panel)',
        color: 'var(--muted)',
        borderRight: '1px solid var(--rule)',
        minHeight: 0,
      }}
    >
      Map canvas — coming next task.
    </div>
  );
}
