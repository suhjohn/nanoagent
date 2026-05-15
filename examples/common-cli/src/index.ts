import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { AgentStreamEvent } from "@nanoagent/kernel";

export type CliCommand = {
  description: string;
  run(params: { args: string; cli: InteractiveCli }): Promise<void> | void;
};

export type InteractiveCli = {
  event(event: AgentStreamEvent): void;
  events(events: AsyncIterable<AgentStreamEvent>): Promise<void>;
  info(message: string): void;
  json(value: unknown): void;
};

export async function runInteractiveCli(params: {
  argv?: string[];
  commands?: Record<string, CliCommand>;
  defaultPrompt: string;
  intro: string;
  promptLabel?: string;
  run(params: { input: string; cli: InteractiveCli }): Promise<void>;
}) {
  const commands = params.commands ?? {};
  const cli = makeCli();
  const initialInput = (params.argv ?? process.argv.slice(2)).join(" ").trim();
  const readline = createInterface({ input: stdin, output: stdout });

  cli.info(params.intro);
  cli.info(
    `Type message, /help, or /exit. Press enter for: ${params.defaultPrompt}`,
  );

  const handleInput = async (rawInput: string) => {
    const input = rawInput.trim();

    if (!input) {
      await params.run({ input: params.defaultPrompt, cli });
      return true;
    }

    if (input === "/exit" || input === "/quit") return false;

    if (input === "/help") {
      printHelp(commands);
      return true;
    }

    if (input.startsWith("/")) {
      const [name, ...rest] = input.slice(1).split(" ");
      const command = name ? commands[name] : undefined;

      if (!command) {
        cli.info(`Unknown command: ${input}`);
        return true;
      }

      await command.run({ args: rest.join(" ").trim(), cli });
      return true;
    }

    await params.run({ input, cli });
    return true;
  };

  if (initialInput) {
    await params.run({ input: initialInput, cli });

    if (!stdin.isTTY) {
      readline.close();
      return;
    }
  }

  if (!stdin.isTTY) {
    let readInput = false;

    for await (const line of readline) {
      readInput = true;
      if (!(await handleInput(line))) break;
    }

    if (!initialInput && !readInput) {
      await params.run({ input: params.defaultPrompt, cli });
    }
  }

  while (stdin.isTTY) {
    const input = await readline.question(params.promptLabel ?? "> ");
    if (!(await handleInput(input))) break;
  }

  readline.close();
}

function makeCli(): InteractiveCli {
  let wroteText = false;

  return {
    event(event) {
      if (event.type === "stream_part") {
        const text = textFromPart(event.part);
        if (text) {
          stdout.write(text);
          wroteText = true;
        }
        return;
      }

      if (wroteText) {
        stdout.write("\n");
        wroteText = false;
      }

      switch (event.type) {
        case "pause":
          stdout.write(`[paused] ${event.reason ?? event.phase}\n`);
          break;
        case "run_completed":
          stdout.write(`[completed] ${event.reason ?? event.source}\n`);
          break;
        case "run_failed":
          stdout.write(`[failed] ${event.error.message}\n`);
          break;
        case "tool_call_completed":
          stdout.write(
            `[tool:${event.toolName}] ${formatJson(event.output ?? event.error)}\n`,
          );
          break;
      }
    },
    async events(events) {
      for await (const event of events) {
        this.event(event);
      }
    },
    info(message) {
      stdout.write(`${message}\n`);
    },
    json(value) {
      stdout.write(`${formatJson(value)}\n`);
    },
  };
}

function printHelp(commands: Record<string, CliCommand>) {
  stdout.write("Commands:\n");
  stdout.write("  /help   Show commands\n");
  stdout.write("  /exit   Quit\n");

  for (const [name, command] of Object.entries(commands)) {
    stdout.write(`  /${name}   ${command.description}\n`);
  }
}

function textFromPart(
  part: Extract<AgentStreamEvent, { type: "stream_part" }>["part"],
) {
  const record = part as Record<string, unknown>;

  for (const key of ["textDelta", "text", "delta"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }

  return undefined;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}
