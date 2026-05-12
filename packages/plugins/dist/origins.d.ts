export type ToolOrigin = {
  codebase: 'codex' | 'opencode' | 'pi'
  files: readonly string[]
  behavior: string
}
export type ToolOriginEntry = {
  tool: string
  origins: readonly ToolOrigin[]
}
export declare const TOOL_ORIGINS: readonly [
  {
    readonly tool: 'question'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/question.ts',
          'packages/opencode/src/tool/question.txt'
        ]
        readonly behavior: 'Ask user blocking questions and return formatted answers to model.'
      },
      {
        readonly codebase: 'codex'
        readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
        readonly behavior: 'Expose user input request tool only in collaboration modes that allow it.'
      }
    ]
  },
  {
    readonly tool: 'plan'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly ['packages/opencode/src/tool/plan.ts']
        readonly behavior: 'Track plan mode and current task progress as explicit tool state.'
      }
    ]
  },
  {
    readonly tool: 'todowrite'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/todo.ts',
          'packages/opencode/src/session/todo.ts'
        ]
        readonly behavior: 'Replace ordered session todo list and expose todo metadata.'
      }
    ]
  },
  {
    readonly tool: 'read_file'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/read.ts',
          'packages/opencode/src/tool/read.txt'
        ]
        readonly behavior: 'Read file or directory with rooted path checks, truncation, and suggestions.'
      },
      {
        readonly codebase: 'pi'
        readonly files: readonly [
          'packages/coding-agent/src/core/tools/read.ts'
        ]
        readonly behavior: 'Read text and image files, compact known resource reads, and truncate output.'
      }
    ]
  },
  {
    readonly tool: 'write_file'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/write.ts',
          'packages/opencode/src/tool/write.txt'
        ]
        readonly behavior: 'Write file with permission checks, metadata, and watcher events.'
      },
      {
        readonly codebase: 'pi'
        readonly files: readonly [
          'packages/coding-agent/src/core/tools/write.ts'
        ]
        readonly behavior: 'Write file through mutation queue and caller-controlled filesystem operations.'
      }
    ]
  },
  {
    readonly tool: 'edit_file'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/edit.ts',
          'packages/opencode/src/tool/edit.txt'
        ]
        readonly behavior: 'Perform exact replacements, preserve line endings/BOM, emit diff and diagnostics.'
      },
      {
        readonly codebase: 'pi'
        readonly files: readonly [
          'packages/coding-agent/src/core/tools/edit.ts',
          'packages/coding-agent/src/core/tools/edit-diff.ts',
          'packages/coding-agent/src/core/tools/file-mutation-queue.ts'
        ]
        readonly behavior: 'Apply multiple targeted replacements against original content and serialize per-file mutations.'
      }
    ]
  },
  {
    readonly tool: 'list_files'
    readonly origins: readonly [
      {
        readonly codebase: 'pi'
        readonly files: readonly ['packages/coding-agent/src/core/tools/ls.ts']
        readonly behavior: 'List workspace paths through cwd-aware file operations.'
      },
      {
        readonly codebase: 'opencode'
        readonly files: readonly ['packages/opencode/src/tool/read.ts']
        readonly behavior: 'Directory reads return sorted entries with pagination metadata.'
      }
    ]
  },
  {
    readonly tool: 'grep_files'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/grep.ts',
          'packages/opencode/src/tool/grep.txt'
        ]
        readonly behavior: 'Search workspace files and return bounded match output.'
      },
      {
        readonly codebase: 'pi'
        readonly files: readonly [
          'packages/coding-agent/src/core/tools/grep.ts',
          'packages/coding-agent/src/core/tools/find.ts'
        ]
        readonly behavior: 'Use grep/find style search tools with cwd path resolution and truncation.'
      }
    ]
  },
  {
    readonly tool: 'shell'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/shell.rs',
          'codex-rs/core/src/tools/runtimes/shell.rs',
          'codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs',
          'codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs'
        ]
        readonly behavior: 'Run shell/unified exec with cwd, env, timeout, stdin, output truncation, and session ids.'
      },
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/bash.ts',
          'packages/opencode/src/tool/bash.txt'
        ]
        readonly behavior: 'Run bash/powershell commands with permission arity, metadata, abort, and truncation.'
      },
      {
        readonly codebase: 'pi'
        readonly files: readonly [
          'packages/coding-agent/src/core/tools/bash.ts'
        ]
        readonly behavior: 'Run local commands with abort signal and output rendering constraints.'
      }
    ]
  },
  {
    readonly tool: 'apply_patch'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/apply_patch.rs',
          'codex-rs/core/src/tools/runtimes/apply_patch.rs',
          'codex-rs/apply-patch/src/parser.rs'
        ]
        readonly behavior: 'Parse Begin Patch grammar, validate paths, apply patch, and report changed files.'
      },
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/apply_patch.ts',
          'packages/opencode/src/tool/apply_patch.txt'
        ]
        readonly behavior: 'Expose apply patch as first-class editing tool with diff metadata.'
      }
    ]
  },
  {
    readonly tool: 'request_permissions'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/request_permissions.rs',
          'codex-rs/core/src/exec_policy.rs',
          'codex-rs/core/src/tools/sandboxing.rs'
        ]
        readonly behavior: 'Request extra filesystem/network permission and grant scoped approval.'
      },
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/permission/index.ts',
          'packages/opencode/src/permission/evaluate.ts'
        ]
        readonly behavior: 'Evaluate allow/deny/ask rules with persistent always approvals.'
      }
    ]
  },
  {
    readonly tool: 'lsp'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/lsp.ts',
          'packages/opencode/src/lsp/lsp.ts'
        ]
        readonly behavior: 'Run definition, references, hover, symbols, implementation, and call hierarchy operations.'
      }
    ]
  },
  {
    readonly tool: 'task'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly [
          'packages/opencode/src/tool/task.ts',
          'packages/opencode/src/tool/task.txt'
        ]
        readonly behavior: 'Create or resume typed child session, run selected subagent, return task_id and result.'
      }
    ]
  },
  {
    readonly tool: 'spawn_agent'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/multi_agents.rs',
          'codex-rs/core/src/tools/handlers/multi_agents/spawn.rs',
          'codex-rs/core/src/agent/control.rs'
        ]
        readonly behavior: 'Spawn managed child agent with type, fork mode, limits, and result metadata.'
      }
    ]
  },
  {
    readonly tool: 'send_input'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/multi_agents.rs'
        ]
        readonly behavior: 'Send prompt/input to existing child agent, optionally interrupting current work.'
      }
    ]
  },
  {
    readonly tool: 'wait_agent'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/multi_agents.rs'
        ]
        readonly behavior: 'Wait for child agents with timeout and return completed statuses.'
      }
    ]
  },
  {
    readonly tool: 'close_agent'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/multi_agents.rs'
        ]
        readonly behavior: 'Close child agent and release associated runtime resources.'
      }
    ]
  },
  {
    readonly tool: 'mcp__server__tool'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/session/mcp.rs',
          'codex-rs/core/src/mcp_tool_call.rs',
          'codex-rs/core/src/tools/handlers/mcp.rs',
          'codex-rs/core/src/tools/handlers/mcp_resource.rs'
        ]
        readonly behavior: 'Expose discovered MCP tools/resources with namespacing, approval, and result sanitization.'
      }
    ]
  },
  {
    readonly tool: 'mcp_read_resource'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly [
          'codex-rs/core/src/tools/handlers/mcp_resource.rs'
        ]
        readonly behavior: 'Read MCP resource by URI.'
      }
    ]
  },
  {
    readonly tool: 'get_goal'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
        readonly behavior: 'Expose goal tools when Goals feature is enabled.'
      }
    ]
  },
  {
    readonly tool: 'create_goal'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
        readonly behavior: 'Create tracked long-running objective with optional token budget.'
      }
    ]
  },
  {
    readonly tool: 'complete_goal'
    readonly origins: readonly [
      {
        readonly codebase: 'codex'
        readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
        readonly behavior: 'Mark tracked objective complete.'
      }
    ]
  },
  {
    readonly tool: 'revert_session'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly ['packages/opencode/src/session/revert.ts']
        readonly behavior: 'Restore snapshot and remove message/part range after selected message.'
      }
    ]
  },
  {
    readonly tool: 'unrevert_session'
    readonly origins: readonly [
      {
        readonly codebase: 'opencode'
        readonly files: readonly ['packages/opencode/src/session/revert.ts']
        readonly behavior: 'Restore pre-revert snapshot and clear revert marker.'
      }
    ]
  }
]
export declare function originForTool(tool: string):
  | {
      readonly tool: 'question'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/question.ts',
            'packages/opencode/src/tool/question.txt'
          ]
          readonly behavior: 'Ask user blocking questions and return formatted answers to model.'
        },
        {
          readonly codebase: 'codex'
          readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
          readonly behavior: 'Expose user input request tool only in collaboration modes that allow it.'
        }
      ]
    }
  | {
      readonly tool: 'plan'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly ['packages/opencode/src/tool/plan.ts']
          readonly behavior: 'Track plan mode and current task progress as explicit tool state.'
        }
      ]
    }
  | {
      readonly tool: 'todowrite'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/todo.ts',
            'packages/opencode/src/session/todo.ts'
          ]
          readonly behavior: 'Replace ordered session todo list and expose todo metadata.'
        }
      ]
    }
  | {
      readonly tool: 'read_file'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/read.ts',
            'packages/opencode/src/tool/read.txt'
          ]
          readonly behavior: 'Read file or directory with rooted path checks, truncation, and suggestions.'
        },
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/read.ts'
          ]
          readonly behavior: 'Read text and image files, compact known resource reads, and truncate output.'
        }
      ]
    }
  | {
      readonly tool: 'write_file'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/write.ts',
            'packages/opencode/src/tool/write.txt'
          ]
          readonly behavior: 'Write file with permission checks, metadata, and watcher events.'
        },
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/write.ts'
          ]
          readonly behavior: 'Write file through mutation queue and caller-controlled filesystem operations.'
        }
      ]
    }
  | {
      readonly tool: 'edit_file'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/edit.ts',
            'packages/opencode/src/tool/edit.txt'
          ]
          readonly behavior: 'Perform exact replacements, preserve line endings/BOM, emit diff and diagnostics.'
        },
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/edit.ts',
            'packages/coding-agent/src/core/tools/edit-diff.ts',
            'packages/coding-agent/src/core/tools/file-mutation-queue.ts'
          ]
          readonly behavior: 'Apply multiple targeted replacements against original content and serialize per-file mutations.'
        }
      ]
    }
  | {
      readonly tool: 'list_files'
      readonly origins: readonly [
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/ls.ts'
          ]
          readonly behavior: 'List workspace paths through cwd-aware file operations.'
        },
        {
          readonly codebase: 'opencode'
          readonly files: readonly ['packages/opencode/src/tool/read.ts']
          readonly behavior: 'Directory reads return sorted entries with pagination metadata.'
        }
      ]
    }
  | {
      readonly tool: 'grep_files'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/grep.ts',
            'packages/opencode/src/tool/grep.txt'
          ]
          readonly behavior: 'Search workspace files and return bounded match output.'
        },
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/grep.ts',
            'packages/coding-agent/src/core/tools/find.ts'
          ]
          readonly behavior: 'Use grep/find style search tools with cwd path resolution and truncation.'
        }
      ]
    }
  | {
      readonly tool: 'shell'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/shell.rs',
            'codex-rs/core/src/tools/runtimes/shell.rs',
            'codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs',
            'codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs'
          ]
          readonly behavior: 'Run shell/unified exec with cwd, env, timeout, stdin, output truncation, and session ids.'
        },
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/bash.ts',
            'packages/opencode/src/tool/bash.txt'
          ]
          readonly behavior: 'Run bash/powershell commands with permission arity, metadata, abort, and truncation.'
        },
        {
          readonly codebase: 'pi'
          readonly files: readonly [
            'packages/coding-agent/src/core/tools/bash.ts'
          ]
          readonly behavior: 'Run local commands with abort signal and output rendering constraints.'
        }
      ]
    }
  | {
      readonly tool: 'apply_patch'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/apply_patch.rs',
            'codex-rs/core/src/tools/runtimes/apply_patch.rs',
            'codex-rs/apply-patch/src/parser.rs'
          ]
          readonly behavior: 'Parse Begin Patch grammar, validate paths, apply patch, and report changed files.'
        },
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/apply_patch.ts',
            'packages/opencode/src/tool/apply_patch.txt'
          ]
          readonly behavior: 'Expose apply patch as first-class editing tool with diff metadata.'
        }
      ]
    }
  | {
      readonly tool: 'request_permissions'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/request_permissions.rs',
            'codex-rs/core/src/exec_policy.rs',
            'codex-rs/core/src/tools/sandboxing.rs'
          ]
          readonly behavior: 'Request extra filesystem/network permission and grant scoped approval.'
        },
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/permission/index.ts',
            'packages/opencode/src/permission/evaluate.ts'
          ]
          readonly behavior: 'Evaluate allow/deny/ask rules with persistent always approvals.'
        }
      ]
    }
  | {
      readonly tool: 'lsp'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/lsp.ts',
            'packages/opencode/src/lsp/lsp.ts'
          ]
          readonly behavior: 'Run definition, references, hover, symbols, implementation, and call hierarchy operations.'
        }
      ]
    }
  | {
      readonly tool: 'task'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly [
            'packages/opencode/src/tool/task.ts',
            'packages/opencode/src/tool/task.txt'
          ]
          readonly behavior: 'Create or resume typed child session, run selected subagent, return task_id and result.'
        }
      ]
    }
  | {
      readonly tool: 'spawn_agent'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/multi_agents.rs',
            'codex-rs/core/src/tools/handlers/multi_agents/spawn.rs',
            'codex-rs/core/src/agent/control.rs'
          ]
          readonly behavior: 'Spawn managed child agent with type, fork mode, limits, and result metadata.'
        }
      ]
    }
  | {
      readonly tool: 'send_input'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/multi_agents.rs'
          ]
          readonly behavior: 'Send prompt/input to existing child agent, optionally interrupting current work.'
        }
      ]
    }
  | {
      readonly tool: 'wait_agent'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/multi_agents.rs'
          ]
          readonly behavior: 'Wait for child agents with timeout and return completed statuses.'
        }
      ]
    }
  | {
      readonly tool: 'close_agent'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/multi_agents.rs'
          ]
          readonly behavior: 'Close child agent and release associated runtime resources.'
        }
      ]
    }
  | {
      readonly tool: 'mcp__server__tool'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/session/mcp.rs',
            'codex-rs/core/src/mcp_tool_call.rs',
            'codex-rs/core/src/tools/handlers/mcp.rs',
            'codex-rs/core/src/tools/handlers/mcp_resource.rs'
          ]
          readonly behavior: 'Expose discovered MCP tools/resources with namespacing, approval, and result sanitization.'
        }
      ]
    }
  | {
      readonly tool: 'mcp_read_resource'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly [
            'codex-rs/core/src/tools/handlers/mcp_resource.rs'
          ]
          readonly behavior: 'Read MCP resource by URI.'
        }
      ]
    }
  | {
      readonly tool: 'get_goal'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
          readonly behavior: 'Expose goal tools when Goals feature is enabled.'
        }
      ]
    }
  | {
      readonly tool: 'create_goal'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
          readonly behavior: 'Create tracked long-running objective with optional token budget.'
        }
      ]
    }
  | {
      readonly tool: 'complete_goal'
      readonly origins: readonly [
        {
          readonly codebase: 'codex'
          readonly files: readonly ['codex-rs/tools/src/tool_config.rs']
          readonly behavior: 'Mark tracked objective complete.'
        }
      ]
    }
  | {
      readonly tool: 'revert_session'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly ['packages/opencode/src/session/revert.ts']
          readonly behavior: 'Restore snapshot and remove message/part range after selected message.'
        }
      ]
    }
  | {
      readonly tool: 'unrevert_session'
      readonly origins: readonly [
        {
          readonly codebase: 'opencode'
          readonly files: readonly ['packages/opencode/src/session/revert.ts']
          readonly behavior: 'Restore pre-revert snapshot and clear revert marker.'
        }
      ]
    }
  | undefined
