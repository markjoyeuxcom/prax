-- Repair the 0013 chronicle backfill order: it sequenced legacy step-checked
-- events by runbook POSITION (row_number over step.position) while stamping
-- created_at from step.checked_at — permanently baking a false order into the
-- incident ledger for any run whose operator checked steps out of order.
--
-- Re-sequence every run's step-checked/step-unchecked events by created_at
-- (tie-break: original sequence, which preserves live-written order — the
-- live appendRunEvent path allocates sequence at write time, so live rows are
-- already time-ordered and this is a no-op for them). The started event keeps
-- sequence 0 and terminal events keep their place because ordering by
-- created_at with the original sequence as tie-break reproduces their
-- positions; only genuinely out-of-time backfilled rows move.
--
-- unique (run_id, sequence) forbids transient collisions, so the reassignment
-- is two-phase: shift every event far above the live range, then assign the
-- final time-ordered sequence.
update runbook_run_events
set sequence = sequence + 1000000
where run_id in (
  select run_id from runbook_run_events group by run_id having count(*) > 1
);

-- Tie-break by rowid, NOT by sequence: SQLite applies the UPDATE row by row,
-- so peer.sequence mutates mid-statement and two events sharing created_at
-- could compute the same final value (a unique-constraint failure). rowid is
-- stable, unique, and follows insert order — which is the original sequence
-- order for both the 0013 backfill and live appends.
update runbook_run_events
set sequence = (
  select count(*)
  from runbook_run_events peer
  where peer.run_id = runbook_run_events.run_id
    and (
      peer.created_at < runbook_run_events.created_at
      or (peer.created_at = runbook_run_events.created_at
          and peer.rowid < runbook_run_events.rowid)
    )
)
where run_id in (
  select run_id from runbook_run_events group by run_id having count(*) > 1
);
