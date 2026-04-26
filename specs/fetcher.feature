Feature: Polite undici fetcher
  In order to crawl 999.md without ever earning a block
  As the crawler
  I want every request to carry a realistic browser identity, sit behind a
  rate limit, retry transient server errors, and trip the circuit breaker
  on the statuses that signal "stop now"

  Background:
    Given a Fetcher with base delay 8000ms, jitter ±2000ms, retry backoffs [10, 30, 90]ms
    And a Firefox-on-Linux User-Agent
    And Accept-Language "ro-RO,ru-RU;q=0.9,en;q=0.8"
    And an injected Circuit and an injected sleep function (so tests run fast)

  Scenario: A 200 OK is returned to the caller and counts as a success
    Given the upstream replies 200 with "<html>...</html>"
    When fetchPage(url) is called
    Then the result is { url, status: 200, body: "<html>...</html>" }
    And the circuit was told the request succeeded

  Scenario: A 404 is returned to the caller (delisted listings are normal)
    Given the upstream replies 404
    When fetchPage(url) is called
    Then the result has status 404
    And no retry was attempted

  Scenario: 5xx is retried with exponential backoff and then succeeds
    Given the upstream replies 503, 502, then 200
    When fetchPage(url) is called
    Then sleep was called with [10, 30] before the successful attempt
    And the result has status 200

  Scenario: 5xx retried until the budget is exhausted, then throws
    Given the upstream replies 500 four times in a row
    When fetchPage(url) is called
    Then it throws a 5xx-after-retries error
    And sleep was called with [10, 30, 90]

  Scenario: A 403 trips the circuit and aborts the sweep
    Given the upstream replies 403
    When fetchPage(url) is called
    Then it throws a CircuitTrippingError(403)
    And the circuit recorded one failure

  Scenario: A 429 trips the circuit and aborts the sweep
    Given the upstream replies 429
    When fetchPage(url) is called
    Then it throws a CircuitTrippingError(429)
    And the circuit recorded one failure

  Scenario: Every request carries the polite headers
    Given the upstream captures request headers
    When fetchPage(url) is called
    Then the request had User-Agent set to the configured Firefox UA
    And Accept-Language set to "ro-RO,ru-RU;q=0.9,en;q=0.8"
    And Accept set to "text/html,application/xhtml+xml"

  Scenario: The first request in a session is not delayed
    When fetchPage(urlA) is called
    Then sleep was not called for inter-request delay

  Scenario: Subsequent requests respect the inter-request delay
    Given the previous request happened just now
    When fetchPage(urlB) is called
    Then sleep was called with a value near 8000ms (within the jitter window)

  Scenario: A network error is retried then bubbles
    Given the upstream throws a network error 4 times in a row
    When fetchPage(url) is called
    Then sleep was called with [10, 30, 90]
    And the error bubbles to the caller
