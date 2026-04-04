import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseNaturalTime, parseDuration } from '../src/concierge'

describe('Concierge — parseNaturalTime', () => {
  const base = new Date('2026-04-05T10:00:00+08:00')

  it('parses "明天下午3点"', () => {
    const result = parseNaturalTime('明天下午3点', base)
    assert.ok(result)
    const d = new Date(result)
    assert.equal(d.getDate(), 6)
    assert.equal(d.getHours(), 15)
  })

  it('parses "今天上午9点"', () => {
    const result = parseNaturalTime('今天上午9点', base)
    assert.ok(result)
    const d = new Date(result)
    assert.equal(d.getDate(), 5)
    assert.equal(d.getHours(), 9)
  })

  it('parses "2小时后"', () => {
    const result = parseNaturalTime('2小时后', base)
    assert.ok(result)
    const diff = result - base.getTime()
    assert.ok(diff >= 119 * 60 * 1000)
    assert.ok(diff <= 121 * 60 * 1000)
  })

  it('parses "3天后"', () => {
    const result = parseNaturalTime('3天后', base)
    assert.ok(result)
    const d = new Date(result)
    assert.equal(d.getDate(), 8)
  })

  it('parses "后天"', () => {
    const result = parseNaturalTime('后天下午2点', base)
    assert.ok(result)
    const d = new Date(result)
    assert.equal(d.getDate(), 7)
    assert.equal(d.getHours(), 14)
  })

  it('returns null for unparseable input', () => {
    const result = parseNaturalTime('hello world', base)
    assert.equal(result, null)
  })
})

describe('Concierge — parseDuration', () => {
  it('parses "30分钟"', () => {
    assert.equal(parseDuration('30分钟'), 30)
  })

  it('parses "1小时"', () => {
    assert.equal(parseDuration('1小时'), 60)
  })

  it('parses "1.5小时"', () => {
    assert.equal(parseDuration('1.5小时'), 90)
  })

  it('parses "半小时"', () => {
    assert.equal(parseDuration('半小时'), 30)
  })

  it('parses "两小时"', () => {
    assert.equal(parseDuration('两小时'), 120)
  })

  it('defaults to 60 for unparseable', () => {
    assert.equal(parseDuration('unknown'), 60)
  })
})
