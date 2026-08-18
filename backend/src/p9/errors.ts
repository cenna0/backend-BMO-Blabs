export type P9ErrorCode =
  | "INVALID_INPUT"
  | "AUTHENTICATION_FAILED"
  | "INVITATION_INVALID"
  | "SESSION_REVOKED"
  | "OWNERSHIP_DENIED"
  | "PAIRING_INVALID"
  | "PAIRING_CODE_INVALID_OR_EXPIRED"
  | "RATE_LIMITED"
  | "DATABASE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "CONFLICT"
  | "RECONNECT_REQUIRED"
  | "NO_ACTIVE_DEVICE"
  | "PREMIUM_REQUIRED"
  | "RECOVERY_INVALID"
  | "BLOCKED_EXTERNAL_SECRET";

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
