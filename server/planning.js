// The ONE place that decides what a planned_for change means — the sibling of
// slippage.js. The PATCH route asks this before every update; a "carried"
// answer bumps tasks.carry_count inside the same UPDATE and both kinds record
// an honest chronicle event.
//
//   planned — the task entered a day's working set (null -> date, or moved to
//             an EARLIER date: re-planning sooner is ambition, not slippage).
//   carried — an already-planned task rolled to a LATER date: the shutdown
//             ritual's Carry, or a stale plan pulled forward next morning.
//             Either way the original commitment moved — count it.
//
// Clearing planned_for (dropping from the plan) is deliberately NOT an event:
// dropping a plan is not dropping the task, and recording it would make Drop
// feel like a confession. Completed/archived tasks plan nothing.

export function classifyPlanChange(prior, fields) {
  if (!prior || typeof prior !== 'object') return { kind: 'none' };
  if (prior.status === 'completed' || prior.archivedAt) return { kind: 'none' };
  if (!Object.prototype.hasOwnProperty.call(fields, 'plannedFor')) return { kind: 'none' };

  const next = fields.plannedFor || null;
  const prev = prior.plannedFor || null;
  if (!next || next === prev) return { kind: 'none' };
  if (prev && next > prev) {
    return { kind: 'carried', message: `Carried ${prev} → ${next}` };
  }
  return { kind: 'planned', message: `Planned for ${next}` };
}
