export type P9ErrorCode =
  | "INVALID_INPUT"
  | "AUTHENTICATION_FAILED"
  | "INVITATION_INVALID"
  | "SESSION_REVOKED"
  | "OWNERSHIP_DENIED"
  | "PAIRING_INVALID"
  | "RATE_LIMITED"
  | "DATABASE_UNAVAILABLE"
  | "CONFLICT";

export class P9Error extends Error {
  readonly code: P9ErrorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: P9ErrorCode, status: number, publicMessage: string) {
    super(publicMessage);
    this.name = "P9Error";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function isP9Error(error: unknown): error is P9Error {
  return error instanceof P9Error;
}
