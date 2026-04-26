# Plans System

Plans are markdown files that serve as detailed feature specifications.

## How It Works

1. **Create a plan** in `.claude/plans/` before running `/feature`
2. The `/feature` skill loads the most recent plan file automatically (PHASE 0)
3. The plan is the source of truth for scope, file locations, and acceptance criteria
4. When a plan exists, FAST_MODE is active — no user approval gates needed

## Backlog

`backlog.md` is the prioritized task list. The `/feature` skill auto-updates it:
- Marks completed items as `[x]` in the Done section
- Adds follow-up work discovered during implementation

## Usage

```
# In Claude Code, use plan mode to design features:
# (plan mode creates/edits files here automatically)

# Then implement:
/feature <description matching a backlog item>
```
