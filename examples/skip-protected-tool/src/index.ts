import { tool, jsonSchema, type ModelMessage, type ToolSet } from "ai";
import { type JsonLike, runAgent, type AgentStreamEvent, type AgentModelProviders, type AgentHooks, type AgentRunStatus } from "@nanoagent/kernel";

export type ChatMessage = {
  [key: string]: JsonLike;
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
};

export type Context = {
  [key: string]: JsonLike;
  messages: ChatMessage[];
};

export type SkipProtectedDeps = {
  modelProviders?: AgentModelProviders;
  streamToClient?: (event: AgentStreamEvent) => void;
};

export const tools = {
  deleteFile: tool({
    description: "Delete a file at the provided path.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    }),
    execute: async ({ path }) => {
      if (isProtectedPath({ path })) {
        throw new Error(`deleteFile executor should not run for protected path: ${path}`);
      }
      return { deleted: path };
    },
  }),
} satisfies ToolSet;

function isProtectedPath(input: unknown) {
  if (typeof input !== "object" || input === null) return false;
  const path = (input as { path?: unknown }).path;
  return (
    typeof path === "string" &&
    (path.startsWith("/private/") ||
      path.startsWith("/etc/") ||
      path.includes(".."))
  );
}

function makeHooks(): AgentHooks<Context> {
  return {
    onTurnPrepared: ({ context, state }) => ({
      value: {
        model: "openai/gpt-5.4-mini",
        messages: context.messages as unknown as ModelMessage[],
        toolChoice:
          state.turns.length === 0
            ? { type: "tool", toolName: "deleteFile" }
            : "auto",
      },
    }),

    onToolCallStarted: ({ toolCallId, toolName, input }) => {
      if (toolName === "deleteFile" && isProtectedPath(input)) {
        return {
          value: {
            type: "skip",
            result: {
              toolCallId,
              toolName,
              input,
              output: { blocked: true, reason: "protected_path" },
            },
          },
        };
      }
    },

    onTurnCompleted: ({ context, turn }) => {
      if (!turn.modelResult) return;
      
      const newMessages = [...turn.modelResult.response.messages] as unknown as ChatMessage[];

      if (turn.toolCalls.completed.length > 0) {
        newMessages.push({
          role: "tool",
          content: turn.toolCalls.completed.map((toolCall) => ({
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: (toolCall.output ?? toolCall.error) as any,
          })),
        });
      }

      return {
        context: {
          ...context,
          messages: [...context.messages, ...newMessages],
        },
      };
    },
  };
}

export async function runSkipProtected(params: {
  deps: SkipProtectedDeps;
  runId: string;
  context: Context;
}) {
  let finalContext = params.context;
  let finalStatus: AgentRunStatus | undefined;

  for await (const event of runAgent<Context>({
    state: { runId: params.runId, context: params.context },
    tools,
    modelProviders: params.deps.modelProviders,
    hooks: makeHooks(),
    maxTurns: 3,
    saveState: async ({ state }) => {
      finalContext = state.context;
      finalStatus = state.status;
    },
  })) {
    params.deps.streamToClient?.(event);
  }

  return { context: finalContext, status: finalStatus };
}
