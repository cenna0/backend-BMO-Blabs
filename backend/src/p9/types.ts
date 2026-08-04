export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
}

export interface SafeUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export interface SafeDevice {
  id: string;
  hardwareId: string;
  name: string;
  status: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
}
