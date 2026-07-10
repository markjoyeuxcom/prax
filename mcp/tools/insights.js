import { z } from 'zod';
import { isValidUuid } from '../validate.js';
import { okResult, errorResult, textResult, withErrorHandling } from '../toolResult.js';

// AI "insight" tools that synthesize over the library. ask_prax answers a
// question with a grounded, cited answer (degrading to the raw context pack when
// no chat model is configured) — the agent-facing twin of the human "Ask Prax"
// panel and a step up from ask_library, which returns only the pack.
export function createInsightTools(client) {
  return [
    {
      name: 'ask_prax',
      title: 'Ask Prax',
      description:
        'Answer a question from the Prax library with a grounded, cited answer. Retrieves the most relevant documents (trust-aware) and, when a chat model is configured, synthesizes an answer that cites its sources by title. If no chat model is configured it returns the raw context pack instead (like ask_library). Use for "what do we know about X / how do we do Y" questions.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().min(1).describe('The question to answer from the library.'),
        project: z.string().optional().describe('Limit retrieval to one project (slug or id); omit for the whole workspace.'),
        limit: z.number().int().positive().optional().describe('Max documents to retrieve for context (default 12, capped at 50).'),
      },
      handler: withErrorHandling(async ({ query, project, limit }) => {
        const res = await client.ask({ q: query, project, limit });
        // Prefer the synthesized answer; fall back to the retrieved pack.
        const answer = res && typeof res.answer === 'string' && res.answer.trim() ? res.answer : null;
        if (answer) {
          const sources = Array.isArray(res.sources) && res.sources.length
            ? `\n\n---\nSources: ${res.sources.map((s) => `[${s.title}]${s.verified ? '' : ' (unverified)'}`).join(', ')}`
            : '';
          return textResult(`${answer}${sources}`);
        }
        const pack = res && typeof res.markdown === 'string' ? res.markdown : '';
        return textResult(pack || 'No matching documents in the library.');
      }),
    },
    {
      name: 'generate_post_mortem',
      title: 'Generate a post-mortem',
      description:
        'Draft a post-mortem document from a completed runbook run’s chronicle (steps, timestamps, actors). Creates an agent-written, unverified post-mortem document in the runbook’s project for a human to review and verify. Uses the configured chat model to narrate, or a deterministic template when none is set.',
      inputSchema: {
        runId: z.string().describe('UUID of the runbook run to summarize (from list_runbook_runs / get_runbook_run).'),
      },
      handler: withErrorHandling(async ({ runId }) => {
        if (!isValidUuid(runId)) return errorResult('runId must be a valid UUID.');
        const res = await client.generatePostMortem(runId);
        return okResult(res);
      }),
    },
    {
      name: 'generate_runbook',
      title: 'Generate a runbook',
      description:
        'Draft a runnable runbook from an alert or incident description. The server’s chat model writes it (checkbox steps, commands, rollback); the result is an agent-written, unverified runbook in the given project for a human to review and verify. Requires a chat model configured (Settings ▸ Intelligence).',
      inputSchema: {
        description: z.string().min(1).describe('The alert or incident to write a runbook for.'),
        project: z.string().describe('Project slug or id to file the runbook under.'),
      },
      handler: withErrorHandling(async ({ description, project }) => {
        const res = await client.generateRunbook({ description, project });
        return okResult(res);
      }),
    },
  ];
}
