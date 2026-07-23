import { createInjectClient } from './assistant/injectClient.js';
import { buildAgentTools } from './assistant/tools.js';
import { runAssistant, sanitizeMessages, buildAssistantSystemPrompt } from './assistant/agent.js';
import { buildWorkspaceSnapshot, buildReadOnlyRules, localToday } from './assistant/snapshot.js';

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

    const chat = await resolveChat();
    if (!chat) return { status: 'no_model', degraded: true, reason: 'no-chat-model', messages };

    // Providers without tool-calling (claude-cli/Ollama/llama.cpp) degrade to
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
        snapshot = buildWorkspaceSnapshot({ tasks, projects, documents, today: localToday() });
      } catch (err) {
        request.log.error({ err }, 'assistant snapshot failed');
      }
      try {
        const note = [
          buildAssistantSystemPrompt(),
          '',
          buildReadOnlyRules(Boolean(snapshot)),
          ...(snapshot ? ['', snapshot] : []),
        ].join('\n');
        const { text, model } = await chat.complete([{ role: 'system', content: note }, ...messages], { temperature: 0.3, maxTokens: 1200 });
        return { status: 'done', degraded: true, reason: 'no-tools', answer: text, model, messages: [...messages, { role: 'assistant', content: text }] };
      } catch (err) {
        request.log.error({ err }, 'assistant (no-tools) failed');
        return { status: 'error', degraded: true, reason: 'generation-failed', error: err?.message || 'failed', messages };
      }
    }

    try {
      return await runAssistant({ chat, tools, messages, decisions });
    } catch (err) {
      request.log.error({ err }, 'assistant turn failed');
      return { status: 'error', degraded: true, reason: 'agent-failed', error: err?.message || 'failed', messages };
    }
  });
}
