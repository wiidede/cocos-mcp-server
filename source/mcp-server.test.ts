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

async function handle(message: unknown): Promise<unknown> {
  const server = new MCPServer(settings)
  const handler = server as unknown as {
    handleMessage: (request: unknown) => Promise<unknown>
    setupTools: () => void
  }
  handler.setupTools()
  return handler.handleMessage(message)
}

describe('mcp protocol handler', () => {
  it('negotiates initialization and advertises the supported protocol', async () => {
    await expect(handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })).resolves.toMatchObject({
      id: 1,
      result: { protocolVersion: '2024-11-05' },
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
        name: 'scene_management',
        arguments: { action: 'not_supported' },
      },
    })).resolves.toMatchObject({
      id: 2,
      result: { isError: true },
    })
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

    await expect(server.executeToolCall('asset_manage', {
      action: 'create_default_spriteframe',
    })).rejects.toThrow('Tool asset_manage is not enabled')

    await expect(server.executeDevTestToolCall('asset_manage', {
      action: 'create_default_spriteframe',
    })).resolves.toEqual({ success: true })
    expect(execute).toHaveBeenCalledWith('asset_manage', {
      action: 'create_default_spriteframe',
    })
  })
})
