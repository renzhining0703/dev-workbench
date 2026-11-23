import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AgentCancelledError,
  AgentReplyValidationError,
  hasToolOutputFailureClaim,
  observeTurnActivity,
  phaseFromActivity,
  runAgentTurn,
  summarizeToolResults,
  unsupportedToolOutputClaim,
} from '../lib/agent-client.mjs'

const textOnly = { text: 30, image: 0, other: 0, total: 30, textSamples: ['11 月上线 3 条'] }

/** 构造一条 OpenClaw 会话日志消息 */
function toolResultLine(content) {
  return JSON.stringify({ message: { role: 'toolResult', content } })
}

test('工具结果统计：当前 text 结构、旧版嵌套结构和图片块分别计数', () => {
  const jsonl = [
    toolResultLine([{ type: 'text', text: 'hi' }, { type: 'text', text: '测试中文' }]),
    JSON.stringify({ type: 'toolResult', toolResult: { content: [{ type: 'image', data: 'x' }] } }),
    '{half-line',
  ].join('\n')
  assert.deepEqual(summarizeToolResults(jsonl), { text: 2, image: 1, other: 0, total: 3 })
  assert.deepEqual(summarizeToolResults(jsonl, true).textSamples, ['hi', '测试中文'])
})

test('误述识别：命中本轮真实回复中的图片/通道故障断言', () => {
  const reply = '工具输出的读取通道坏了：exec、read 返回的结果全变成图片，模型侧拿到的是 “(see attached image)”。'
  assert.equal(hasToolOutputFailureClaim(reply), true)
  assert.equal(unsupportedToolOutputClaim(reply, textOnly), true)
  assert.equal(unsupportedToolOutputClaim(reply, { text: 1, image: 1, other: 0, total: 2 }), false)
  assert.equal(hasToolOutputFailureClaim('已读取文本：11 月上线 3 条需求。'), false)
  assert.equal(hasToolOutputFailureClaim('拿不到可读的结果正文，读不到具体数值。'), true)
  assert.equal(hasToolOutputFailureClaim('更正：此前把文本结果误述为图片。'), false)
})

test('回复校验：文本结果被误述为图片时自动发起一次无工具纠错', async () => {
  const calls = []
  const turnRunner = async (args) => {
    calls.push(args)
    if (calls.length === 1) return { reply: '工具输出只返回图片，读取通道故障。', toolResults: textOnly }
    return { reply: '11 月 1 日至今：根据文本统计结果回答。', toolResults: { text: 0, image: 0, other: 0, total: 0 } }
  }
  const result = await runAgentTurn({
    message: '11 月做了什么',
    sessionKey: 'wb-ui-test',
    timeoutMs: 5000,
    turnRunner,
  })
  assert.equal(result.reply, '11 月 1 日至今：根据文本统计结果回答。')
  assert.equal(calls.length, 2)
  assert.match(calls[1].message, /文本 30 条、图片 0 条/)
  assert.match(calls[1].message, /不要调用任何工具/)
  assert.match(calls[1].message, /不要重复任何写操作/)
  assert.match(calls[1].message, /11 月上线 3 条/)
  assert.ok(calls[1].timeoutMs <= 5000)
})

test('回复校验：纠错后仍误述则拒绝下发，不进入第三次调用', async () => {
  let calls = 0
  const turnRunner = async () => {
    calls += 1
    if (calls === 1) return { reply: '工具输出仍然只返回图片。', toolResults: textOnly }
    return { reply: '本轮返回给我的内容没有可读正文。', toolResults: { text: 0, image: 0, other: 0, total: 0 } }
  }
  await assert.rejects(
    runAgentTurn({ message: '统计', sessionKey: 'wb-ui-test', timeoutMs: 5000, turnRunner }),
    AgentReplyValidationError,
  )
  assert.equal(calls, 2)
})

test('回复校验：正常回复或真实图片结果不触发纠错', async () => {
  let calls = 0
  const turnRunner = async () => {
    calls += 1
    return { reply: '工具结果里有图片附件。', toolResults: { text: 1, image: 1, other: 0, total: 2 } }
  }
  const result = await runAgentTurn({ message: '读取', sessionKey: 'wb-ui-test', timeoutMs: 5000, turnRunner })
  assert.equal(result.reply, '工具结果里有图片附件。')
  assert.equal(calls, 1)
})

test('活动阶段：日志增量统计工具调用，映射 waiting/tooling/composing', () => {
  const jsonl = [
    JSON.stringify({ timestamp: '2026-11-23T08:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: '统计 11 月' }] } }),
    JSON.stringify({ timestamp: '2026-11-23T08:00:01.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'exec' }] } }),
    JSON.stringify({ timestamp: '2026-11-23T08:00:03.000Z', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] } }),
    '{half-line',
  ].join('\n')
  const activity = observeTurnActivity(jsonl)
  assert.equal(activity.toolCalls, 1)
  assert.equal(activity.lastEventAt, Date.parse('2026-11-23T08:00:03.000Z'))
  const now = activity.lastEventAt
  assert.equal(phaseFromActivity({ toolCalls: 0, lastEventAt: 0 }, now), 'waiting')
  assert.equal(phaseFromActivity(activity, now + 5000), 'tooling')
  assert.equal(phaseFromActivity(activity, now + 10000), 'composing')
})

test('取消：运行中的 turn 收到 abort 信号后抛出 AgentCancelledError', async () => {
  const controller = new AbortController()
  const turnRunner = (args) => new Promise((resolve, reject) => {
    args.signal?.addEventListener('abort', () => reject(new AgentCancelledError('cancelled by user')), { once: true })
  })
  const pending = runAgentTurn({
    message: '统计',
    sessionKey: 'wb-ui-test',
    timeoutMs: 5000,
    turnRunner,
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, AgentCancelledError)
})

test('取消：已 abort 的信号在进入纠错轮前直接抛取消错误', async () => {
  const controller = new AbortController()
  controller.abort()
  const turnRunner = async () => ({ reply: '工具输出只返回图片。', toolResults: textOnly })
  await assert.rejects(
    runAgentTurn({ message: '统计', sessionKey: 'wb-ui-test', timeoutMs: 5000, turnRunner, signal: controller.signal }),
    AgentCancelledError,
  )
})
