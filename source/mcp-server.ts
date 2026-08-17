import type { MCPClient, MCPServerSettings, ServerStatus, ToolConfig, ToolDefinition, ToolResponse } from './types'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import packageMetadata from '../package.json'
import { UnifiedTools } from './tools/unified-tools'

type JsonRpcId = string | number | null
type JsonRecord = Record<string, unknown>

interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}

interface InitializeParams extends JsonRecord {
  protocolVersion: string
}

const LEGACY_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'] as const
const MODERN_PROTOCOL_VERSION = '2026-07-28'
const SUPPORTED_PROTOCOL_VERSIONS = [...LEGACY_PROTOCOL_VERSIONS, MODERN_PROTOCOL_VERSION]
const SERVER_INFO = { name: packageMetadata.name, version: packageMetadata.version } as const
const MAX_TOOL_RESULT_CHARS = 64_000
const TOOL_RESULT_EXPORT_DIRECTORY = 'temp/cocos-mcp-server/exports'

type LegacyProtocolVersion = typeof LEGACY_PROTOCOL_VERSIONS[number]
type ProtocolEra = 'legacy' | 'modern'

interface MCPHttpSession {
  id: string
  protocolVersion: LegacyProtocolVersion
  lastActivity: Date
  stream?: http.ServerResponse
}

interface SimplifiedToolDefinition {
  name: string
  category: string
  toolName: string
  description: string
  apiPath: string
  curlExample: string
}

class JsonRpcRequestError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class MCPServer {
  private settings: MCPServerSettings
  private httpServer: http.Server | null = null
  private clients: Map<string, MCPClient> = new Map()
  private sessions: Map<string, MCPHttpSession> = new Map()
  private unifiedTools!: UnifiedTools
  private toolsList: ToolDefinition[] = []
  private enabledTools: ToolConfig[] = []

  constructor(settings: MCPServerSettings) {
    this.settings = settings
    this.initializeTools()
  }

  private initializeTools(): void {
    try {
      console.log(`[MCPServer] Initializing unified ${packageMetadata.version} tools...`)
      this.unifiedTools = new UnifiedTools({
        getSettings: () => this.settings,
        getToolDefinitions: () => this.toolsList,
      })
      console.log('[MCPServer] Tools initialized successfully')
    }
    catch (error) {
      console.error('[MCPServer] Error initializing tools:', error)
      throw error
    }
  }

