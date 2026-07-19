// The ONE place that decides what counts as slippage. The PATCH route asks
// this before every update; the answer both increments tasks.deferral_count
// (inside the same UPDATE as the change itself) and records an honest
// chronicle event. Pinning the semantics here — with an exhaustive test table
// — keeps "what is a slip" from drifting silently across surfaces.
//
// A slip is a CONSCIOUS push of a live commitment:
//   - snoozing an open task into the future (deferredUntil > now), or
//   - moving an open task's existing due date LATER.
// Explicitly NOT slips: scheduling (undated -> dated), pulling a date earlier,
// clearing a date or snooze, completing (even with a date change in the same
// patch), anything on an already-completed or archived task, and a no-op
// resend of the same snooze instant (per-field saves and agents may replay).

export function classifySlip(prior, fields, now = new Date()) {
  if (!prior || typeof prior !== 'object') return { kind: 'none' };
  if (prior.status === 'completed' || prior.archivedAt) return { kind: 'none' };
  if (fields.status === 'completed') return { kind: 'none' };

  if (Object.prototype.hasOwnProperty.call(fields, 'deferredUntil') && fields.deferredUntil) {
    const until = new Date(fields.deferredUntil);
    if (!Number.isNaN(until.getTime()) && until > now) {
      const prev = prior.deferredUntil ? new Date(prior.deferredUntil).getTime() : null;
      if (prev !== until.getTime()) {
        return { kind: 'deferred', message: `Snoozed until ${fields.deferredUntil}` };
      }
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(fields, 'dueDate')
    && prior.dueDate && fields.dueDate && fields.dueDate > prior.dueDate
  ) {
    return { kind: 'rescheduled', message: `Due moved ${prior.dueDate} → ${fields.dueDate}` };
  }

  return { kind: 'none' };
}
