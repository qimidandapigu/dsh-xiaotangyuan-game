import { describe, expect, it } from 'vitest'
import { failure, parseRpcRequest, success } from '../src/protocol.js'

describe('JSON-RPC protocol', () => {
  it('parses a valid request', () => {
    expect(parseRpcRequest('{"jsonrpc":"2.0","id":1,"method":"gateway.ping"}')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'gateway.ping',
    })
  })

  it('rejects an invalid version', () => {
    expect(() => parseRpcRequest('{"jsonrpc":"1.0","method":"gateway.ping"}')).toThrow('jsonrpc')
  })

  it('builds success and failure responses', () => {
    expect(success('a', { ok: true })).toEqual({ jsonrpc: '2.0', id: 'a', result: { ok: true } })
    expect(failure('a', -1, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 'a',
      error: { code: -1, message: 'nope' },
    })
  })
})
