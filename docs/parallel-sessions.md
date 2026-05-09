# Parallel Claude Code sessions — worktree pattern

> Why this exists: running multiple Claude Code sessions concurrently in the
> same checkout caused cross-session WIP destruction (one session's
> `reset --hard` wiped another session's working tree). This doc captures
> the pattern that prevents it.

## TL;DR

```bash
# Start a new session in an isolated worktree:
./scripts/session-new.sh feature-name

# When done:
./scripts/session-end.sh feature-name
```

Each session gets its own filesystem path. Sessions share the `.git/objects`
database (so commits, branches, refs are visible across worktrees), but the
working tree, index, and `HEAD` are independent. A reset, checkout, or stash
in one worktree cannot touch another worktree's files.

## Why git worktree solves the parallel-session problem

A single git repo has one `.git/` directory but can have **many working
trees** pointing at it. Each worktree:
- Has its own `HEAD` and index — no shared state for current branch
- Has its own filesystem files — no cross-session WIP collisions
- Shares `.git/objects/` — commits made in one are immediately visible in others
- Shares the global config and reflog

The only limitation: two worktrees can't have the same branch checked out
simultaneously. (Use a unique branch per session, or worktree-add `main` as
read-only with `--detach`.)

## Conventions

### Directory layout

```
~/Dev/house-track/
├── house-track/                  # main checkout (current sessions)
├── house-track.session-feat-foo/ # worktree for feature/foo session
├── house-track.session-fix-bar/  # worktree for fix/bar session
└── house-track-rules-hooks/      # framework-experiment sibling (already exists)
```

Naming: `house-track.session-<short-slug>` makes worktrees visually grouped
in `ls`, easy to identify, and impossible to confuse with the main checkout.

### One branch per session

Each session must use a unique branch name. The helper script enforces this.

### Cleanup on done

Don't let stale worktrees accumulate. The helper script's `session-end`
removes the worktree directory and (optionally) deletes the branch if it's
been merged.

## Commands cheatsheet

```bash
# List all worktrees
git worktree list

# Create a new worktree on a new branch from main
git worktree add ../house-track.session-foo -b feature/foo main

# Remove a worktree (after work is done and branch is merged or pushed)
git worktree remove ../house-track.session-foo

# Recover from a worktree dir that was deleted manually (orphan ref)
git worktree prune
```

## What NOT to do

- **Don't** `git worktree add ../checkout main` (without `-b new-branch`).
  This checks out main in two places, and only one worktree can have main
  checked out — the second will be detached HEAD or fail.
- **Don't** delete a worktree directory without `git worktree remove`. Use
  `git worktree prune` if you do.
- **Don't** share branches across active worktrees.

## Recovery recipe (if WIP is destroyed despite this)

See `~/.claude/projects/-Users-egorg-Dev-house-track/memory/feedback_no_hard_reset.md`
for the full `git fsck --lost-found` workflow. It works because git stashes
implicit autostash content as dangling commits, recoverable until garbage collection.
