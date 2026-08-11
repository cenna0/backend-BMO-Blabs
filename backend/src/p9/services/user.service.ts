import type { SafeUser } from "../types.js";

export interface PublicUserRecord {
  id: string;
  email: string;
  displayName: string | null;
  username?: string | null;
  avatarKey?: string | null;
  createdAt: Date;
  passwordCredential?: unknown;
  identities?: unknown;
}

export function publicUser(user: PublicUserRecord, publicBaseUrl = ""): SafeUser {
  const baseUrl = publicBaseUrl.replace(/\/$/, "");
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    username: user.username ?? null,
    avatarUrl: user.avatarKey ? `${baseUrl}/media/avatars/${user.avatarKey}.webp` : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(
    private readonly repositories: { user: { findUnique: Function } },
    private readonly publicBaseUrl = "",
  ) {}

  async getById(userId: string): Promise<SafeUser | null> {
    const user = await this.repositories.user.findUnique({ where: { id: userId } });
    return user ? publicUser(user, this.publicBaseUrl) : null;
  }
}
