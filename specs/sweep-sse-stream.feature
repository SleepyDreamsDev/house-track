Feature: Sweep SSE stream integration

  As an operator monitoring a live sweep
  I want the `/api/sweeps/:id/stream` endpoint to deliver pino log events
  So that the SweepDetail page can display live progress without polling

  Scenario: GET /api/sweeps/:id/stream returns 404 for non-existent sweep
    Given a sweep with id 99999 does not exist
    When I connect to GET /api/sweeps/99999/stream
    Then the response status is 404
    And the response does not open an SSE stream

  Scenario: GET /api/sweeps/:id/stream returns 200 and SSE content-type for active sweep
    Given a sweep has started and is in progress
    When I connect to GET /api/sweeps/{id}/stream
    Then the response status is 200
    And the content-type header is "text/event-stream"
    And the connection remains open

  Scenario: SSE stream delivers pino log events as data: lines
    Given a sweep is running and emitting pino logs
    When I subscribe to GET /api/sweeps/{id}/stream
    Then I receive SSE data: events within 5 seconds
    And each event is a JSON object with { sweepId, t, lvl, msg, meta }
    And events are emitted for sweep-related messages (e.g., page fetch start)

  Scenario: SSE stream closes cleanly when client disconnects
    Given a sweep is running with an active SSE subscription
    When I close the client connection
    Then the server unsubscribes from the event emitter
    And no further events are sent to the closed connection

  Scenario: multiple clients can subscribe to the same sweep
    Given a sweep is running
    When client-1 connects to GET /api/sweeps/{id}/stream
    And client-2 connects to GET /api/sweeps/{id}/stream
    Then both clients receive events independently
    And closing client-1 does not affect client-2's subscription
