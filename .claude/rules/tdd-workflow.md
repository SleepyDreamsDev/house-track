# TDD Workflow Rules

> Framework-generic. Reusable in claude-tdd-starter.
> Project-specific test commands are in CLAUDE.md.

---

## The Rules

- **Never write implementation and tests in the same step.** RED and GREEN are separate passes.
- **RED:** Write failing tests only. Do not create the implementation file yet.
- **GREEN:** Write the simplest code that makes all tests pass. Do not refactor yet.
- **REFACTOR:** Improve code without changing behavior. If any test fails during REFACTOR, revert that change immediately and try a different approach.
- **After GREEN, always REFACTOR before shipping.** Never ship first-pass implementation.
- **Never modify files in `*/generated/*` or `*/__generated__/*`.**

## Testing Trophy Priority

Most valuable to least valuable:

1. **Integration tests** — component behavior with real dependencies, data flows through lib functions
2. **Unit tests** — pure functions, validators, calculations
3. **Edge cases** — boundary values, empty states, error conditions
4. **E2E tests** — critical user journeys only (optional, expensive)

## Test Structure

Each Gherkin `Scenario:` maps to one `it()` block. Use AAA pattern:

```ts
describe("Feature", () => {
  it("Scenario description from Gherkin", () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Coverage Target

70%+ on business logic (lib functions, server actions, validators).
UI components: test behavior, not implementation details.

## Gherkin Specs

- Live in `specs/*.feature` — one file per feature/PR
- Created by `/feature` skill in PHASE 1.5 (SPECIFY) before any tests are written
- Not executable — documentation only, no cucumber dependency
- Each `Scenario:` maps directly to one `it()` block

## Test File Location

| Domain                 | Source            | Test file                                |
| ---------------------- | ----------------- | ---------------------------------------- |
| Page / route           | `src/app/`        | `src/app/**/__tests__/*.test.tsx`        |
| Component              | `src/components/` | `src/components/**/__tests__/*.test.tsx` |
| Server action / router | `src/server/`     | `src/server/**/__tests__/*.test.ts`      |
| Utility / lib          | `src/lib/`        | `src/lib/**/__tests__/*.test.ts`         |
| Hook                   | `src/hooks/`      | `src/hooks/__tests__/*.test.ts`          |

## Escape Hatches

If stuck on the same test failure 3+ times:

1. Re-read the error output carefully — what exactly is failing?
2. Check if the test has a genuine bug (wrong expectation) before changing the implementation
3. Only ask for help if still stuck after a focused investigation
