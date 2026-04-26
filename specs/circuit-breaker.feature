Feature: Circuit breaker
  In order to avoid hammering 999.md after repeated critical failures
  As the crawler
  I want to trip a circuit after N consecutive critical failures
  And resume only when the cooldown window elapses or a human clears it

  Background:
    Given a circuit configured with threshold 3 and cooldown 24 hours
    And a sentinel path on a temp directory

  Scenario: A fresh circuit is closed
    Given no sentinel file exists
    When isOpen() is checked
    Then it returns false

  Scenario: Hitting the threshold trips the circuit
    When recordFailure() is called 3 times
    Then the sentinel file is created
    And isOpen() returns true

  Scenario: A success between failures resets the counter
    When recordFailure() is called 2 times
    And recordSuccess() is called
    And recordFailure() is called 2 times
    Then the sentinel file does NOT exist
    And isOpen() returns false

  Scenario: A sentinel within the cooldown window keeps the circuit open
    Given a sentinel file with mtime 1 hour ago
    When isOpen() is checked
    Then it returns true

  Scenario: A sentinel older than the cooldown closes the circuit
    Given a sentinel file with mtime 25 hours ago
    When isOpen() is checked
    Then it returns false

  Scenario: Deleting the sentinel manually closes the circuit
    Given a tripped circuit
    When the sentinel file is deleted
    Then isOpen() returns false

  Scenario: recordFailure does not throw if the sentinel directory is missing
    Given a sentinel path under a directory that does not exist
    When recordFailure() is called 3 times
    Then the directory is created and the sentinel file exists
