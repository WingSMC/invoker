export type ToolErrorCode =
  | "NOT_REGISTERED"
  | "PAUSED"
  | "INVALID_JSON"
  | "INVALID_ARGUMENTS"
  | "HANDLER_FAILED"
  | "SERIALIZATION_FAILED"
  | "INCOMPLETE_CALL"
  | "ARGUMENT_LIMIT"
  | "CALL_LIMIT"
  | "CANCELLED";

/** Expected failures stay in Effect's error channel and never escape the middleware. */
export class ToolError extends Error {
  readonly _tag = "ToolError";

  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function failureContent(error: ToolError): string {
  return JSON.stringify({ error: { code: error.code, message: error.message } });
}
