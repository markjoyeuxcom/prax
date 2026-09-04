# Agy follow-up — adjudication of initial findings

This clarification followed completion of all three independent initial reports. Parley Ask: `0659cf47-68ba-4b45-a898-8ff7a0f9c692`.

Agy explicitly reclassified its initial Defect 2 (POST/PUT restoration of cancelled Google Calendar events) as an **unverified coverage gap**, acknowledging that the official Google error guide does not establish 410 for PUT on cancelled events. It did not provide a live reproduction or substantiate the initially suggested PATCH/import repair. Neither the failure sequence nor that repair is endorsed by the consolidated review.

Agy confirmed the documentation discrepancy in Defect 3: `AGENTS.md` says provider settings are env-only, while runtime settings are persisted in SQLite and `SECURITY.md` reflects that behavior. The response supplied no additional evidence of a broken default loopback boundary. The consolidated review treats the documentation issue as actionable and executable selection as an operator trust-boundary consideration.

Agy maintained Defect 1, the all-day start/end interval error. Codex independently confirmed the generated payload and checked the official exclusive-end contract. Agy's predicted exact HTTP error text was not observed against a live provider and remains excluded from the consolidated claims.

The original Agy report is preserved unchanged so its initial independent assessment and subsequent corrections remain distinguishable.
