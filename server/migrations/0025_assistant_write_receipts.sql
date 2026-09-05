-- A receipt claims the intent before execution. An interrupted claim is
-- explicitly uncertain and must never be blindly re-executed after restart.
CREATE TABLE assistant_write_receipts (
  operation_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('executing', 'completed')),
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
