import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { pipelines, pipelineStages, type Pipeline } from "@/db/schema";

const DEFAULT_STAGES: { name: string; color: string; kind: "open" | "won" | "lost" }[] = [
  { name: "New", color: "gray", kind: "open" },
  { name: "Qualified", color: "blue", kind: "open" },
  { name: "Proposal", color: "purple", kind: "open" },
  { name: "Negotiation", color: "orange", kind: "open" },
  { name: "Won", color: "green", kind: "won" },
  { name: "Lost", color: "red", kind: "lost" },
];

/** Returns all pipelines; creates a default "Sales" pipeline when none exist. */
export async function ensureDefaultPipeline(): Promise<Pipeline[]> {
  const rows = await db.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.createdAt));
  if (rows.length) return rows;
  const id = crypto.randomUUID();
  await db.insert(pipelines).values({ id, name: "Sales", position: 0 });
  await db.insert(pipelineStages).values(
    DEFAULT_STAGES.map((s, i) => ({ id: crypto.randomUUID(), pipelineId: id, name: s.name, color: s.color, kind: s.kind, position: i })),
  );
  return db.select().from(pipelines).orderBy(asc(pipelines.position));
}

export async function getStages(pipelineId: string) {
  return db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId)).orderBy(asc(pipelineStages.position));
}

/** All stages across pipelines (for selects), ordered. */
export async function getAllStages() {
  return db.select().from(pipelineStages).orderBy(asc(pipelineStages.pipelineId), asc(pipelineStages.position));
}
