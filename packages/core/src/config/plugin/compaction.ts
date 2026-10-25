export * as ConfigCompactionPlugin from "./compaction.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { SessionCompaction } from "../../session/compaction.js"
import { SessionModelRequest } from "../../session/model-request.js"
import { SessionWindow } from "../../session/window.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.compaction",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const models = yield* Model.Service
    const compaction = yield* SessionCompaction.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, compaction.reload())
    yield* compaction.transform((editor) => {
      // Sliding context replaces automatic compaction. Manual /compact remains available.
      editor.configure({ auto: false, precompute: false })
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.compaction) continue
        editor.configure({
          ...(entry.info.compaction.buffer === undefined ? {} : { buffer: entry.info.compaction.buffer }),
          ...(entry.info.compaction.keep?.tokens === undefined ? {} : { keep: entry.info.compaction.keep.tokens }),
        })
      }
    })
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const model = yield* models.get(event.model.providerID, event.model.id)
        if (!model) return
        const projected = SessionWindow.project(event, model.limit)
        event.messages = projected.messages
        event.options.maxTokens = SessionModelRequest.outputLimit(model.limit, {
          measured: 0,
          estimated: projected.estimated,
        })
      }),
    )
  }),
})
