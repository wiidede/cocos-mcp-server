import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import os from 'node:os'
import process from 'node:process'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPort(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('port' in value)) {
    return undefined
  }
  return typeof value.port === 'number' ? value.port : undefined
}

export class ServerTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'query_server_ip_list',
        description: 'Query server IP list',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_sorted_server_ip_list',
        description: 'Get sorted server IP list',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_server_port',
        description: 'Query editor server current port',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_server_status',
        description: 'Get comprehensive server status information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'check_server_connectivity',
        description: 'Check server connectivity and network status',
        inputSchema: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 5000,
            },
          },
        },
      },
      {
        name: 'get_network_interfaces',
        description: 'Get available network interfaces',
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
      case 'query_server_ip_list':
        return await this.queryServerIPList()
      case 'query_sorted_server_ip_list':
        return await this.querySortedServerIPList()
      case 'query_server_port':
        return await this.queryServerPort()
      case 'get_server_status':
        return await this.getServerStatus()
      case 'check_server_connectivity':
        return args.timeout === undefined || typeof args.timeout === 'number'
          ? this.checkServerConnectivity(args.timeout)
          : toolFailure('check_server_connectivity timeout must be a number when provided')
      case 'get_network_interfaces':
        return await this.getNetworkInterfaces()
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async queryServerIPList(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('server', 'query-ip-list').then((ipList: string[]) => {
        resolve({
          success: true,
          data: {
            ipList,
            count: ipList.length,
            message: 'IP list retrieved successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySortedServerIPList(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('server', 'query-sort-ip-list').then((sortedIPList: string[]) => {
        resolve({
          success: true,
          data: {
            sortedIPList,
            count: sortedIPList.length,
            message: 'Sorted IP list retrieved successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryServerPort(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('server', 'query-port').then((port: number) => {
        resolve({
          success: true,
          data: {
            port,
            message: `Editor server is running on port ${port}`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getServerStatus(): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // Gather comprehensive server information
        const [ipListResult, portResult] = await Promise.allSettled([
          this.queryServerIPList(),
          this.queryServerPort(),
        ])

        const status: Record<string, unknown> = {
          timestamp: new Date().toISOString(),
          serverRunning: true,
        }

        if (ipListResult.status === 'fulfilled' && ipListResult.value.success) {
          status.availableIPs = ipListResult.value.data.ipList
          status.ipCount = ipListResult.value.data.count
        }
        else {
          status.availableIPs = []
          status.ipCount = 0
          status.ipError = ipListResult.status === 'rejected' ? ipListResult.reason : ipListResult.value.error
        }

        if (portResult.status === 'fulfilled' && portResult.value.success) {
          status.port = portResult.value.data.port
        }
        else {
          status.port = null
          status.portError = portResult.status === 'rejected' ? portResult.reason : portResult.value.error
        }

        // Add additional server info
        const mcpSettings: unknown = await Editor.Message.request('cocos-mcp-server', 'get-server-settings').catch(() => ({ port: 3000 }))
        status.mcpServerPort = getPort(mcpSettings) ?? 3000
        const editorWithVersions = Editor as unknown as { versions?: { cocos?: string } }
        status.editorVersion = editorWithVersions.versions?.cocos || 'Unknown'
        status.platform = process.platform
        status.nodeVersion = process.version

        resolve({
          success: true,
          data: status,
        })
      }
      catch (error: unknown) {
        resolve({
          success: false,
          error: `Failed to get server status: ${getErrorMessage(error)}`,
        })
      }
    })
  }

  private async checkServerConnectivity(timeout: number = 5000): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      const startTime = Date.now()

      try {
        // Test basic Editor API connectivity
        const testPromise = Editor.Message.request('server', 'query-port')
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), timeout)
        })

        await Promise.race([testPromise, timeoutPromise])

        const responseTime = Date.now() - startTime

        resolve({
          success: true,
          data: {
            connected: true,
            responseTime,
            timeout,
            message: `Server connectivity confirmed in ${responseTime}ms`,
          },
        })
      }
      catch (error: unknown) {
        const responseTime = Date.now() - startTime

        resolve({
          success: false,
          data: {
            connected: false,
            responseTime,
            timeout,
            error: getErrorMessage(error),
          },
        })
      }
    })
  }

  private async getNetworkInterfaces(): Promise<ToolResponse> {
    return new Promise(async (resolve) => {
      try {
        // Get network interfaces using Node.js os module
        const interfaces = os.networkInterfaces()

        const networkInfo = Object.entries(interfaces).map(([name, addresses]) => ({
          name,
          addresses: (addresses ?? []).map(addr => ({
            address: addr.address,
            family: addr.family,
            internal: addr.internal,
            cidr: addr.cidr,
          })),
        }))

        // Also try to get server IPs for comparison
        const serverIPResult = await this.queryServerIPList()

        resolve({
          success: true,
          data: {
            networkInterfaces: networkInfo,
            serverAvailableIPs: serverIPResult.success ? serverIPResult.data.ipList : [],
            message: 'Network interfaces retrieved successfully',
          },
        })
      }
      catch (error: unknown) {
        resolve({
          success: false,
          error: `Failed to get network interfaces: ${getErrorMessage(error)}`,
        })
      }
    })
  }
}
