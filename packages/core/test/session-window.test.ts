import { expect, test } from "bun:test"
import { Message } from "@opencode/ai/effect"
import { SessionWindow } from "@opencode/core/session/window"

const request = (messages: Message[]) => ({ system: [], messages, tools: {} })
const limit = { input: 100, context: 100 }

test("keeps the newest whole exchange when older history exceeds the budget", () => {
  const messages = [
    Message.user("o".repeat(400)),
    Message.assistant("old answer"),
    Message.user("latest question"),
    Message.assistant("latest answer"),
  ]

  const projected = SessionWindow.project(request(messages), limit)

  expect(projected.messages).toEqual(messages.slice(2))
  expect(projected.dropped).toBe(2)
})

test("keeps tool calls and results with their user exchange", () => {
  const messages = [
    Message.user("o".repeat(400)),
    Message.assistant("old answer"),
    Message.user("use the tool"),
    Message.assistant([{ type: "tool-call", id: "call_1", name: "lookup", input: { id: 1 } }]),
    Message.tool({ id: "call_1", name: "lookup", result: "done" }),
    Message.assistant("finished"),
  ]

  const projected = SessionWindow.project(request(messages), limit)

  expect(projected.messages).toEqual(messages.slice(2))
  expect(projected.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("never drops the newest exchange even when it alone exceeds the target", () => {
  const messages = [Message.user("x".repeat(800)), Message.assistant("answer")]

  const projected = SessionWindow.project(request(messages), limit)

  expect(projected.messages).toEqual(messages)
  expect(projected.dropped).toBe(0)
  expect(projected.estimated).toBeGreaterThan(projected.budget)
})
