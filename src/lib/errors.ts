// Typed errors. Every main.ts catches these and calls core.setFailed(err.message)
// so consumers see a single actionable line, never a raw stack trace (unless
// ACTIONS_STEP_DEBUG is set, in which case the logger emits the stack at debug).

export class MobileBoostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restore prototype chain (TS target ES2022 + extending built-in Error).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A required input was missing, empty, or malformed (e.g. bad JSON, bad enum). */
export class InvalidInputError extends MobileBoostError {}

/** The MobileBoost API returned a non-2xx response. */
export class ApiError extends MobileBoostError {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, message: string, body = '') {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** A request or the overall sync-mode wait exceeded its time budget. */
export class TimeoutError extends MobileBoostError {}
