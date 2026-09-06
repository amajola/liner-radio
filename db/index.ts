import { drizzle } from "drizzle-orm/d1";

export function getDb(database: D1Database) {
  return drizzle(database);
}