  public async start(): Promise<void> {
    if (this.httpServer) {
      console.log('[MCPServer] Server is already running')
      return
    }

    try {
      console.log(`[MCPServer] Starting HTTP server on port ${this.settings.port}...`)
      this.httpServer = http.createServer(this.handleHttpRequest.bind(this))
      const listenHost = '127.0.0.1'

      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(this.settings.port, listenHost, () => {
          console.log(`[MCPServer] ✅ HTTP server started successfully on http://${listenHost}:${this.settings.port}`)
          console.log(`[MCPServer] Health check: http://127.0.0.1:${this.settings.port}/health`)
          console.log(`[MCPServer] MCP endpoint: http://127.0.0.1:${this.settings.port}/mcp`)
          resolve()
        })
        this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
          console.error('[MCPServer] ❌ Failed to start server:', err)
          if (err.code === 'EADDRINUSE') {
            console.error(`[MCPServer] Port ${this.settings.port} is already in use. Please change the port in settings.`)
          }
          reject(err)
        })
      })

      this.setupTools()
      console.log('[MCPServer] 🚀 MCP Server is ready for connections')
    }
    catch (error) {
      console.error('[MCPServer] ❌ Failed to start server:', error)
      throw error
    }
  }

  private setupTools(): void {
    const allTools = this.unifiedTools.getTools()

    if (!this.enabledTools || this.enabledTools.length === 0) {
      this.toolsList = allTools
    }
    else {
      const enabledToolNames = new Set(this.enabledTools.map(tool => `${tool.category}_${tool.name}`))
      this.toolsList = allTools.filter(tool => enabledToolNames.has(tool.name))
    }

    console.log(`[MCPServer] Setup tools: ${this.toolsList.length} tools available`)
  }

  public getFilteredTools(enabledTools: ToolConfig[]): ToolDefinition[] {
    if (!enabledTools || enabledTools.length === 0) {
      return this.toolsList // 如果没有过滤配置，返回所有工具
    }

    const enabledToolNames = new Set(enabledTools.map(tool => `${tool.category}_${tool.name}`))
    return this.toolsList.filter(tool => enabledToolNames.has(tool.name))
  }

  public async executeToolCall(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!this.toolsList.some(tool => tool.name === toolName)) {
      throw new Error(`Tool ${toolName} is not enabled`)
    }
    return this.unifiedTools.execute(toolName, args)
  }

  public async executeDevTestToolCall(toolName: string, args: unknown): Promise<ToolResponse> {
    return this.unifiedTools.execute(toolName, args)
  }

  private prepareToolResult(toolName: string, toolResult: ToolResponse): { result: ToolResponse, text: string } {
    let text: string
    try {
      text = JSON.stringify(toolResult)
    }
    catch (error: unknown) {
      const result: ToolResponse = {
        success: false,
        errorCode: 'TOOL_EXECUTION_ERROR',
        error: `Tool result could not be serialized: ${getErrorMessage(error)}`,
        instruction: 'Retry with a smaller query or omit large object content from the request.',
      }
      return { result, text: JSON.stringify(result) }
    }

    if (text.length <= MAX_TOOL_RESULT_CHARS) {
      return { result: toolResult, text }
    }

    try {
      const projectPath = Editor.Project.path
      if (!projectPath) {
        throw new Error('Editor.Project.path is unavailable')
      }

      const exportDirectory = path.join(projectPath, TOOL_RESULT_EXPORT_DIRECTORY)
      const safeToolName = toolName.replace(/[^\w-]/g, '-')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `${timestamp}-${safeToolName}-${randomUUID().slice(0, 8)}.json`
      const exportPath = path.join(exportDirectory, fileName)

      fs.mkdirSync(exportDirectory, { recursive: true })
      fs.writeFileSync(exportPath, JSON.stringify(toolResult, null, 2), 'utf8')

      const result: ToolResponse = {
        success: toolResult.success,
        ...(toolResult.success
          ? {}
          : {
              errorCode: toolResult.errorCode,
              error: toolResult.error ?? 'Tool execution failed; the full response was exported.',
            }),
        message: `Tool result exceeded the ${MAX_TOOL_RESULT_CHARS}-character inline limit and was exported to a file.`,
        warning: 'The complete tool result is not included inline. Read or filter the exported JSON file instead.',
        data: {
          exported: true,
          toolName,
          format: 'json',
          resultChars: text.length,
          inlineLimitChars: MAX_TOOL_RESULT_CHARS,
          path: exportPath,
          relativePath: path.relative(projectPath, exportPath),
        },
      }
      return { result, text: JSON.stringify(result) }
    }
    catch (error: unknown) {
      const result: ToolResponse = {
        success: false,
        errorCode: 'TOOL_EXECUTION_ERROR',
        error: `Tool result exceeded the inline limit, but export failed: ${getErrorMessage(error)}`,
        instruction: 'Retry with a narrower query or verify that the project temp directory is writable.',
        data: {
          toolName,
          resultChars: text.length,
          inlineLimitChars: MAX_TOOL_RESULT_CHARS,
        },
      }
      return { result, text: JSON.stringify(result) }
    }
  }

  public getClients(): MCPClient[] {
    return Array.from(this.clients.values())
  }

  public getAvailableTools(): ToolDefinition[] {
    return this.toolsList
  }

  public updateEnabledTools(enabledTools: ToolConfig[]): void {
    console.log(`[MCPServer] Updating enabled tools: ${enabledTools.length} tools`)
    this.enabledTools = enabledTools
    this.setupTools() // 重新设置工具列表
  }

  public getSettings(): MCPServerSettings {
    return this.settings
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '', 'http://localhost')
    const pathname = parsedUrl.pathname

    // Set CORS headers
    const requestOrigin = req.headers.origin as string | undefined
    if (!this.isOriginAllowed(requestOrigin)) {
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(403)
      res.end(JSON.stringify(this.createErrorResponse(null, -32600, 'Forbidden: Origin is not allowed')))
      return
    }
    const allowedOrigin = this.resolveCorsOrigin(requestOrigin)
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id')
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    try {
      if (pathname === '/mcp' && req.method === 'POST') {
        await this.handleMCPRequest(req, res)
      }
      else if (pathname === '/mcp' && req.method === 'DELETE') {
        this.handleMCPSessionDelete(req, res)
      }
      else if (pathname === '/mcp' && req.method === 'GET') {
        this.handleMCPSessionStream(req, res)
      }
      else if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200)
        res.end(JSON.stringify({ status: 'ok', tools: this.toolsList.length }))
      }
      else if (pathname?.startsWith('/api/') && req.method === 'POST') {
        await this.handleSimpleAPIRequest(req, res, pathname)
      }
      else if (pathname === '/api/tools' && req.method === 'GET') {
        res.writeHead(200)
        res.end(JSON.stringify({ tools: this.getSimplifiedToolsList() }))
      }
      else {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    }
    catch (error) {
      console.error('HTTP request error:', error)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }

  private handleMCPSessionStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sessionId = this.getHeader(req.headers, 'mcp-session-id')
    const session = sessionId ? this.sessions.get(sessionId) : undefined
    const accept = this.getHeader(req.headers, 'accept') ?? ''
    if (!sessionId || !session) {
      res.writeHead(404)
      res.end(JSON.stringify(this.createErrorResponse(null, -32000, 'Unknown MCP session')))
      return
    }
    if (!accept.includes('text/event-stream')) {
      res.writeHead(406)
      res.end(JSON.stringify(this.createErrorResponse(null, -32600, 'Accept must include text/event-stream')))
      return
    }

    session.lastActivity = new Date()
    session.stream?.end()
    session.stream = res
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream',
    })
    res.write(': mcp stream connected\n\n')
    req.on('close', () => {
      if (session.stream === res) {
        session.stream = undefined
      }
    })
  }

  private handleMCPSessionDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sessionId = this.getHeader(req.headers, 'mcp-session-id')
    const session = sessionId ? this.sessions.get(sessionId) : undefined
    if (!sessionId || !session) {
      res.writeHead(404)
      res.end(JSON.stringify(this.createErrorResponse(null, -32000, 'Unknown MCP session')))
      return
    }
    this.sessions.delete(sessionId)
    session.stream?.end()
    res.writeHead(204)
    res.end()
  }

  private async handleMCPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', async () => {
      let message: unknown
      try {
        message = JSON.parse(body)
        if (!isRecord(message) || typeof message.method !== 'string') {
          throw new JsonRpcRequestError(-32600, 'Invalid Request')
        }

        const era = this.detectProtocolEra(message, req.headers)
        const sessionId = this.getHeader(req.headers, 'mcp-session-id')
        const session = sessionId ? this.sessions.get(sessionId) : undefined
        if (era === 'legacy' && message.method !== 'initialize' && !session) {
          throw new JsonRpcRequestError(-32000, 'Session required: initialize must be completed before this request')
        }
        if (era === 'legacy' && session) {
          session.lastActivity = new Date()
          const requestedVersion = this.getHeader(req.headers, 'mcp-protocol-version')
          if (requestedVersion && requestedVersion !== session.protocolVersion) {
            throw new JsonRpcRequestError(-32020, 'HeaderMismatch: MCP-Protocol-Version must match the negotiated session version', {
              header: requestedVersion,
              session: session.protocolVersion,
            })
          }
        }
        if (era === 'modern') {
          this.validateModernHttpRequest(message, req.headers)
        }

        const response = await this.handleMessage(message, era, session)
        if (!response) {
          res.writeHead(202)
          res.end()
          return
        }

        if (era === 'legacy' && message.method === 'initialize' && !response.error) {
          const protocolVersion = response.result && isRecord(response.result)
            ? response.result.protocolVersion
            : undefined
          if (typeof protocolVersion === 'string' && this.isLegacyProtocolVersion(protocolVersion)) {
            const newSession: MCPHttpSession = {
              id: randomUUID(),
              protocolVersion,
              lastActivity: new Date(),
            }
            this.sessions.set(newSession.id, newSession)
            res.setHeader('Mcp-Session-Id', newSession.id)
          }
        }

        const status = era === 'modern' && response.error
          ? this.getModernHttpErrorStatus(response.error.code)
          : response.error && response.error.code === -32601 ? 404 : 200
        res.writeHead(status)
        res.end(JSON.stringify(response))
      }
      catch (error: unknown) {
        console.error('Error handling MCP request:', error)
        const requestError = error instanceof JsonRpcRequestError
          ? error
          : new JsonRpcRequestError(-32700, `Parse error: ${getErrorMessage(error)}`)
        const modern = message !== undefined && this.detectProtocolEra(message, req.headers) === 'modern'
        res.writeHead(modern ? this.getModernHttpErrorStatus(requestError.code) : 400)
        res.end(JSON.stringify(this.createErrorResponse(null, requestError.code, requestError.message, requestError.data)))
      }
    })
  }

  private async handleMessage(
    message: unknown,
    era: ProtocolEra = 'legacy',
    session?: MCPHttpSession,
  ): Promise<JsonRpcResponse | null> {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return this.createErrorResponse(null, -32600, 'Invalid Request')
    }

    if (!Object.hasOwn(message, 'id')) {
      return null
    }
    const validId = typeof message.id === 'string' || typeof message.id === 'number'
      || (era === 'legacy' && message.id === null)
    if (!validId) {
      return this.createErrorResponse(null, -32600, 'Invalid Request: request id must be a string or number')
    }
    const id = message.id as JsonRpcId
    const { method, params } = message

    try {
      if (era === 'modern') {
        this.validateModernRequestMetadata(params)
      }

      let result: unknown
      switch (method) {
        case 'server/discover':
          if (era !== 'modern') {
            throw new JsonRpcRequestError(-32601, `Method not found: ${method}`)
          }
          result = {
            supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
            capabilities: { tools: {} },
            instructions: 'Use tools/list to discover actions. Query exact UUIDs and asset identities before writes.',
          }
          break
        case 'tools/list':
          result = { tools: this.getAvailableTools() }
          break
        case 'tools/call':
        {
          if (!isRecord(params) || typeof params.name !== 'string') {
            throw new JsonRpcRequestError(-32602, 'Invalid params: tools/call requires a tool name')
          }
          const { name, arguments: args } = params
          if (!this.toolsList.some(tool => tool.name === name)) {
            throw new JsonRpcRequestError(-32602, `Unknown or disabled tool: ${name}`)
          }
          const rawToolResult = await this.executeToolCall(name, args)
          const preparedToolResult = this.prepareToolResult(name, rawToolResult)
          const toolResult = preparedToolResult.result
          result = {
            content: [{ type: 'text', text: preparedToolResult.text }],
            ...(era === 'modern' ? { structuredContent: toolResult } : {}),
            isError: !toolResult.success,
          }
          break
        }
        case 'initialize':
          if (era !== 'legacy') {
            throw new JsonRpcRequestError(-32601, 'Method not found: initialize. This server supports modern MCP via per-request metadata and server/discover.')
          }
          if (!this.isInitializeParams(params)) {
            throw new JsonRpcRequestError(-32602, 'Invalid params: initialize requires protocolVersion')
          }
          result = {
            protocolVersion: this.negotiateLegacyProtocolVersion(params.protocolVersion),
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          }
          break
        case 'notifications/initialized':
          if (era !== 'legacy' || !session) {
            throw new JsonRpcRequestError(-32601, `Method not found: ${method}`)
          }
          return null
        default:
          throw new JsonRpcRequestError(-32601, `Method not found: ${method}`)
      }

      return {
        jsonrpc: '2.0',
        id,
        result: era === 'modern' ? this.createModernResult(method, result) : result,
      }
    }
    catch (error: unknown) {
      if (error instanceof JsonRpcRequestError) {
        return this.createErrorResponse(id, error.code, error.message, error.data)
      }
      return this.createErrorResponse(id, -32603, getErrorMessage(error))
    }
  }

  private createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
  }

  private createModernResult(method: string, result: unknown): JsonRecord {
    const cacheHints = method === 'server/discover' || method === 'tools/list'
      ? { ttlMs: 0, cacheScope: 'public' as const }
      : {}

    return {
      ...(isRecord(result) ? result : { value: result }),
      resultType: 'complete',
      ...cacheHints,
      _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
    }
  }

  private validateModernRequestMetadata(params: unknown): void {
    if (!isRecord(params) || !isRecord(params._meta)) {
      throw new JsonRpcRequestError(-32602, 'Invalid params: modern requests require params._meta')
    }
    const metadata = params._meta
    const requested = metadata['io.modelcontextprotocol/protocolVersion']
    if (typeof requested !== 'string') {
      throw new JsonRpcRequestError(-32602, 'Invalid params: _meta requires io.modelcontextprotocol/protocolVersion')
    }
    if (requested !== MODERN_PROTOCOL_VERSION) {
      throw new JsonRpcRequestError(-32022, `Unsupported protocol version: ${requested}`, {
        supported: SUPPORTED_PROTOCOL_VERSIONS,
        requested,
      })
    }
    if (!isRecord(metadata['io.modelcontextprotocol/clientCapabilities'])) {
      throw new JsonRpcRequestError(-32602, 'Invalid params: _meta requires io.modelcontextprotocol/clientCapabilities')
    }
  }

  private isInitializeParams(params: unknown): params is InitializeParams {
    return isRecord(params) && typeof params.protocolVersion === 'string'
  }

  private negotiateLegacyProtocolVersion(clientVersion: string): LegacyProtocolVersion {
    if (this.isLegacyProtocolVersion(clientVersion)) {
      return clientVersion
    }
    throw new JsonRpcRequestError(-32022, `Unsupported protocol version: ${clientVersion}`, {
      supported: SUPPORTED_PROTOCOL_VERSIONS,
      requested: clientVersion,
    })
  }

  private isLegacyProtocolVersion(version: string): version is LegacyProtocolVersion {
    return (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(version)
  }

  private detectProtocolEra(message: unknown, headers: http.IncomingHttpHeaders): ProtocolEra {
    if (isRecord(message) && isRecord(message.params) && isRecord(message.params._meta)
      && typeof message.params._meta['io.modelcontextprotocol/protocolVersion'] === 'string') {
      return 'modern'
    }
    if (isRecord(message) && message.method === 'initialize') {
      return 'legacy'
    }
    const sessionId = this.getHeader(headers, 'mcp-session-id')
    if (sessionId && this.sessions.has(sessionId)) {
      return 'legacy'
    }
    return this.getHeader(headers, 'mcp-protocol-version') ? 'modern' : 'legacy'
  }

  private validateModernHttpRequest(message: unknown, headers: http.IncomingHttpHeaders): void {
    if (!isRecord(message) || typeof message.method !== 'string') {
      throw new JsonRpcRequestError(-32600, 'Invalid Request')
    }
    const params = isRecord(message.params) ? message.params : undefined
    const metadata = params && isRecord(params._meta) ? params._meta : undefined
    const bodyVersion = metadata?.['io.modelcontextprotocol/protocolVersion']
    const protocolHeader = this.getHeader(headers, 'mcp-protocol-version')
    const methodHeader = this.getHeader(headers, 'mcp-method')
    const accept = this.getHeader(headers, 'accept') ?? ''

    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      throw new JsonRpcRequestError(-32020, 'HeaderMismatch: Accept must include application/json and text/event-stream')
    }
    if (!protocolHeader || protocolHeader !== bodyVersion) {
      throw new JsonRpcRequestError(-32020, 'HeaderMismatch: MCP-Protocol-Version must match request _meta', {
        header: protocolHeader ?? null,
        body: bodyVersion ?? null,
      })
    }
    if (!methodHeader || methodHeader !== message.method) {
      throw new JsonRpcRequestError(-32020, 'HeaderMismatch: Mcp-Method must match request method', {
        header: methodHeader ?? null,
        body: message.method,
      })
    }
    if (message.method === 'tools/call') {
      const bodyName = params?.name
      const nameHeader = this.getHeader(headers, 'mcp-name')
      if (typeof bodyName !== 'string' || !nameHeader || this.decodeHeaderValue(nameHeader) !== bodyName) {
        throw new JsonRpcRequestError(-32020, 'HeaderMismatch: Mcp-Name must match tools/call params.name', {
          header: nameHeader ?? null,
          body: bodyName ?? null,
        })
      }
    }
  }

  private getHeader(headers: http.IncomingHttpHeaders, name: string): string | undefined {
    const value = headers[name]
    return Array.isArray(value) ? value[0] : value
  }

  private decodeHeaderValue(value: string): string {
    if (value.startsWith('=?base64?') && value.endsWith('?=')) {
      try {
        return Buffer.from(value.slice(9, -2), 'base64').toString('utf8')
      }
      catch {
        throw new JsonRpcRequestError(-32020, 'HeaderMismatch: malformed Base64 header value')
      }
    }
    return value
  }

  private getModernHttpErrorStatus(code: number): number {
    return code === -32601 ? 404 : 400
  }

  public stop(): void {
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
      console.log('[MCPServer] HTTP server stopped')
    }

    for (const session of this.sessions.values()) {
      session.stream?.end()
    }
    this.clients.clear()
    this.sessions.clear()
  }

  public getStatus(): ServerStatus {
    return {
      running: !!this.httpServer,
      port: this.settings.port,
      clients: this.sessions.size,
    }
  }

  private async handleSimpleAPIRequest(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', async () => {
      try {
        // Extract tool name from path like /api/node/set_position
        const pathParts = pathname.split('/').filter(p => p)
        if (pathParts.length < 3) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Invalid API path. Use /api/{category}/{tool_name}' }))
          return
        }

        const category = pathParts[1]
        const toolName = pathParts[2]
        const fullToolName = `${category}_${toolName}`

        let params: unknown
        try {
          params = body ? JSON.parse(body) : {}
        }
        catch (parseError: unknown) {
          res.writeHead(400)
          res.end(JSON.stringify({
            error: 'Invalid JSON in request body',
            details: getErrorMessage(parseError),
          }))
          return
        }

        // Execute tool
        const rawResult = await this.executeToolCall(fullToolName, params)
        const result = this.prepareToolResult(fullToolName, rawResult).result

        res.writeHead(200)
        res.end(JSON.stringify({
          success: true,
          tool: fullToolName,
          result,
        }))
      }
      catch (error: unknown) {
        console.error('Simple API error:', error)
        res.writeHead(500)
        res.end(JSON.stringify({
          success: false,
          error: getErrorMessage(error),
          tool: pathname,
        }))
      }
    })
  }

  private getSimplifiedToolsList(): SimplifiedToolDefinition[] {
    return this.toolsList.map((tool) => {
      const parts = tool.name.split('_')
      const category = parts[0]
      const toolName = parts.slice(1).join('_')

      return {
        name: tool.name,
        category,
        toolName,
        description: tool.description,
        apiPath: `/api/${category}/${toolName}`,
        curlExample: this.generateCurlExample(category, toolName, tool.inputSchema),
      }
    })
  }

  private generateCurlExample(category: string, toolName: string, schema: unknown): string {
    // Generate sample parameters based on schema
    const sampleParams = this.generateSampleParams(schema)
    const jsonString = JSON.stringify(sampleParams, null, 2)

    return `curl -X POST http://127.0.0.1:${this.settings.port}/api/${category}/${toolName} \\
  -H "Content-Type: application/json" \\
  -d '${jsonString}'`
  }

  private generateSampleParams(schema: unknown): JsonRecord {
    if (!isRecord(schema) || !isRecord(schema.properties))
      return {}

    const sample: JsonRecord = {}
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!isRecord(prop)) {
        sample[key] = 'example_value'
        continue
      }
      const propSchema = prop
      switch (propSchema.type) {
        case 'string':
          sample[key] = propSchema.default || 'example_string'
          break
        case 'number':
          sample[key] = propSchema.default || 42
          break
        case 'boolean':
          sample[key] = propSchema.default || true
          break
        case 'object':
          sample[key] = propSchema.default || { x: 0, y: 0, z: 0 }
          break
        default:
          sample[key] = 'example_value'
      }
    }
    return sample
  }

  public updateSettings(settings: MCPServerSettings) {
    this.settings = settings
    if (this.httpServer) {
      this.stop()
      this.start()
    }
  }

  private isOriginAllowed(requestOrigin?: string): boolean {
    if (!requestOrigin) {
      return true
    }
    const allowedOrigins = this.settings.allowedOrigins || ['*']
    return allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin)
  }

  private resolveCorsOrigin(requestOrigin?: string): string {
    const allowedOrigins = this.settings.allowedOrigins || ['*']
    if (allowedOrigins.includes('*')) {
      return '*'
    }
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      return requestOrigin
    }
    return allowedOrigins[0] || '*'
  }
}

// HTTP transport doesn't need persistent connections
// MCP over HTTP uses request-response pattern
