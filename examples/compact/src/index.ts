import { openai } from "@ai-sdk/openai";
import { generateText, type ModelMessage } from "ai";
import { type JsonLike, runAgent, type AgentStreamEvent } from "@nanoagent/kernel";

export type ChatMessage = {
  [key: string]: JsonLike;
  role: "system" | "user" | "assistant";
  content: string;
};

export type Session = {
  context: ChatMessage[];
  history: ChatMessage[];
};

export type CompactDeps = {
  compactAfterTokens: number;
  keepRecentMessages: number;
  streamToClient?: (event: AgentStreamEvent) => void;
};

async function compactMessages(messages: ChatMessage[]) {
  const result = await generateText({
    model: openai("gpt-5.4-mini"),
    messages: [
      {
        role: "system",
        content:
          "Summarize older conversation messages for future model context. Preserve facts, decisions, user preferences, and unresolved tasks.",
      },
      {
        role: "user",
        content: JSON.stringify(messages, null, 2),
      },
    ],
  });

  return result.text;
}

export async function compactContext(params: {
  messages: ChatMessage[];
  turnTotalTokens: number;
  compactAfterTokens: number;
  keepRecentMessages: number;
}): Promise<{ compacted: boolean; messages: ChatMessage[] }> {
  if (params.turnTotalTokens < params.compactAfterTokens) {
    return { compacted: false, messages: params.messages };
  }

  const compactAt = params.messages.length - params.keepRecentMessages;
  if (compactAt <= 0) {
    return { compacted: false, messages: params.messages };
  }

  const olderMessages = params.messages.slice(0, compactAt);
  const recentMessages = params.messages.slice(compactAt);
  const summary = await compactMessages(olderMessages);

  return {
    compacted: true,
    messages: [
      {
        role: "system",
        content: `Conversation summary:\n${summary}`,
      } satisfies ChatMessage,
      ...recentMessages,
    ],
  };
}

export async function runCompact(params: {
  deps: CompactDeps;
  runId: string;
  session: Session;
  prompt: string;
}) {
  const userMessage = { role: "user", content: params.prompt } satisfies ChatMessage;
  params.session.history.push(userMessage);
  params.session.context.push(userMessage);

  let compacted = false;

  for await (const event of runAgent<{ messages: ChatMessage[] }>({
    state: {
      runId: params.runId,
      context: { messages: params.session.context },
    },
    maxTurns: 1,
    hooks: {
      onTurnPrepared: ({ context }) => ({
        value: {
          model: "openai/gpt-5.4-mini",
          messages: [
            {
              role: "system",
              content: "Answer in one concise sentence.",
            },
            ...context.messages,
          ],
        },
      }),
      onTurnCompleted: async ({ context, turn }) => {
        const modelResult = turn.modelResult;
        if (!modelResult?.text) return;

        const assistantMessage = {
          role: "assistant",
          content: modelResult.text,
        } satisfies ChatMessage;

        const turnTotalTokens =
          modelResult.totalUsage.totalTokens ??
          (modelResult.totalUsage.inputTokens ?? 0) +
            (modelResult.totalUsage.outputTokens ?? 0);

        const messages = [...context.messages, assistantMessage]
        const result = await compactContext({
          messages,
          turnTotalTokens,
          compactAfterTokens: params.deps.compactAfterTokens,
          keepRecentMessages: params.deps.keepRecentMessages,
        });

        compacted = result.compacted;
        params.session.history.push(assistantMessage);
        params.session.context = result.messages;

        return {
          context: {
            messages: result.messages,
          },
        };
      },
    },
  })) {
    params.deps.streamToClient?.(event);
  }

  return { session: params.session, compacted };
}
