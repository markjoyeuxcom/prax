// Prax icon set — 15×15 stroke primitives (stroke 1.4, round caps/joins,
// currentColor) plus the brand logo, ported from the design prototype.
// Every function returns an SVG string for innerHTML-style composition.

const SHAPES = {
  grid: '<rect x="1.5" y="1.5" width="5" height="5" rx="1.2"/><rect x="8.5" y="1.5" width="5" height="5" rx="1.2"/><rect x="1.5" y="8.5" width="5" height="5" rx="1.2"/><rect x="8.5" y="8.5" width="5" height="5" rx="1.2"/>',
  book: '<rect x="2.5" y="1.5" width="10" height="12" rx="1.5"/><line x1="5.5" y1="1.5" x2="5.5" y2="13.5"/>',
  doc: '<rect x="3" y="1.5" width="9" height="12" rx="1.5"/><line x1="5.5" y1="5" x2="9.5" y2="5"/><line x1="5.5" y1="8" x2="9.5" y2="8"/>',
  search: '<circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="13.5" y2="13.5"/>',
  plus: '<line x1="7.5" y1="3" x2="7.5" y2="12"/><line x1="3" y1="7.5" x2="12" y2="7.5"/>',
  sliders: '<line x1="2" y1="5" x2="13" y2="5"/><line x1="2" y1="10" x2="13" y2="10"/><circle cx="5.5" cy="5" r="1.7" fill="var(--bg)"/><circle cx="9.5" cy="10" r="1.7" fill="var(--bg)"/>',
  tag: '<rect x="2" y="2" width="7" height="7" rx="1.5"/><line x1="6.5" y1="6.5" x2="12.5" y2="12.5"/>',
  spark: '<line x1="7.5" y1="1.5" x2="7.5" y2="13.5"/><line x1="1.5" y1="7.5" x2="13.5" y2="7.5"/><line x1="3.5" y1="3.5" x2="11.5" y2="11.5"/><line x1="11.5" y1="3.5" x2="3.5" y2="11.5"/>',
  check: '<rect x="1.8" y="1.8" width="11.4" height="11.4" rx="3"/><line x1="4.6" y1="7.7" x2="6.7" y2="9.8"/><line x1="6.7" y1="9.8" x2="10.4" y2="5.4"/>',
  group: '<line x1="2" y1="3.5" x2="13" y2="3.5"/><line x1="2" y1="7.5" x2="10" y2="7.5"/><line x1="2" y1="11.5" x2="13" y2="11.5"/>',
  cmd: '<rect x="2" y="2" width="11" height="11" rx="2.5"/><line x1="5" y1="7.5" x2="10" y2="7.5"/>',
  inbox: '<rect x="1.8" y="3" width="11.4" height="9" rx="2"/><line x1="1.8" y1="8.2" x2="5.2" y2="8.2"/><line x1="9.8" y1="8.2" x2="13.2" y2="8.2"/><circle cx="7.5" cy="8.2" r="1.6"/>',
};

export function icon(name, size = 15) {
  const shapes = SHAPES[name] || SHAPES.doc;
  return `<svg width="${size}" height="${size}" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none" aria-hidden="true">${shapes}</svg>`;
}

// Brand logo: rounded-square outline + 45°-rotated rounded square + lowercase "p",
// all in the accent colour. Sizes used: 15 (palette footer), 25 (sidebar), 48 (empty states).
export function logo(size = 25) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none" style="flex:none" aria-hidden="true">`
    + '<rect x="1.5" y="1.5" width="25" height="25" rx="7.5" stroke="var(--accent)" stroke-width="2"/>'
    + '<rect x="8.2" y="8.2" width="11.6" height="11.6" rx="2.6" stroke="var(--accent)" stroke-width="1.7" transform="rotate(45 14 14)"/>'
    + '<text x="14" y="17.2" text-anchor="middle" font-family=\'"Instrument Sans", sans-serif\' font-size="9" font-weight="700" fill="var(--accent)">p</text>'
    + '</svg>';
}

export const ICON_NAMES = Object.keys(SHAPES);
