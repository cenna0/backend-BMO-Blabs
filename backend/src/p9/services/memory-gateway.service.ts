import type { P9Repositories } from "../db/repositories.js";

export interface MemoryContextGateway {
  search(userId: string, query: string, limit: number): Promise<readonly string[]>;
}

export class PostgresMemoryGateway implements MemoryContextGateway {
  constructor(private readonly repositories: Pick<P9Repositories, "searchActiveMemories">) {}

  async search(userId: string, query: string, limit: number): Promise<readonly string[]> {
    const terms = [...new Set(query.normalize("NFKC").trim().split(/\s+/u).filter((term) => term.length >= 2).slice(0, 8))];
    if (terms.length === 0) return [];
    const rows = await this.repositories.searchActiveMemories({
      userId, terms, limit: Math.max(1, Math.min(limit, 8)),
    });
    return rows.map((content) => content.slice(0, 1_000));
  }
}
