# Codex second opinion: Prax as agent memory

## Bottom line

I would soften “retrieval mid-tier; epistemics best-in-class” to: **the stored trust model is unusually thoughtful, but the agent recall path does not yet cash it out**. The database has strong lifecycle/provenance fields and revision-bound verification, but recall hides much of that provenance, does not use trust in ranking, and today has no verified memories or evidence-rich verification loop.

The live database supports the measured headline: the `memory` project has 16 documents (14 active, 2 superseded), all 16 `updated_by=agent`, none verified, and all 16 have current OpenAI `text-embedding-3-small` 1536-dimensional embeddings. One refinement: only 15/16 have `updated_by_agent`; one older agent write is anonymous. Across the whole live library, all 18 non-archived documents have embeddings current for their stored revision.

## Which weaknesses I would challenge

1. **Opt-in recall — real, but “critical” and the hook remedy are overstated.** There is no repo `.claude/settings.json`, global Claude settings report no hooks, and the only integration is the two skill symlinks plus instructions. But in Codex the skill description and `AGENTS.md` are loaded into the session and did cause me to invoke recall before this task. The weakness is probabilistic compliance across harnesses, not total absence. A Claude `UserPromptSubmit` hook fixes only Claude, may send every prompt through recall, and cannot help when the service is down.

2. **Inert trust — right symptom, wrong root cause.** Zero verified documents does make the verified bit non-discriminating. More seriously, the claimed strength is factually too broad: `trustLabel()` emits only `verified|unverified` plus non-active lifecycle status (`cli/lib/recall.js:20-25`). `formatRecall()` prints document type and that label, but not `kind`, `updatedBy`, or `updatedByAgent` (`cli/lib/recall.js:154-166`). The semantic HTTP ref itself omits `updatedByAgent` and every timestamp (`server/libraryRoutes.js:256-275`). Retrieval ranks solely by cosine, with no verified-first boost or trust filter (`server/libraryRepository.js:932-948`). So the trust model is not merely unused because the data is all unverified; most of it is discarded by the agent-facing formatter.

3. **No age/date — agree.** This is more than a formatting omission: semantic refs omit `updatedAt`, and the top-document fetch selectively merges body, verified, and status only (`cli/lib/recall.js:120-126`). Active-only retrieval and supersession reduce the specific old/new-release risk, but facts can become stale without a supersedes link. Age belongs on every top and related hit.

4. **Single whole-document vector — factual, but the current severity is speculative.** `embeddableText()` is exactly title plus body (`server/embeddingService.js:3-10`). However, the live memory bodies are 293–1,955 characters (median about 640), so there is no evidence yet that chunking is the dominant current failure. Add a real semantic retrieval evaluation first; then chunk based on measured misses. Long multi-topic runbooks will eventually require it.

5. **O(n) JS cosine — agree technically, medium is fair.** The query selects body plus JSON embedding for every eligible row (`server/libraryRepository.js:428-459`), parses and scores every vector in JS, and sorts the full result (`server/libraryRepository.js:932-948`); “more like this” repeats the scan (`:955-973`). At 18 live documents it is irrelevant. It becomes a scale ceiling, not a present quality defect.

6. **One DB/no sync/container team use — conflated and partly misdiagnosed.** No sync is a multi-device/replication limitation. No authentication is an untrusted-network limitation. Multiple host agents on one machine can share the one loopback server and SQLite serializes writes. Containers need reviewed host reachability or an authenticated proxy; the code deliberately refuses non-loopback binding without acknowledgement (`server/config.js:12-36`). Therefore “team use is blocked” is too categorical; **container-to-host and remote team use are not safely turnkey** is accurate.

7. **Two memory systems — real overlap, but “pick one store” is not fully actionable.** Claude’s project memory contains a memory-system review overlapping a Prax memory, so duplication exists. But Claude’s private memory is a vendor-local cache that Codex cannot portably consume, while Prax is the only cross-vendor candidate. Make Prax canonical for durable/shared knowledge and explicitly restrict Claude memory to transient/vendor-local indexing; do not pretend the vendor cache can necessarily be removed. I would rank this below missing provenance display and service availability.

## What the review missed

