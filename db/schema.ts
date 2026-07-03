import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const reports = pgTable("reports", {
  id: serial().primaryKey(),
  hash: text().notNull(),
  name: text().notNull(),
  platform: text().notNull(),
  note: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});
