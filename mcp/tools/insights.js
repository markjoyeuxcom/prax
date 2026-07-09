import { z } from 'zod';
import { textResult, withErrorHandling } from '../toolResult.js';

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
  ];
}
