Feature: Pino EventEmitter tee for SSE streaming
  As an operator
  I want sweep logs to stream live to the SSE endpoint
  So I can monitor running sweeps in real-time via the browser

  Scenario: Pino writes to EventEmitter when sweep is active
    Given a custom write stream is attached to pino
    And activeSweepId is set during runSweep
    When a log line is emitted
    Then sweepEvents.emitEvent is called with sweepId set to String(activeSweepId)

  Scenario: Log lines fan out to both stdout and EventEmitter
    Given pino is configured with a custom tee stream
    When a JSON log line is written
    Then the line is written to stdout verbatim
    And a SweepEvent is emitted to sweepEvents

  Scenario: Backward compatibility: non-sweep logs are ignored
    Given activeSweepId is null
    When a log line is emitted
    Then sweepEvents.emitEvent is not called
    And stdout still receives the line

  Scenario: SweepEvent includes time, level, msg, and meta
    Given a JSON log line with {time, level, event, msg, meta, ...}
    When the tee stream parses it
    Then SweepEvent has t as localeTimeString
    And lvl maps level (30→info, 40→warn, 50→error, 60→fatal)
    And msg prefers event field over msg
    And meta is JSON-stringified

  Scenario: Malformed JSON lines are skipped silently
    Given the tee stream receives a non-JSON line
    When it tries to parse
    Then the exception is caught
    And stdout still receives the raw line

  Scenario: activeSweepId lifecycle
    Given a sweep starts via runSweep
    When startSweep returns the id
    Then activeSweepId is set
    And getActiveSweepId() returns that id
    When the sweep finishes in finally block
    Then activeSweepId is cleared

  Scenario: SSE stream filters events by id coercion
    Given an active sweep with id=123 (integer)
    When the SSE route receives request param :id="123" (string)
    Then it coerces both via String(...) for comparison
    And events with sweepId="123" are streamed
    And events with other sweepIds are skipped