- **The central strength claim is false at the recall boundary.** `kind`, human/agent origin, and agent identity are not surfaced in recall output. This materially changes the “best-in-class epistemics” verdict.
- **Trust is workflow metadata, not authenticated provenance.** The project documents this explicitly (`docs/contract.md:458-460`). Anyone who can reach the unauthenticated API can supply origin headers or call verification; the verify actor is caller-supplied (`server/libraryRoutes.js:1038-1056`). That is acceptable for a trusted single-user loopback app, but it must not be described as a security-grade chain of custody.
- **No revision history and last-writer-wins remember updates.** Upsert serializes creation and prevents duplicate titles, but an existing title is updated unconditionally with replacement body/tags (`server/libraryRepository.js:751-769`). There is no document-revision table in the live schema. Two agents refining the same title do not duplicate it; the later one silently replaces the earlier body and current-writer provenance. Receipts protect request replay, not concurrent intent.
- **Verification lacks evidence.** Only 4 external references exist across the 16 memory documents, on three documents; 13/16 have none. Making the button faster does not make a human able to verify a synthesized claim. A review queue should show diffs, writer, age, and source/reference evidence before asking for a blessing.
- **There is no semantic quality gate.** `tests/eval/retrievalEval.js:32-37` explicitly evaluates keyword FTS plus context packs. `docs/ROADMAP.md:80-84` says semantic mode is future work, while the quality standard says “keyword and semantic evaluation” (`docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md:316-320`). The semantic tests use synthetic vectors and prove mechanics, not retrieval relevance on real memories. The “mid-tier” ranking is therefore plausible architecture judgment, not a measured result.
- **Availability fails before relevance matters.** In this Codex run, the required recall skill tried the saved desktop port and the default port and returned `Prax not reachable`; the database was readable and current, but the skill has no offline/read-only path. A prompt hook would have produced the same failure on every invocation.
- **The 800-character top-body cap is another long-runbook bottleneck.** Recall truncates the top body and gives related hits only titles/IDs (`cli/lib/recall.js:12-17,159-166`). Chunking the index alone would not make the needed later section available to the agent.

## Sequencing

I would not make an every-prompt hook the first isolated fix.

1. Make retrieval reliably available, and add bounded activation per vendor: Claude hook where appropriate, Codex skill/instruction integration, failure deduplication, and no repeated noisy call when Prax is down. Prefer once per task/session transition over blindly on every prompt.
2. Fix the recall contract: include `updatedAt`/age, `kind`, `updatedBy`, `updatedByAgent`, verification actor/date, and enough snippet context on related hits. Decide explicitly whether trust should affect ranking or only presentation.
3. Add a semantic relevance eval on a representative, multi-topic, long-document corpus. Use it to choose chunking thresholds and only then add a vector index when corpus/latency data justify it.
4. Build the evidence-backed human review loop and document history/conditional upsert, so verification and cross-agent refinement are trustworthy rather than merely quick.

If forced to choose one small patch, I would take **age plus full provenance in recall** before a hook: automation that injects epistemically incomplete output more often is not the highest-value outcome. If allowed a product slice, reliable task-scoped activation plus the corrected recall contract should ship together.

## Skills versus MCP from Codex

The trade is mostly right, but it should be framed as **skills for the default memory workflow, MCP for interactive breadth**, not “skills instead of MCP.” Codex discovered the same repo-local bundle through `.agents/skills/`; the one-file script returned a bounded block and avoided registering Prax’s large MCP tool tree (`mcp/server.js:28-41`). That is genuinely portable and context-efficient.

The costs are real: invocation still depends on the model obeying the skill, shells out to Node, and requires the HTTP app to be running. MCP would give typed, directly callable operations and stronger tool discoverability, though its current semantic tool returns collection envelopes rather than the carefully distilled recall block (`mcp/tools/semanticSearch.js:5-49`). Keep the canonical logic in `cli/lib`, retain the compact skills as the default, and expose one equivalent high-level `recall` MCP tool only for sessions that already enable Prax MCP. Do not load the entire task/library MCP surface merely to gain memory recall.

## Tested

- Queried the live SQLite database directly for project/document counts, provenance, lifecycle, verification, embedding model/dimension/current revision, body lengths, references, and links.
- Ran `node --test tests/cli/recall.test.js tests/backend/libraryRepository.embedding.test.js tests/backend/libraryUpsertByTitle.test.js tests/backend/libraryRoutes.trust.test.js`: 66 tests passed, 0 failed.
- Ran the actual repo-local Codex recall skill for this task: it failed honestly because neither discovered Prax endpoint was reachable.

## Unable to test

- Real semantic relevance/precision against the configured embedding provider, because the Prax service was not running and the repository has no live semantic relevance harness. I did not start or mutate the user’s app/database for a review-only task.
