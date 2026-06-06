# Skill System

A **Skill** in Novara OS is a structured bundle of instructions, helper scripts, and tool specifications that extends the agent's capability for a specialized domain.

## Structure of a Skill

Skills are located under a workspace or global skill directory:

```
.novara/skills/my-custom-skill/
├── SKILL.md          # Description, capabilities, system instructions, and examples
├── scripts/          # Helper scripts executable by the runtime (Python, Bash, Node)
└── manifest.yaml     # Metadata defining when this skill should be active and its permissions
```

## Activation Rules

*   **Explicit**: The user commands the agent to use a specific skill (e.g. `novara chat --skill deploy-k8s`).
*   **Implicit (Conditional)**: The agent dynamically imports the skill if the user request matches the patterns or workspace conditions defined in `manifest.yaml` (e.g. if the directory contains a `docker-compose.yml` file, import the Docker skill).

## Self-Evolution & Auto-Generation

Novara OS can learn and document new skills dynamically during user conversations:

*   **`record_skill` Native Tool**: If the user explains a custom workflow or procedural steps (e.g., how to deploy their specific frontend stack), the agent can dynamically call the `record_skill` tool.
*   **Result**: This creates a new folder under `.novara/skills/` with a pre-configured `manifest.yaml` and a populated `SKILL.md` matching the instructions provided by the user. These skills are subsequently parsed and injected into the agent's context in future sessions.

