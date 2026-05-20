const DESKTOP_QUERY = '(min-width: 1024px)';
const TABLET_QUERY  = '(min-width: 768px)';

function safeMatch(query) {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function isDesktop() {
  return safeMatch(DESKTOP_QUERY);
}

export function isTablet() {
  return !isDesktop() && safeMatch(TABLET_QUERY);
}

export function isMobile() {
  return !safeMatch(TABLET_QUERY);
}

export function currentBand() {
  if (isDesktop()) return 'desktop';
  if (isTablet()) return 'tablet';
  return 'mobile';
}

export function onBreakpointChange(callback) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  let lastBand = currentBand();
  const desktopMql = window.matchMedia(DESKTOP_QUERY);
  const tabletMql = window.matchMedia(TABLET_QUERY);
  const handler = () => {
    const band = currentBand();
    if (band !== lastBand) {
      lastBand = band;
      callback(band);
    }
  };
  desktopMql.addEventListener('change', handler);
  tabletMql.addEventListener('change', handler);
  return () => {
    desktopMql.removeEventListener('change', handler);
    tabletMql.removeEventListener('change', handler);
  };
}
