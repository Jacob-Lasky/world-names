import { describe, it, expect } from 'vitest';
import { shortClusterLabel } from './cluster-label';

describe('shortClusterLabel', () => {
  // Cluster labels in the YAML follow "short — description" so they read
  // as a complete cluster-name AND a short etymology when displayed
  // standalone. The legend chip displays only the part before " — " so
  // it fits; the inspection card uses the short form too so the
  // " cluster" suffix reads cleanly.

  it('takes the part before the em-dash separator', () => {
    expect(shortClusterLabel('Alemanni — southwestern Germanic tribal confederation')).toBe('Alemanni');
  });

  it('preserves the full label when no separator exists', () => {
    // Defensive: if a future YAML omits the " — description", fall
    // back gracefully rather than dropping the label entirely.
    expect(shortClusterLabel('Saksa')).toBe('Saksa');
    expect(shortClusterLabel('Chinese 德')).toBe('Chinese 德');
  });

  it('keeps a bare em-dash from triggering truncation', () => {
    // The separator is " — " (em-dash + spaces). A bare em-dash mid-
    // label shouldn't trigger truncation.
    expect(shortClusterLabel('Proto-Germanic *þeudō')).toBe('Proto-Germanic *þeudō');
  });

  it('only splits at the first separator', () => {
    // If the description itself contains " — " (rare but possible),
    // we still only take the head — the short name is everything
    // before the FIRST em-dash.
    expect(shortClusterLabel('A — B — C')).toBe('A');
  });

  it('handles all the real DEU cluster labels we ship', () => {
    expect(shortClusterLabel('Germani — Roman name for Germanic tribes')).toBe('Germani');
    expect(shortClusterLabel('Slavic *němьcь — \'the mute/foreign ones\'')).toBe('Slavic *němьcь');
    expect(shortClusterLabel('Baltic *Vāka — ancient Baltic ethnonym')).toBe('Baltic *Vāka');
    expect(shortClusterLabel('Chinese 德 — phonetic transliteration')).toBe('Chinese 德');
  });
});
