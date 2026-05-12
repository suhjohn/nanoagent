export const TOOL_ORIGINS = [
  {
    tool: 'question',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/question.ts',
          'packages/opencode/src/tool/question.txt'
        ],
        behavior:
          'Ask user blocking questions and return formatted answers to model.'
      },
      {
        codebase: 'codex',
        files: ['codex-rs/tools/src/tool_config.rs'],
        behavior:
          'Expose user input request tool only in collaboration modes that allow it.'
      }
    ]
  },
  {
    tool: 'plan',
    origins: [
      {
        codebase: 'opencode',
        files: ['packages/opencode/src/tool/plan.ts'],
        behavior:
          'Track plan mode and current task progress as explicit tool state.'
      }
    ]
  },
  {
    tool: 'todowrite',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/todo.ts',
          'packages/opencode/src/session/todo.ts'
        ],
        behavior: 'Replace ordered session todo list and expose todo metadata.'
      }
    ]
  },
  {
    tool: 'read_file',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/read.ts',
          'packages/opencode/src/tool/read.txt'
        ],
        behavior:
          'Read file or directory with rooted path checks, truncation, and suggestions.'
      },
      {
        codebase: 'pi',
        files: ['packages/coding-agent/src/core/tools/read.ts'],
        behavior:
          'Read text and image files, compact known resource reads, and truncate output.'
      }
    ]
  },
  {
    tool: 'write_file',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/write.ts',
          'packages/opencode/src/tool/write.txt'
        ],
        behavior:
          'Write file with permission checks, metadata, and watcher events.'
      },
      {
        codebase: 'pi',
        files: ['packages/coding-agent/src/core/tools/write.ts'],
        behavior:
          'Write file through mutation queue and caller-controlled filesystem operations.'
      }
    ]
  },
  {
    tool: 'edit_file',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/edit.ts',
          'packages/opencode/src/tool/edit.txt'
        ],
        behavior:
          'Perform exact replacements, preserve line endings/BOM, emit diff and diagnostics.'
      },
      {
        codebase: 'pi',
        files: [
          'packages/coding-agent/src/core/tools/edit.ts',
          'packages/coding-agent/src/core/tools/edit-diff.ts',
          'packages/coding-agent/src/core/tools/file-mutation-queue.ts'
        ],
        behavior:
          'Apply multiple targeted replacements against original content and serialize per-file mutations.'
      }
    ]
  },
  {
    tool: 'list_files',
    origins: [
      {
        codebase: 'pi',
        files: ['packages/coding-agent/src/core/tools/ls.ts'],
        behavior: 'List workspace paths through cwd-aware file operations.'
      },
      {
        codebase: 'opencode',
        files: ['packages/opencode/src/tool/read.ts'],
        behavior:
          'Directory reads return sorted entries with pagination metadata.'
      }
    ]
  },
  {
    tool: 'grep_files',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/grep.ts',
          'packages/opencode/src/tool/grep.txt'
        ],
        behavior: 'Search workspace files and return bounded match output.'
      },
      {
        codebase: 'pi',
        files: [
          'packages/coding-agent/src/core/tools/grep.ts',
          'packages/coding-agent/src/core/tools/find.ts'
        ],
        behavior:
          'Use grep/find style search tools with cwd path resolution and truncation.'
      }
    ]
  },
  {
    tool: 'shell',
    origins: [
      {
        codebase: 'codex',
        files: [
          'codex-rs/core/src/tools/handlers/shell.rs',
          'codex-rs/core/src/tools/runtimes/shell.rs',
          'codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs',
          'codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs'
        ],
        behavior:
          'Run shell/unified exec with cwd, env, timeout, stdin, output truncation, and session ids.'
      },
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/bash.ts',
          'packages/opencode/src/tool/bash.txt'
        ],
        behavior:
          'Run bash/powershell commands with permission arity, metadata, abort, and truncation.'
      },
      {
        codebase: 'pi',
        files: ['packages/coding-agent/src/core/tools/bash.ts'],
        behavior:
          'Run local commands with abort signal and output rendering constraints.'
      }
    ]
  },
  {
    tool: 'apply_patch',
    origins: [
      {
        codebase: 'codex',
        files: [
          'codex-rs/core/src/tools/handlers/apply_patch.rs',
          'codex-rs/core/src/tools/runtimes/apply_patch.rs',
          'codex-rs/apply-patch/src/parser.rs'
        ],
        behavior:
          'Parse Begin Patch grammar, validate paths, apply patch, and report changed files.'
      },
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/apply_patch.ts',
          'packages/opencode/src/tool/apply_patch.txt'
        ],
        behavior:
          'Expose apply patch as first-class editing tool with diff metadata.'
      }
    ]
  },
  {
    tool: 'request_permissions',
    origins: [
      {
        codebase: 'codex',
        files: [
          'codex-rs/core/src/tools/handlers/request_permissions.rs',
          'codex-rs/core/src/exec_policy.rs',
          'codex-rs/core/src/tools/sandboxing.rs'
        ],
        behavior:
          'Request extra filesystem/network permission and grant scoped approval.'
      },
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/permission/index.ts',
          'packages/opencode/src/permission/evaluate.ts'
        ],
        behavior:
          'Evaluate allow/deny/ask rules with persistent always approvals.'
      }
    ]
  },
  {
    tool: 'lsp',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/lsp.ts',
          'packages/opencode/src/lsp/lsp.ts'
        ],
        behavior:
          'Run definition, references, hover, symbols, implementation, and call hierarchy operations.'
      }
    ]
  },
  {
    tool: 'task',
    origins: [
      {
        codebase: 'opencode',
        files: [
          'packages/opencode/src/tool/task.ts',
          'packages/opencode/src/tool/task.txt'
        ],
        behavior:
          'Create or resume typed child session, run selected subagent, return task_id and result.'
      }
    ]
  },
  {
    tool: 'spawn_agent',
    origins: [
      {
        codebase: 'codex',
        files: [
          'codex-rs/core/src/tools/handlers/multi_agents.rs',
          'codex-rs/core/src/tools/handlers/multi_agents/spawn.rs',
          'codex-rs/core/src/agent/control.rs'
        ],
        behavior:
          'Spawn managed child agent with type, fork mode, limits, and result metadata.'
      }
    ]
  },
  {
    tool: 'send_input',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/core/src/tools/handlers/multi_agents.rs'],
        behavior:
          'Send prompt/input to existing child agent, optionally interrupting current work.'
      }
    ]
  },
  {
    tool: 'wait_agent',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/core/src/tools/handlers/multi_agents.rs'],
        behavior:
          'Wait for child agents with timeout and return completed statuses.'
      }
    ]
  },
  {
    tool: 'close_agent',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/core/src/tools/handlers/multi_agents.rs'],
        behavior: 'Close child agent and release associated runtime resources.'
      }
    ]
  },
  {
    tool: 'mcp__server__tool',
    origins: [
      {
        codebase: 'codex',
        files: [
          'codex-rs/core/src/session/mcp.rs',
          'codex-rs/core/src/mcp_tool_call.rs',
          'codex-rs/core/src/tools/handlers/mcp.rs',
          'codex-rs/core/src/tools/handlers/mcp_resource.rs'
        ],
        behavior:
          'Expose discovered MCP tools/resources with namespacing, approval, and result sanitization.'
      }
    ]
  },
  {
    tool: 'mcp_read_resource',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/core/src/tools/handlers/mcp_resource.rs'],
        behavior: 'Read MCP resource by URI.'
      }
    ]
  },
  {
    tool: 'get_goal',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/tools/src/tool_config.rs'],
        behavior: 'Expose goal tools when Goals feature is enabled.'
      }
    ]
  },
  {
    tool: 'create_goal',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/tools/src/tool_config.rs'],
        behavior:
          'Create tracked long-running objective with optional token budget.'
      }
    ]
  },
  {
    tool: 'complete_goal',
    origins: [
      {
        codebase: 'codex',
        files: ['codex-rs/tools/src/tool_config.rs'],
        behavior: 'Mark tracked objective complete.'
      }
    ]
  },
  {
    tool: 'revert_session',
    origins: [
      {
        codebase: 'opencode',
        files: ['packages/opencode/src/session/revert.ts'],
        behavior:
          'Restore snapshot and remove message/part range after selected message.'
      }
    ]
  },
  {
    tool: 'unrevert_session',
    origins: [
      {
        codebase: 'opencode',
        files: ['packages/opencode/src/session/revert.ts'],
        behavior: 'Restore pre-revert snapshot and clear revert marker.'
      }
    ]
  }
]
export function originForTool(tool) {
  return TOOL_ORIGINS.find(entry => entry.tool === tool)
}
