# Agent Runtime

The Agent Runtime governs the lifecycle of task executions, managing state transitions and converting LLM responses or declarative workflows into actions within the isolated workspace.

## Execution Engines (Paradigms)

Novara OS supports multiple execution paradigms based on the task type:

1.  **ReAct (Reason + Act)**: The default loop for interactive chat, exploration, and ad-hoc troubleshooting.
2.  **Plan-and-Solve (Hierarchical)**: For multi-step complex tasks. The orchestrator drafts a structured plan first, validates it against the security policy, and then executes steps sequentially or in parallel.
3.  **State Machine (Workflow)**: For deterministic automation. Executes tasks along a predefined graph of states with conditional branching and fallback recovery, minimizing raw LLM reasoning calls.
4.  **Multi-Agent Delegation**: Allows the main runtime to spawn isolated child agents with a subset of tools and limited token budgets to parallelize research or analysis.

## Generalized Execution Loop

```
[ Input Task ]
      │
      ▼
 1. [ Engine Selection ] ──► (ReAct / Plan-and-Solve / Workflow / Multi-Agent)
      │
      ▼
 2. [ Context Assembly ] ──► (Inject System Prompt, Memory, Knowledge, Active Tools)
      │
      ▼
 3. [ Step Execution ]
      │
      ├──────────────────────────────┐
      ▼ (Action / Tool Call)         ▼ (Text Response / Target Achieved)
 4. [ Safety Policy Check ]      5. [ Session Complete ]
      │
      ▼
 6. [ Execute Tool/MCP ]
      │
      ▼
 7. [ Update Memory/State ] ──► Loop back to Step 2
```

## Safety and Approvals

*   **Read-Only Operations**: Executed automatically (e.g., listing directories, reading files, checking status).
*   **Write/Mutate Operations**: Require user verification (`[y/n]` prompt) in the CLI or through API approval.
*   **Sandbox Isolation**: Shell operations run under a constrained local environment or targeted SSH nodes.
