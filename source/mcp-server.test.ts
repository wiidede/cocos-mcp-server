import type { ToolResponse } from './types'
import { describe, expect, it, vi } from 'vitest'
import { MCPServer } from './mcp-server'

const settings = {
  port: 0,
  autoStart: false,
  enableDebugLog: false,
  allowedOrigins: ['*'],
  maxConnections: 10,
}

async function handle(message: unknown, era: 'legacy' | 'modern' = 'legacy'): Promise<unknown> {
  const server = new MCPServer(settings)
  const handler = server as unknown as {
    handleMessage: (request: unknown, era?: 'legacy' | 'modern') => Promise<unknown>
    setupTools: () => void
  }
  handler.setupTools()
  return handler.handleMessage(message, era)
}

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

describe('mcp protocol handler', () => {
  it.each(['2025-03-26', '2025-06-18', '2025-11-25'] as const)('negotiates supported legacy protocol %s', async (protocolVersion) => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion },
    })).resolves.toMatchObject({
      id: 1,
      result: { protocolVersion },
    })
  })

  it('rejects the old HTTP+SSE protocol during initialization', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })).resolves.toMatchObject({
      id: 2,
      error: {
        code: -32022,
        data: {
          requested: '2024-11-05',
          supported: ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'],
        },
      },
    })
  })

  it('accepts initialized notifications without a JSON-RPC response', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })).resolves.toBeNull()
  })

  it('marks failed tool calls as MCP errors', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'scene_lifecycle',
        arguments: { action: 'not_supported' },
      },
    })).resolves.toMatchObject({
      id: 2,
      result: { isError: true },
    })
  })

  it('discovers modern capabilities without an initialize handshake', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 'discover-1',
      method: 'server/discover',
      params: { _meta: modernMeta },
    }, 'modern')).resolves.toMatchObject({
      id: 'discover-1',
      result: {
        resultType: 'complete',
        ttlMs: 0,
        cacheScope: 'public',
        supportedVersions: ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'],
        capabilities: { tools: {} },
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'cocos-mcp-server',
            version: '2.0.0',
          },
        },
      },
    })
  })

  it('returns cache hints for the modern tools list', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 'tools-list-1',
      method: 'tools/list',
      params: { _meta: modernMeta },
    }, 'modern')).resolves.toMatchObject({
      id: 'tools-list-1',
      result: {
        resultType: 'complete',
        ttlMs: 0,
        cacheScope: 'public',
        tools: expect.any(Array),
      },
    })
  })

  it('rejects unsupported modern versions with the protocol-defined error', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {
        _meta: {
          ...modernMeta,
          'io.modelcontextprotocol/protocolVersion': '2099-01-01',
        },
      },
    }, 'modern')).resolves.toMatchObject({
      id: 3,
      error: {
        code: -32022,
        data: {
          requested: '2099-01-01',
          supported: ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'],
        },
      },
    })
  })

  it('requires modern request metadata on every request', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
      params: {
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      },
    }, 'modern')).resolves.toMatchObject({
      id: 4,
      error: { code: -32602, message: expect.stringContaining('clientCapabilities') },
    })
  })

  it('returns structured and text content for modern tool results', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        _meta: modernMeta,
        name: 'scene_lifecycle',
        arguments: { action: 'not_supported' },
      },
    }, 'modern')).resolves.toMatchObject({
      id: 5,
      result: {
        resultType: 'complete',
        isError: true,
        content: [{ type: 'text', text: expect.any(String) }],
        structuredContent: {
          success: false,
          errorCode: 'TOOL_CONTRACT_ERROR',
        },
      },
    })
  })

  it('does not add cache hints to modern tool call results', async () => {
    const response = await handle({
      jsonrpc: '2.0',
      id: 'tool-call-cache-1',
      method: 'tools/call',
      params: {
        _meta: modernMeta,
        name: 'scene_lifecycle',
        arguments: { action: 'not_supported' },
      },
    }, 'modern') as { result: Record<string, unknown> }

    expect(response.result).not.toHaveProperty('ttlMs')
    expect(response.result).not.toHaveProperty('cacheScope')
  })

  it('creates and reuses a legacy Streamable HTTP session', async () => {
    const server = new MCPServer(settings)
    await server.start()
    const internal = server as unknown as { httpServer: { address: () => { port: number } } }
    const port = internal.httpServer.address().port
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    }

    try {
      const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'legacy-init',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25' },
        }),
      })
      expect(initialize.status).toBe(200)
      const sessionId = initialize.headers.get('mcp-session-id')
      expect(sessionId).toEqual(expect.any(String))

      const initialized = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { ...headers, 'Mcp-Session-Id': sessionId! },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      })
      expect(initialized.status).toBe(202)

      const stream = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: { 'accept': 'text/event-stream', 'Mcp-Session-Id': sessionId! },
      })
      expect(stream.status).toBe(200)
      expect(stream.headers.get('content-type')).toContain('text/event-stream')
      await stream.body?.cancel()

      const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { ...headers, 'Mcp-Session-Id': sessionId! },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'legacy-tools', method: 'tools/list' }),
      })
      expect(tools.status).toBe(200)
      await expect(tools.json()).resolves.toMatchObject({ result: { tools: expect.any(Array) } })

      const deleted = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId! },
      })
      expect(deleted.status).toBe(204)
    }
    finally {
      server.stop()
    }
  })

  it('rejects legacy requests without an initialized session', async () => {
    const server = new MCPServer(settings)
    await server.start()
    const internal = server as unknown as { httpServer: { address: () => { port: number } } }
    const port = internal.httpServer.address().port

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' }),
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: { code: -32000 } })
    }
    finally {
      server.stop()
    }
  })

  it('validates modern HTTP routing headers and status codes', async () => {
    const server = new MCPServer(settings)
    await server.start()
    const internal = server as unknown as { httpServer: { address: () => { port: number } } }
    const port = internal.httpServer.address().port
    const body = {
      jsonrpc: '2.0',
      id: 6,
      method: 'server/discover',
      params: { _meta: modernMeta },
    }

    try {
      const valid = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'server/discover',
        },
        body: JSON.stringify(body),
      })
      expect(valid.status).toBe(200)
      await expect(valid.json()).resolves.toMatchObject({ result: { resultType: 'complete' } })

      const mismatch = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify(body),
      })
      expect(mismatch.status).toBe(400)
      await expect(mismatch.json()).resolves.toMatchObject({ error: { code: -32020 } })

      const unknown = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'unknown/method',
        },
        body: JSON.stringify({ ...body, id: 7, method: 'unknown/method' }),
      })
      expect(unknown.status).toBe(404)
      await expect(unknown.json()).resolves.toMatchObject({ error: { code: -32601 } })

      const unsupportedBody = {
        ...body,
        id: 8,
        params: {
          _meta: {
            ...modernMeta,
            'io.modelcontextprotocol/protocolVersion': '2099-01-01',
          },
        },
      }
      const unsupported = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2099-01-01',
          'Mcp-Method': 'server/discover',
        },
        body: JSON.stringify(unsupportedBody),
      })
      expect(unsupported.status).toBe(400)
      await expect(unsupported.json()).resolves.toMatchObject({
        error: { code: -32022, data: { requested: '2099-01-01' } },
      })

      const missingName = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
        },
        body: JSON.stringify({
          ...body,
          id: 9,
          method: 'tools/call',
          params: {
            _meta: modernMeta,
            name: 'scene_lifecycle',
            arguments: { action: 'get_current' },
          },
        }),
      })
      expect(missingName.status).toBe(400)
      await expect(missingName.json()).resolves.toMatchObject({ error: { code: -32020 } })
    }
    finally {
      server.stop()
    }
  })

  it('rejects disallowed HTTP origins before processing MCP messages', async () => {
    const server = new MCPServer({ ...settings, allowedOrigins: ['http://allowed.example'] })
    await server.start()
    const internal = server as unknown as { httpServer: { address: () => { port: number } } }
    const port = internal.httpServer.address().port

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://blocked.example',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }),
      })
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: { message: expect.stringContaining('Origin') } })
    }
    finally {
      server.stop()
    }
  })

  it('keeps disabled tools blocked for MCP calls but available to dev tests', async () => {
    const server = new MCPServer(settings)
    server.updateEnabledTools([{
      category: 'scene',
      name: 'management',
      enabled: true,
      description: 'scene management',
    }])

    const execute = vi.fn<(name: string, args: unknown) => Promise<ToolResponse>>()
      .mockResolvedValue({ success: true })
    const internal = server as unknown as {
      unifiedTools: { execute: typeof execute }
    }
    internal.unifiedTools.execute = execute

    await expect(server.executeToolCall('asset_lifecycle', {
      action: 'create_default_spriteframe',
    })).rejects.toThrow('Tool asset_lifecycle is not enabled')

    await expect(server.executeDevTestToolCall('asset_lifecycle', {
      action: 'create_default_spriteframe',
    })).resolves.toEqual({ success: true })
    expect(execute).toHaveBeenCalledWith('asset_lifecycle', {
      action: 'create_default_spriteframe',
    })
  })
})
