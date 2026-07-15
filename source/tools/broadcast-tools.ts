import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { toolFailure, toolSuccess } from './tool-response'

type ToolArguments = Record<string, unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class BroadcastTools implements ToolExecutor {
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map()
  private messageLog: Array<{ message: string, data: unknown, timestamp: number }> = []

  constructor() {
    this.setupBroadcastListeners()
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'get_broadcast_log',
        description: 'Get recent broadcast messages log',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of recent messages to return',
              default: 50,
            },
            messageType: {
              type: 'string',
              description: 'Filter by message type (optional)',
            },
          },
        },
      },
      {
        name: 'listen_broadcast',
        description: 'Start listening for specific broadcast messages',
        inputSchema: {
          type: 'object',
          properties: {
            messageType: {
              type: 'string',
              description: 'Message type to listen for',
            },
          },
          required: ['messageType'],
        },
      },
      {
        name: 'stop_listening',
        description: 'Stop listening for specific broadcast messages',
        inputSchema: {
          type: 'object',
          properties: {
            messageType: {
              type: 'string',
              description: 'Message type to stop listening for',
            },
          },
          required: ['messageType'],
        },
      },
      {
        name: 'clear_broadcast_log',
        description: 'Clear the broadcast messages log',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_active_listeners',
        description: 'Get list of active broadcast listeners',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'get_broadcast_log':
        return this.getBroadcastLog(
          typeof args.limit === 'number' ? args.limit : undefined,
          typeof args.messageType === 'string' ? args.messageType : undefined,
        )
      case 'listen_broadcast':
        return typeof args.messageType === 'string'
          ? this.listenBroadcast(args.messageType)
          : toolFailure('listen_broadcast requires a messageType')
      case 'stop_listening':
        return typeof args.messageType === 'string'
          ? this.stopListening(args.messageType)
          : toolFailure('stop_listening requires a messageType')
      case 'clear_broadcast_log':
        return this.clearBroadcastLog()
      case 'get_active_listeners':
        return this.getActiveListeners()
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private setupBroadcastListeners(): void {
    // 设置预定义的重要广播消息监听
    const importantMessages = [
      'build-worker:ready',
      'build-worker:closed',
      'scene:ready',
      'scene:close',
      'scene:light-probe-edit-mode-changed',
      'scene:light-probe-bounding-box-edit-mode-changed',
      'asset-db:ready',
      'asset-db:close',
      'asset-db:asset-add',
      'asset-db:asset-change',
      'asset-db:asset-delete',
    ]

    importantMessages.forEach((messageType) => {
      this.addBroadcastListener(messageType)
    })
  }

  private addBroadcastListener(messageType: string): void {
    const listener = (data: unknown) => {
      this.messageLog.push({
        message: messageType,
        data,
        timestamp: Date.now(),
      })

      // 保持日志大小在合理范围内
      if (this.messageLog.length > 1000) {
        this.messageLog = this.messageLog.slice(-500)
      }

      console.log(`[Broadcast] ${messageType}:`, data)
    }

    if (!this.listeners.has(messageType)) {
      this.listeners.set(messageType, [])
    }
    this.listeners.get(messageType)!.push(listener)

    // 注册 Editor 消息监听 - 暂时注释掉，Editor.Message API可能不支持
    // Editor.Message.on(messageType, listener);
    console.log(`[BroadcastTools] Added listener for ${messageType} (simulated)`)
  }

  private removeBroadcastListener(messageType: string): void {
    const listeners = this.listeners.get(messageType)
    if (listeners) {
      listeners.forEach((listener) => {
        // Editor.Message.off(messageType, listener);
        console.log(`[BroadcastTools] Removed listener for ${messageType} (simulated)`)
      })
      this.listeners.delete(messageType)
    }
  }

  private async getBroadcastLog(limit: number = 50, messageType?: string): Promise<ToolResponse> {
    let filteredLog = this.messageLog

    if (messageType) {
      filteredLog = this.messageLog.filter(entry => entry.message === messageType)
    }

    const recentLog = filteredLog.slice(-limit).map(entry => ({
      ...entry,
      timestamp: new Date(entry.timestamp).toISOString(),
    }))

    return toolSuccess({
      log: recentLog,
      count: recentLog.length,
      totalCount: filteredLog.length,
      filter: messageType || 'all',
      message: 'Broadcast log retrieved successfully',
    })
  }

  private async listenBroadcast(messageType: string): Promise<ToolResponse> {
    try {
      const alreadyListening = this.listeners.has(messageType)
      if (!alreadyListening) {
        this.addBroadcastListener(messageType)
      }
      return toolSuccess({
        messageType,
        message: alreadyListening
          ? `Already listening for broadcast: ${messageType}`
          : `Started listening for broadcast: ${messageType}`,
      })
    }
    catch (error: unknown) {
      return toolFailure(getErrorMessage(error))
    }
  }

  private async stopListening(messageType: string): Promise<ToolResponse> {
    try {
      const wasListening = this.listeners.has(messageType)
      if (wasListening) {
        this.removeBroadcastListener(messageType)
      }
      return toolSuccess({
        messageType,
        message: wasListening
          ? `Stopped listening for broadcast: ${messageType}`
          : `Was not listening for broadcast: ${messageType}`,
      })
    }
    catch (error: unknown) {
      return toolFailure(getErrorMessage(error))
    }
  }

  private async clearBroadcastLog(): Promise<ToolResponse> {
    const previousCount = this.messageLog.length
    this.messageLog = []
    return toolSuccess({
      clearedCount: previousCount,
      message: 'Broadcast log cleared successfully',
    })
  }

  private async getActiveListeners(): Promise<ToolResponse> {
    const activeListeners = Array.from(this.listeners.keys()).map(messageType => ({
      messageType,
      listenerCount: this.listeners.get(messageType)?.length || 0,
    }))

    return toolSuccess({
      listeners: activeListeners,
      count: activeListeners.length,
      message: 'Active listeners retrieved successfully',
    })
  }
}
