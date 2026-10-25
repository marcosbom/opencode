export * as SessionWindow from "./window.js"

import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Token } from "../util/token.js"

const RESERVE_MIN = 16_000
const RESERVE_SHARE = 0.15
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000

type Request = Pick<SessionHooks["context"], "system" | "messages" | "tools">
type Message = Request["messages"][number]
type Part = Message["content"][number]
type Limit = { readonly input: number; readonly context: number }

export type Projection = {
  readonly messages: Message[]
  readonly estimated: number
  readonly dropped: number
  readonly budget: number
}

/**
 * Projects the newest whole user exchanges into the model's input budget.
 * Storage is untouched: this only chooses which already-recorded messages are sent.
 */
export const project = (request: Request, limit: Limit): Projection => {
  const fixed = estimateFixed(request)
  const ceiling = calculateCeiling(limit)
  if (!Number.isFinite(ceiling)) {
    const estimated = fixed + request.messages.reduce((sum, message) => sum + estimateMessage(message), 0)
    return { messages: request.messages, estimated, dropped: 0, budget: Number.POSITIVE_INFINITY }
  }

  const budget = Math.max(0, ceiling - fixed)
  const exchanges = groupExchanges(request.messages)
  const selected = exchanges.reduceRight(
    (state, exchange) => {
      if (state.closed) return state
      const tokens = exchange.reduce((sum, message) => sum + estimateMessage(message), 0)
      if (state.exchanges.length > 0 && state.tokens + tokens > budget) return { ...state, closed: true }
      return {
        exchanges: [exchange, ...state.exchanges],
        tokens: state.tokens + tokens,
        closed: false,
      }
    },
    { exchanges: [] as Message[][], tokens: 0, closed: false },
  )
  const messages = selected.exchanges.flat()
  return {
    messages,
    estimated: fixed + selected.tokens,
    dropped: request.messages.length - messages.length,
    budget,
  }
}

const groupExchanges = (messages: readonly Message[]) =>
  messages.reduce<Message[][]>((groups, message) => {
    if (message.role === "user" || groups.length === 0) {
      groups.push([message])
      return groups
    }
    groups.at(-1)!.push(message)
    return groups
  }, [])

const calculateCeiling = (limit: Limit) => {
  const window = limit.input || limit.context
  if (window <= 0) return Number.POSITIVE_INFINITY
  return window - Math.max(Math.floor(window * RESERVE_SHARE), window >= 2 * RESERVE_MIN ? RESERVE_MIN : 0)
}

const estimateFixed = (request: Request) =>
  request.system.reduce((sum, part) => sum + Token.estimate(part.text), 0) +
  Object.entries(request.tools).reduce(
    (sum, [name, tool]) => sum + Token.estimate(name + tool.description + JSON.stringify(tool.input)),
    0,
  )

const estimateMessage = (message: Message) => message.content.reduce((sum, part) => sum + estimatePart(part), 0)

const estimatePart = (part: Part): number => {
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "effort") return 0
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.media.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))
  if (part.type !== "tool-result") return 0

  if (part.result.type === "content")
    return part.result.value.reduce(
      (sum, content) => sum + (content.type === "text" ? Token.estimate(content.text) : estimateMedia(content.mime)),
      0,
    )
  const value = part.result.value
  return Token.estimate(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return IMAGE_TOKEN_ESTIMATE
  if (type === "application/pdf") return PDF_TOKEN_ESTIMATE
  return 0
}
