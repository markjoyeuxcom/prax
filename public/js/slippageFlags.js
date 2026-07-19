// Slippage honesty chips — the pure "should this task wear a mirror" rule,
// kept out of the render modules the same way dueFlags.js is. Signals, never
// enforcement: chips appear only past the (preference-set) thresholds, and
// never on completed or archived tasks — done work has nothing to confess.

export const SLIPPAGE_DEFAULTS = Object.freeze({
  slippageChips: true,
  slippageDeferrals: 3,
  slippageAgeDays: 30,
});

// preferences → the effective thresholds ({ enabled, deferrals, ageDays }).
export function slippageThresholds(preferences = {}) {
  const num = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);
  return {
    enabled: preferences.slippageChips !== false,
    deferrals: num(preferences.slippageDeferrals, SLIPPAGE_DEFAULTS.slippageDeferrals),
    ageDays: num(preferences.slippageAgeDays, SLIPPAGE_DEFAULTS.slippageAgeDays),
  };
}

// -> [{ label, variant }] for renderHelpers.chip; [] when nothing to say.
export function slippageChips(task, { now = new Date(), preferences = {} } = {}) {
  const thresholds = slippageThresholds(preferences);
  if (!thresholds.enabled || !task || task.status === 'completed' || task.archivedAt) return [];
  const chips = [];
  const deferrals = Number(task.deferralCount) || 0;
  if (deferrals >= thresholds.deferrals) {
    chips.push({ label: `deferred ${deferrals}×`, variant: 'slip-deferred' });
  }
  const created = task.createdAt ? new Date(task.createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) {
    const days = Math.floor((now - created) / 86_400_000);
    if (days >= thresholds.ageDays) chips.push({ label: `${days}d old`, variant: 'slip-age' });
  }
  return chips;
}
