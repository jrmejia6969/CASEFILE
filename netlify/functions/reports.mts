import type { Config } from "@netlify/functions";
import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { reports } from "../../db/schema.js";

export default async (req: Request) => {
  if (req.method === "GET") {
    const rows = await db.select().from(reports).orderBy(desc(reports.createdAt));
    return Response.json(rows);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const hash = typeof body.hash === "string" ? body.hash.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (!hash || !name || !platform) {
      return Response.json({ error: "hash, name, and platform are required" }, { status: 400 });
    }

    const [row] = await db.insert(reports).values({ hash, name, platform, note }).returning();
    return Response.json(row, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/reports",
};
