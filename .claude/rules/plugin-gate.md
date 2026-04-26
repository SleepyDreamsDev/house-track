# Plugin Gate

> Framework-generic. Reusable across all projects.
> Customize the disabled plugins list per project.

If any of the following plugins are disabled in `.claude/settings.json` for token optimization,
check before starting a task whether a disabled plugin is needed and notify the user.

| Disabled Plugin     | Re-enable when...                                           |
| ------------------- | ----------------------------------------------------------- |
| `atlassian`         | Task involves Jira issues, Confluence pages, or sprint work |
| `sentry`            | Task involves error monitoring, Sentry alerts, or logging   |
| `greptile`          | Task requires cross-repo code search beyond this project    |
| `skill-creator`     | Creating or editing Claude Code skills                      |
| `claude-code-setup` | Reconfiguring Claude Code hooks, settings, or MCP servers   |
| `ralph-loop`        | Running a prompt on a recurring interval                    |
| `code-simplifier`   | Dedicated simplification pass requested by user             |

When a task matches a trigger above, tell the user:
"This task would benefit from the `<plugin>` plugin. Enable it with:
`/plugins` → enable `<plugin>`, then restart the session."
