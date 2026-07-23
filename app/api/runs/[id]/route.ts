import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureRunTables } from "../../../../db/runtime";
import { formRuns, runEvents } from "../../../../db/schema";

const allowedActions = new Set([
  "pause",
  "resume",
  "request_review",
  "approve_live",
  "revoke_live",
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureRunTables();
    const { id } = await context.params;
    const payload = (await request.json()) as { action?: string };
    const action = payload.action ?? "";

    if (!allowedActions.has(action)) {
      return Response.json({ error: "Unsupported run action." }, { status: 400 });
    }

    const db = getDb();
    const [run] = await db.select().from(formRuns).where(eq(formRuns.id, id));
    if (!run) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof formRuns.$inferInsert> = { updatedAt: now };
    let message = "";

    if (action === "pause") {
      updates.status = "paused";
      updates.stage = "Paused by operator";
      message = "Run paused without losing the current browser checkpoint.";
    } else if (action === "resume") {
      updates.status = "running";
      updates.stage = "Resuming from verified checkpoint";
      message = "Run resumed from the last verified state.";
    } else if (action === "request_review") {
      updates.status = "awaiting_review";
      updates.stage = "Human review required";
      message = "Run sent to the review queue.";
    } else if (action === "approve_live") {
      if (run.status !== "certified" && run.status !== "awaiting_review") {
        return Response.json(
          { error: "A run must reach review or certification before live approval." },
          { status: 409 }
        );
      }
      updates.liveApproved = true;
      message = "Named live approval recorded. Submit remains gated per execution.";
    } else if (action === "revoke_live") {
      updates.liveApproved = false;
      message = "Live approval revoked.";
    }

    await db.update(formRuns).set(updates).where(eq(formRuns.id, id));
    await db.insert(runEvents).values({
      runId: id,
      kind: `operator_${action}`,
      message,
    });

    const [updated] = await db.select().from(formRuns).where(eq(formRuns.id, id));
    return Response.json({
      run: {
        ...updated,
        urls: JSON.parse(updated.urlsJson),
        ...JSON.parse(updated.graphJson),
        findings: JSON.parse(updated.findingsJson),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update run." },
      { status: 500 }
    );
  }
}
