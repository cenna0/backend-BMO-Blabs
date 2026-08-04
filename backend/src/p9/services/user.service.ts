import type { SafeUser } from "../types.js";

export interface PublicUserRecord {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
  passwordCredential?: unknown;
  identities?: unknown;
}

export function publicUser(user: PublicUserRecord): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(private readonly repositories: { user: { findUnique: Function } }) {}

  async getById(userId: string): Promise<SafeUser | null> {
    const user = await this.repositories.user.findUnique({ where: { id: userId } });
    return user ? publicUser(user) : null;
  }
}
