import type { P9Repositories } from "../db/repositories.js";

export interface MemoryContextGateway {
  search(userId: string, query: string, limit: number): Promise<readonly string[]>;
}

export class PostgresMemoryGateway implements MemoryContextGateway {
  constructor(private readonly repositories: Pick<P9Repositories, "searchActiveMemories"> & Partial<Pick<P9Repositories, "listTopActiveMemories">>) {}

  async search(userId: string, query: string, limit: number): Promise<readonly string[]> {
    const maxLimit = Math.max(1, Math.min(limit, 8));
    const trimmed = query.normalize("NFKC").trim();
    const terms = trimmed ? [...new Set(trimmed.split(/\s+/u).filter((term) => term.length >= 2).slice(0, 8))] : [];

    let results: string[] = [];
    if (terms.length > 0) {
      const rows = await this.repositories.searchActiveMemories({
        userId, terms, limit: maxLimit,
      });
      results = rows.map((content) => content.slice(0, 1_000));
    }

    if (results.length < maxLimit && typeof this.repositories.listTopActiveMemories === "function") {
      const remaining = maxLimit - results.length;
      const topRows = await this.repositories.listTopActiveMemories({
        userId,
        limit: remaining,
        excludeContents: [...results],
      });
      for (const content of topRows) {
        results.push(content.slice(0, 1_000));
      }
    }

    return results;
  }
}
