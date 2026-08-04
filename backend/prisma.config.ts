import "dotenv/config";
import { defineConfig } from "prisma/config";

// Client generation does not need a live database. Migration commands still
// require DATABASE_URL from the operator-controlled environment and will fail
// safely against this loopback default when it is omitted.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://bmo@127.0.0.1:5432/bmo";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
