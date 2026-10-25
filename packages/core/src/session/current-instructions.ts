export * as SessionCurrentInstructions from "./current-instructions.js"

import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBlobTable, InstructionStateTable } from "./sql.js"
import type { SessionSchema } from "./schema.js"

type DatabaseService = Database.Interface["db"]

/**
 * Renders the currently folded instruction state as one baseline.
 * Sliding context can then omit chronological instruction-update messages without
 * reverting the model to an older instruction epoch.
 */
export const render = Effect.fn("SessionCurrentInstructions.render")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
) {
  const state = yield* db
    .select()
    .from(InstructionStateTable)
    .where(eq(InstructionStateTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!state) return yield* Effect.die(new Error(`Instruction state not found during assembly: ${sessionID}`))

  const hashes = [...new Set(Object.values(state.current_values))]
  const batches = Array.from({ length: Math.ceil(hashes.length / 500) }, (_, index) =>
    hashes.slice(index * 500, (index + 1) * 500),
  )
  const rows = (
    yield* Effect.forEach(
      batches,
      (batch) =>
        db.select().from(InstructionBlobTable).where(inArray(InstructionBlobTable.hash, batch)).all().pipe(Effect.orDie),
      { concurrency: 4 },
    )
  ).flat()
  const blobs = new Map(rows.map((row) => [row.hash, row.value]))
  const values = Object.fromEntries(
    Object.entries(state.current_values).map(([key, hash]) => {
      const value = blobs.get(hash)
      if (value === undefined) throw new Error(`Instruction blob not found: ${hash}`)
      return [key, value]
    }),
  )
  return Instructions.renderInitial(instructions, values)
})
