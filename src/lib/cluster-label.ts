/** Cluster YAML labels are long ("Alemanni — southwestern Germanic
 *  tribal confederation") so they fit as section headers but blow out
 *  a compact chip. We display the part before " — " in the chip (e.g.
 *  "Alemanni"), and keep the full label in the tooltip + aria-label so
 *  the descriptive context is still reachable. Falls back to the full
 *  label if there's no em-dash separator.
 *
 *  Lives in its own module (not similarity.ts which is color math,
 *  not Legend.tsx which would trip react-refresh's "one component per
 *  file" rule) so the InspectionCard can import it too — the inspection
 *  card uses the same short label so the cluster name reads cleanly
 *  before the " cluster" suffix.
 */
export function shortClusterLabel(label: string): string {
  const idx = label.indexOf(' — ');
  if (idx < 0) return label;
  return label.slice(0, idx);
}
