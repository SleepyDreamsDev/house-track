# Agent System

Specialist agents carry domain expertise, tool restrictions, and pinned models.
They are dispatched by the `/feature` skill during RED+GREEN phases and for review.

## How It Works

1. **Presets provide agent definitions** — each preset can include agent `.md` files
   in its `agents/` directory. The `setup.sh` script copies them to `.claude/agents/`.

2. **The reviewer agent is templated** — `reviewer.md.template` in core is filled
   with preset-specific test commands and security checks by `setup.sh`.

3. **Agents are optional** — if a preset has `HAS_AGENTS: false`, the `/feature` skill
   falls back to inline execution (no agent dispatch).

## Agent Roles

| Role | Purpose | Model |
|---|---|---|
| **Implementation agent(s)** | Write tests and code (RED+GREEN phases) | Sonnet |
| **Reviewer** | Read-only security + quality validation | Opus |

## Creating Custom Agents

Create a `.md` file with YAML frontmatter:

```markdown
---
name: my-agent
description: >
  What this agent specializes in.
model: sonnet
---

You are a senior engineer working on [scope].

## Your Scope
- directories this agent works in

## Off-Limits (NEVER modify)
- directories this agent must not touch

## Conventions
- coding standards specific to this agent's domain

## Test Commands
- how to run tests in this agent's scope

## Workflow
1. Read the task assignment
2. Write failing tests (RED)
3. Implement until passing (GREEN)
4. Report completion via SendMessage
```
