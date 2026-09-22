import { createAssistantWriteReceipts } from './assistant/writeReceipts.js';
import { createInjectClient, withForwardedHeaders } from './assistant/injectClient.js';
import { buildAgentTools } from './assistant/tools.js';
import { buildWritePreview } from './assistant/writePreview.js';
import { runAssistant, sanitizeMessages, buildAssistantSystemPrompt } from './assistant/agent.js';
import { buildWorkspaceSnapshot, buildReadOnlyRules } from './assistant/snapshot.js';
import { LOCAL_DATE_HEADER, requestToday } from './localDay.js';
import { isToolCallTurn } from './chat/messages.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// The built-in AI assistant: a tool-calling agent over the same tool tree the
// MCP server exposes, running in-process against the app's own routes. Reads run
// freely; writes suspend for one-click confirmation. Degrades gracefully — never
// 500s on the AI path — when no chat model is set or the model can't call tools.
export function registerAssistantRoutes(app, options = {}) {
  const injectedChat = options.chat ?? null;
  const chatProvider = options.chatProvider ?? app.chatProvider ?? null;
  // The tool tree is static; bind it once to an in-process client for this app.
  // The same client also feeds the no-tools snapshot, so grounding data flows
  // through the identical routes (and honesty rules) the agent tools use.
  const client = createInjectClient(app);
  const tools = buildAgentTools(client);
  const writeReceipts = options.assistantWriteReceipts ?? createAssistantWriteReceipts(app.db);

  async function resolveChat() {
    if (injectedChat) return injectedChat;
    if (chatProvider) {
      try { return await chatProvider.getChat(); } catch { return null; }
    }
    return null;
  }

  app.get('/api/assistant/status', async () => {
    const chat = await resolveChat();
    return {
      available: Boolean(chat),
      model: chat?.model ?? null,
      backend: chat?.backend ?? null,
      supportsTools: Boolean(chat?.supportsTools),
      toolCount: tools.length,
    };
  });

  app.post('/api/assistant/chat', async (request, reply) => {
    const body = isPlainObject(request.body) ? request.body : {};
    const messages = sanitizeMessages(body.messages);
    const decisions = isPlainObject(body.decisions) ? body.decisions : null;
    if (!messages.length) { reply.code(400); return { message: 'messages is required' }; }
    // The requester's calendar day, not the server clock's (server/localDay.js).
    const today = requestToday(request);

    const chat = await resolveChat();
    if (!chat) return { status: 'no_model', degraded: true, reason: 'no-chat-model', messages };

    // A suspended tool turn (a pending approval) can only be resolved by a
    // tool-capable model. If the operator switched to one without tool
    // support meanwhile, the read-only path below would drop the proposal from
    // the prompt and report an ordinary `done`, silently losing an unresolved
    // consequential action. Refuse explicitly, execute nothing, and hand the
    // canonical history back so the client keeps its pending/attempted state.
    if (!chat.supportsTools && isToolCallTurn(messages[messages.length - 1])) {
      return {
        status: 'error',
        degraded: true,
        reason: 'approval-unavailable',
        executed: false,
        didWrite: false,
        error: 'The configured model cannot run tools, so the pending approval was not executed. Switch to a tool-capable backend (Settings ▸ Intelligence) to approve it, or decline it.',
        messages,
        model: chat.model ?? null,
      };
    }

    // Providers without tool-calling (CLI backends/Ollama/llama.cpp) degrade to
    // a read-only completion GROUNDED in a live workspace snapshot. Without
    // the snapshot the model fabricates ("you have no tasks") to fill the
    // vacuum — so if the snapshot fails to load, the rules switch to an
    // explicit no-visibility stance rather than letting it guess.
    if (!chat.supportsTools) {
      let snapshot = null;
      try {
        const [tasks, projects, documents] = await Promise.all([
          client.listTasks({}),
          client.listProjects(),
          // The Library index (titles + trust metadata, never bodies) rides
          // along so "which docs need review" answers from truth too. Its
          // failure must not blind the task snapshot — degrade to tasks-only.
          client.listDocuments({}).catch(() => []),
        ]);
        snapshot = buildWorkspaceSnapshot({ tasks, projects, documents, today });
      } catch (err) {
        request.log.error({ err }, 'assistant snapshot failed');
      }
      try {
        const note = [
          buildAssistantSystemPrompt(today),
          '',
          buildReadOnlyRules(Boolean(snapshot)),
          ...(snapshot ? ['', snapshot] : []),
        ].join('\n');
        const res = await chat.complete([{ role: 'system', content: note }, ...messages], { temperature: 0.3, maxTokens: 1200 });
        // A reply cut off at the length limit says so in the answer itself.
        const answer = res.truncated
          ? `${res.text}\n\n(This answer was cut off at the model’s length limit and is incomplete.)`
          : res.text;
        return {
          status: 'done', degraded: true, reason: res.truncated ? 'truncated' : 'no-tools',
          ...(res.truncated ? { truncated: true } : {}),
          answer, model: res.model, messages: [...messages, { role: 'assistant', content: answer }],
        };
      } catch (err) {
        request.log.error({ err }, 'assistant (no-tools) failed');
        return { status: 'error', degraded: true, reason: 'generation-failed', error: err?.message || 'failed', messages };
      }
    }

    try {
      // Approved writes run in-process and inherit the same day, so completing
      // a recurring task rolls forward from the user's today.
      return await withForwardedHeaders({ [LOCAL_DATE_HEADER]: today }, () => runAssistant({
        chat, tools, messages, decisions, writeReceipts, system: buildAssistantSystemPrompt(today),
        // The approval card names targets by title and shows current values,
        // read through the same in-process client the tools use.
        describeWrite: (call) => buildWritePreview(client, call.name, call.input),
      }));
    } catch (err) {
      request.log.error({ err }, 'assistant turn failed');
      return { status: 'error', degraded: true, reason: 'agent-failed', error: err?.message || 'failed', messages };
    }
  });
}
