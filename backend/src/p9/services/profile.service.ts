import { P9Error } from "../errors.js";
import { parseProfilePatch } from "../validation.js";
import { publicUser } from "./user.service.js";

export class ProfileService {
  constructor(
    private readonly repositories: { user: { update: Function } },
    private readonly publicBaseUrl: string,
  ) {}

  async update(userId: string, input: unknown, _requestId?: string) {
    const parsed = parseProfilePatch(input);
    try {
      const user = await this.repositories.user.update({ where: { id: userId }, data: parsed });
      return publicUser(user, this.publicBaseUrl);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new P9Error("CONFLICT", 409, "Username unavailable");
      }
      throw error;
    }
  }
}
