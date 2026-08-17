import type { SceneNodeDump } from '../editor-message'
import type { ConsoleMessage, PerformanceStats, ToolDefinition, ToolExecutor, ToolResponse, ValidationIssue, ValidationResult } from '../types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { requestScene } from '../editor-message'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

interface DebugTreeNode {
  uuid?: string
  name?: string
  active?: boolean
  components: string[]
  childCount: number
  children: Array<DebugTreeNode | { truncated: true }>
}

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface LogContextLine {
  lineNumber: number
  content: string
  isMatch: boolean
}

export interface LogContextBlock {
  startLine: number
  endLine: number
  lines: LogContextLine[]
}

export interface LogSearchOptions {
  maxResults: number
  contextLines: number
  maxChars: number
  startLine: number
}

export interface LogSearchData {
  returned: number
  matchedTotal: number
  truncated: boolean
  scanComplete: boolean
  nextStartLine?: number
  chars: number
  matches: Array<{ lineNumber: number, matchedLine: string }>
  contextBlocks: LogContextBlock[]
}

export interface BoundedLogLines {
  logs: string[]
  chars: number
  returnedLines: number
  omittedLines: number
  truncated: boolean
  lineTruncated: boolean
}

const PROJECT_LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'ALL'] as const

function clipLogLine(line: string, maxChars: number): string {
  const marker = '... [truncated]'
  let low = 0
  let high = line.length

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = `${line.slice(0, middle)}${marker}`
    if (JSON.stringify([candidate]).length <= maxChars)
      low = middle
    else
      high = middle - 1
  }

  return `${line.slice(0, low)}${marker}`
}

export function boundRecentLogLines(logLines: string[], maxChars: number): BoundedLogLines {
  const logs: string[] = []
  let chars = JSON.stringify(logs).length
  let lineTruncated = false

  for (let index = logLines.length - 1; index >= 0; index--) {
    const lineChars = JSON.stringify(logLines[index]).length
    const candidateChars = chars + lineChars + (logs.length > 0 ? 1 : 0)
    if (candidateChars <= maxChars) {
      logs.unshift(logLines[index])
      chars = candidateChars
      continue
    }

    if (logs.length === 0) {
      const clippedLine = clipLogLine(logLines[index], maxChars)
      logs.push(clippedLine)
      chars = JSON.stringify(logs).length
      lineTruncated = true
    }
    break
  }

  const omittedLines = logLines.length - logs.length
  return {
    logs,
    chars,
    returnedLines: logs.length,
    omittedLines,
    truncated: omittedLines > 0 || lineTruncated,
    lineTruncated,
  }
}

function createLogContextBlocks(logLines: string[], matchIndexes: number[], contextLines: number): LogContextBlock[] {
  const ranges: Array<{ start: number, end: number, matches: Set<number> }> = []
  for (const index of matchIndexes) {
    const start = Math.max(0, index - contextLines)
    const end = Math.min(logLines.length - 1, index + contextLines)
    const previous = ranges[ranges.length - 1]
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end)
      previous.matches.add(index)
    }
    else {
      ranges.push({ start, end, matches: new Set([index]) })
    }
  }

  return ranges.map(range => ({
    startLine: range.start + 1,
    endLine: range.end + 1,
    lines: Array.from({ length: range.end - range.start + 1 }, (_, offset) => {
      const index = range.start + offset
      return {
        lineNumber: index + 1,
        content: logLines[index],
        isMatch: range.matches.has(index),
      }
    }),
  }))
}

export function searchLogLines(logLines: string[], regex: RegExp, options: LogSearchOptions): LogSearchData {
  const startIndex = options.startLine - 1
  const matchingIndexes: number[] = []
  for (let index = startIndex; index < logLines.length; index++) {
    regex.lastIndex = 0
    if (regex.test(logLines[index])) {
      matchingIndexes.push(index)
    }
  }

  const selectedIndexes: number[] = []
  const selectedLineOverrides = new Map<number, string>()
  let selectedBlocks: LogContextBlock[] = []
  for (const index of matchingIndexes.slice(0, options.maxResults)) {
    const candidateIndexes = [...selectedIndexes, index]
    const candidateBlocks = createLogContextBlocks(logLines, candidateIndexes, options.contextLines)
    const candidateMatches = candidateIndexes.map(matchIndex => ({
      lineNumber: matchIndex + 1,
      matchedLine: logLines[matchIndex],
    }))
    const candidateChars = JSON.stringify({ matches: candidateMatches, contextBlocks: candidateBlocks }).length

    if (selectedIndexes.length > 0 && candidateChars > options.maxChars) {
      break
    }

    if (selectedIndexes.length === 0 && candidateChars > options.maxChars) {
      const bareBlocks = createLogContextBlocks(logLines, [index], 0)
      const bareMatches = [{ lineNumber: index + 1, matchedLine: logLines[index] }]
      const bareChars = JSON.stringify({ matches: bareMatches, contextBlocks: bareBlocks }).length
      if (bareChars <= options.maxChars) {
        selectedIndexes.push(index)
        selectedBlocks = bareBlocks
        continue
      }

      const clippedLength = Math.max(64, Math.floor(options.maxChars / 3))
      const clippedLine = logLines[index].slice(0, clippedLength)
      selectedIndexes.push(index)
      selectedBlocks = [{
        startLine: index + 1,
        endLine: index + 1,
        lines: [{ lineNumber: index + 1, content: clippedLine, isMatch: true }],
      }]
      selectedLineOverrides.set(index, clippedLine)
      continue
    }

    selectedIndexes.push(index)
    selectedBlocks = candidateBlocks
  }

  const matches = selectedIndexes.map(index => ({
    lineNumber: index + 1,
    matchedLine: selectedLineOverrides.get(index) ?? logLines[index],
  }))
  const chars = JSON.stringify({ matches, contextBlocks: selectedBlocks }).length
  const truncated = selectedIndexes.length < matchingIndexes.length
  return {
    returned: selectedIndexes.length,
    matchedTotal: matchingIndexes.length,
    truncated,
    scanComplete: true,
    nextStartLine: truncated && selectedIndexes.length > 0 ? selectedIndexes[selectedIndexes.length - 1] + 2 : undefined,
    chars,
    matches,
    contextBlocks: selectedBlocks,
  }
}

export class DebugTools implements ToolExecutor {
  private consoleMessages: ConsoleMessage[] = []
  private readonly maxMessages = 1000

  constructor() {
    this.setupConsoleCapture()
  }

  private setupConsoleCapture(): void {
    // Intercept Editor console messages
    // Note: Editor.Message.addBroadcastListener may not be available in all versions
    // This is a placeholder for console capture implementation
    console.log('Console capture setup - implementation depends on Editor API availability')
  }

  private addConsoleMessage(message: Omit<ConsoleMessage, 'timestamp'>): void {
    this.consoleMessages.push({
      timestamp: new Date().toISOString(),
      ...message,
    })

    // Keep only latest messages
    if (this.consoleMessages.length > this.maxMessages) {
      this.consoleMessages.shift()
    }
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'get_console_logs',
        description: 'Get editor console logs',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of recent logs to retrieve',
              default: 100,
            },
            filter: {
              type: 'string',
              description: 'Filter logs by type',
              enum: ['all', 'log', 'warn', 'error', 'info'],
              default: 'all',
            },
          },
        },
      },
      {
        name: 'clear_console',
        description: 'Clear editor console',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'execute_script',
        description: 'Legacy compatibility endpoint. Arbitrary JavaScript execution is not supported.',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'JavaScript code to execute',
            },
          },
          required: ['script'],
        },
      },
      {
        name: 'get_node_tree',
        description: 'Get detailed node tree for debugging',
        inputSchema: {
          type: 'object',
          properties: {
            rootUuid: {
              type: 'string',
              description: 'Root node UUID (optional, uses scene root if not provided)',
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum tree depth',
              default: 10,
            },
          },
        },
      },
      {
        name: 'get_performance_stats',
        description: 'Get performance statistics',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'validate_scene',
        description: 'Validate current scene for performance issues',
        inputSchema: {
          type: 'object',
          properties: {
            checkPerformance: {
              type: 'boolean',
              description: 'Check for performance issues',
              default: true,
            },
          },
        },
      },
      {
        name: 'get_editor_info',
        description: 'Get editor and environment information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_project_logs',
        description: 'Get project logs from temp/logs/project.log file',
        inputSchema: {
          type: 'object',
          properties: {
            lines: {
              type: 'number',
              description: 'Number of lines to read from the end of the log file (default: 100)',
              default: 100,
              minimum: 1,
              maximum: 10000,
            },
            filterKeyword: {
              type: 'string',
              description: 'Filter logs containing specific keyword (optional)',
            },
            logLevel: {
              type: 'string',
              description: 'Filter by log level',
              enum: ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'ALL'],
              default: 'ALL',
            },
            maxChars: {
              type: 'number',
              description: 'Maximum characters in the returned logs array',
              default: 12000,
              minimum: 4000,
              maximum: 64000,
            },
          },
        },
      },
      {
        name: 'get_log_file_info',
        description: 'Get information about the project log file',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'search_project_logs',
        description: 'Search for specific patterns or errors in project logs',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Search pattern (supports regex)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of matching results',
              default: 20,
              minimum: 1,
              maximum: 100,
            },
            contextLines: {
              type: 'number',
              description: 'Number of context lines around each match',
              default: 1,
              minimum: 0,
              maximum: 10,
            },
            maxChars: {
              type: 'number',
              description: 'Maximum characters in returned matches and context',
              default: 12000,
              minimum: 4000,
              maximum: 64000,
            },
            startLine: {
              type: 'number',
              description: 'First 1-based log line to scan for pagination',
              default: 1,
              minimum: 1,
            },
          },
          required: ['pattern'],
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'get_console_logs':
        return (args.limit === undefined || typeof args.limit === 'number') && (args.filter === undefined || typeof args.filter === 'string')
          ? this.getConsoleLogs(args.limit, args.filter)
          : toolFailure('get_console_logs accepts optional numeric limit and string filter')
      case 'clear_console':
        return this.clearConsole()
      case 'execute_script':
        return typeof args.script === 'string' ? this.executeScript(args.script) : toolFailure('execute_script requires a script string')
      case 'get_node_tree':
        return (args.rootUuid === undefined || typeof args.rootUuid === 'string') && (args.maxDepth === undefined || typeof args.maxDepth === 'number')
          ? this.getNodeTree(args.rootUuid, args.maxDepth)
          : toolFailure('get_node_tree accepts optional rootUuid and numeric maxDepth')
      case 'get_performance_stats':
        return this.getPerformanceStats()
      case 'validate_scene':
        return (args.checkMissingAssets === undefined || typeof args.checkMissingAssets === 'boolean')
          && (args.checkPerformance === undefined || typeof args.checkPerformance === 'boolean')
          ? this.validateScene(args)
          : toolFailure('validate_scene check flags must be booleans when provided')
      case 'get_editor_info':
        return this.getEditorInfo()
      case 'get_project_logs':
        return (args.lines === undefined || (typeof args.lines === 'number' && Number.isInteger(args.lines) && args.lines >= 1 && args.lines <= 10000))
          && (args.filterKeyword === undefined || typeof args.filterKeyword === 'string')
          && (args.logLevel === undefined || (typeof args.logLevel === 'string' && PROJECT_LOG_LEVELS.includes(args.logLevel as typeof PROJECT_LOG_LEVELS[number])))
          && (args.maxChars === undefined || (typeof args.maxChars === 'number' && Number.isInteger(args.maxChars) && args.maxChars >= 4000 && args.maxChars <= 64000))
          ? this.getProjectLogs(args.lines, args.filterKeyword, args.logLevel, args.maxChars)
          : toolFailure('get_project_logs accepts lines (1-10000), filterKeyword, a supported logLevel, and maxChars (4000-64000)', {
              metadata: {
                category: 'contract',
                retryable: true,
                allowed: ['lines', 'filterKeyword', 'logLevel', 'maxChars'],
              },
            })
      case 'get_log_file_info':
        return this.getLogFileInfo()
      case 'search_project_logs':
        return typeof args.pattern === 'string'
          && (args.maxResults === undefined || (typeof args.maxResults === 'number' && Number.isInteger(args.maxResults) && args.maxResults >= 1 && args.maxResults <= 100))
          && (args.contextLines === undefined || (typeof args.contextLines === 'number' && Number.isInteger(args.contextLines) && args.contextLines >= 0 && args.contextLines <= 10))
          && (args.maxChars === undefined || (typeof args.maxChars === 'number' && Number.isInteger(args.maxChars) && args.maxChars >= 4000 && args.maxChars <= 64000))
          && (args.startLine === undefined || (typeof args.startLine === 'number' && Number.isInteger(args.startLine) && args.startLine >= 1))
          ? this.searchProjectLogs(args.pattern, args.maxResults, args.contextLines, args.maxChars, args.startLine)
          : toolFailure('search_project_logs requires pattern and optional bounded integer limits')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async getConsoleLogs(limit: number = 100, filter: string = 'all'): Promise<ToolResponse> {
    let logs = this.consoleMessages

    if (filter !== 'all') {
      logs = logs.filter(log => log.type === filter)
    }

    const recentLogs = logs.slice(-limit)

    return {
      success: true,
      data: {
        total: logs.length,
        returned: recentLogs.length,
        logs: recentLogs,
      },
    }
  }

  private async clearConsole(): Promise<ToolResponse> {
    this.consoleMessages = []

    try {
      // Note: Editor.Message.send may not return a promise in all versions
      Editor.Message.send('console', 'clear')
      return {
        success: true,
        message: 'Console cleared successfully',
      }
    }
    catch (err: unknown) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  private executeScript(script: string): ToolResponse {
    return toolFailure('Arbitrary JavaScript execution is not supported by Cocos Creator scene scripts.', {
      instruction: 'Use asset_query/project_query for asset database reads, debug_console/debug_logs for diagnostics, or scene_execution.execute_scene_script for a method already exported by a registered scene script.',
      data: { rejectedScriptLength: script.length },
    })
  }

  private async getNodeTree(rootUuid?: string, maxDepth: number = 10): Promise<ToolResponse> {
    try {
      const sceneTree = await requestScene('query-node-tree')
      const findNode = (node: SceneNodeDump): SceneNodeDump | null => {
        if (node.uuid === rootUuid) {
          return node
        }
        for (const child of node.children || []) {
          const match = findNode(child)
          if (match) {
            return match
          }
        }
        return null
      }
      const buildTree = (node: SceneNodeDump, depth: number = 0): DebugTreeNode => {
        const children = node.children || []
        const tree: DebugTreeNode = {
          uuid: node.uuid,
          name: node.name,
          active: node.active,
          components: (node.__comps__ || []).map(component => component.__type__ || component.type || 'Unknown'),
          childCount: children.length,
          children: [],
        }
        if (depth >= maxDepth) {
          if (children.length > 0) {
            tree.children.push({ truncated: true })
          }
          return tree
        }
        tree.children = children.map(child => buildTree(child, depth + 1))
        return tree
      }

      const root = rootUuid ? findNode(sceneTree) : sceneTree
      if (!root) {
        return { success: false, error: `Node with UUID ${rootUuid} not found` }
      }
      return { success: true, data: buildTree(root) }
    }
    catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async getPerformanceStats(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-performance').then((stats) => {
        const perfStats: PerformanceStats = {
          nodeCount: stats.nodeCount || 0,
          componentCount: stats.componentCount || 0,
          drawCalls: stats.drawCalls || 0,
          triangles: stats.triangles || 0,
          memory: stats.memory || {},
        }
        resolve({
          success: true,
          data: {
            available: true,
            stats: perfStats,
          },
        })
      }).catch(() => {
        // Fallback to basic stats
        resolve({
          success: true,
          data: {
            available: false,
            reason: 'Performance stats are not available in edit mode',
            recommendedCollectionMethod: 'Run the project in Preview or on the target platform, then collect runtime profiler statistics from Cocos Creator.',
          },
        })
      })
    })
  }

  private async validateScene(options: ToolArguments): Promise<ToolResponse> {
    const issues: ValidationIssue[] = []

    try {
      // Check for performance issues
      if (options.checkPerformance) {
        const hierarchy = await requestScene('query-node-tree')
        const nodeCount = this.countNodes([hierarchy])

        if (nodeCount > 1000) {
          issues.push({
            type: 'warning',
            category: 'performance',
            message: `High node count: ${nodeCount} nodes (recommended < 1000)`,
            suggestion: 'Consider using object pooling or scene optimization',
          })
        }
      }

      const result: ValidationResult = {
        valid: issues.length === 0,
        issueCount: issues.length,
        issues,
      }

      return { success: true, data: result }
    }
    catch (err: unknown) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  private countNodes(nodes: SceneNodeDump[]): number {
    let count = nodes.length
    for (const node of nodes) {
      if (node.children) {
        count += this.countNodes(node.children)
      }
    }
    return count
  }

  private async getEditorInfo(): Promise<ToolResponse> {
    const versions = (Editor as unknown as { versions?: Record<string, unknown> }).versions
    const info = {
      editor: {
        version: typeof versions?.editor === 'string' ? versions.editor : 'Unknown',
        cocosVersion: typeof versions?.cocos === 'string' ? versions.cocos : 'Unknown',
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
      },
      project: {
        name: Editor.Project.name,
        path: Editor.Project.path,
        uuid: Editor.Project.uuid,
      },
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    }

    return { success: true, data: info }
  }

  private async getProjectLogs(
    lines: number = 100,
    filterKeyword?: string,
    logLevel: string = 'ALL',
    maxChars: number = 12000,
  ): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        process.cwd(),
      ].filter(p => p !== null)

      for (const basePath of possiblePaths) {
        const testPath = path.join(basePath, 'temp/logs/project.log')
        if (fs.existsSync(testPath)) {
          logFilePath = testPath
          break
        }
      }

      if (!logFilePath) {
        return {
          success: false,
          error: `Project log file not found. Tried paths: ${possiblePaths.map(p => path.join(p, 'temp/logs/project.log')).join(', ')}`,
        }
      }

      // Read the file content
      const logContent = fs.readFileSync(logFilePath, 'utf8')
      const logLines = logContent.split('\n').filter(line => line.trim() !== '')

      // Get the last N lines
      const recentLines = logLines.slice(-lines)

      // Apply filters
      let filteredLines = recentLines

      // Filter by log level if not 'ALL'
      if (logLevel !== 'ALL') {
        filteredLines = filteredLines.filter(line =>
          line.includes(`[${logLevel}]`) || line.includes(logLevel.toLowerCase()),
        )
      }

      // Filter by keyword if provided
      if (filterKeyword) {
        filteredLines = filteredLines.filter(line =>
          line.toLowerCase().includes(filterKeyword.toLowerCase()),
        )
      }

      const bounded = boundRecentLogLines(filteredLines, maxChars)
      return {
        success: true,
        instruction: bounded.truncated
          ? 'Use debug_logs.search or filter logFilePath directly when older or complete logs are required.'
          : undefined,
        data: {
          totalLines: logLines.length,
          requestedLines: lines,
          filteredLines: filteredLines.length,
          returnedLines: bounded.returnedLines,
          omittedLines: bounded.omittedLines,
          truncated: bounded.truncated,
          lineTruncated: bounded.lineTruncated,
          chars: bounded.chars,
          maxChars,
          logLevel,
          filterKeyword: filterKeyword || null,
          logs: bounded.logs,
          logFilePath,
        },
      }
    }
    catch (error: unknown) {
      return {
        success: false,
        error: `Failed to read project logs: ${getErrorMessage(error)}`,
      }
    }
  }

  private async getLogFileInfo(): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        process.cwd(),
      ].filter(p => p !== null)

      for (const basePath of possiblePaths) {
        const testPath = path.join(basePath, 'temp/logs/project.log')
        if (fs.existsSync(testPath)) {
          logFilePath = testPath
          break
        }
      }

      if (!logFilePath) {
        return {
          success: false,
          error: `Project log file not found. Tried paths: ${possiblePaths.map(p => path.join(p, 'temp/logs/project.log')).join(', ')}`,
        }
      }

      const stats = fs.statSync(logFilePath)
      const logContent = fs.readFileSync(logFilePath, 'utf8')
      const lineCount = logContent.split('\n').filter(line => line.trim() !== '').length

      return {
        success: true,
        data: {
          filePath: logFilePath,
          fileSize: stats.size,
          fileSizeFormatted: this.formatFileSize(stats.size),
          lastModified: stats.mtime.toISOString(),
          lineCount,
          created: stats.birthtime.toISOString(),
          accessible: fs.constants.R_OK,
        },
      }
    }
    catch (error: unknown) {
      return {
        success: false,
        error: `Failed to get log file info: ${getErrorMessage(error)}`,
      }
    }
  }

  private async searchProjectLogs(
    pattern: string,
    maxResults: number = 20,
    contextLines: number = 1,
    maxChars: number = 12000,
    startLine: number = 1,
  ): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        process.cwd(),
      ].filter(p => p !== null)

      for (const basePath of possiblePaths) {
        const testPath = path.join(basePath, 'temp/logs/project.log')
        if (fs.existsSync(testPath)) {
          logFilePath = testPath
          break
        }
      }

      if (!logFilePath) {
        return {
          success: false,
          error: `Project log file not found. Tried paths: ${possiblePaths.map(p => path.join(p, 'temp/logs/project.log')).join(', ')}`,
        }
      }

      const logLines = fs.readFileSync(logFilePath, 'utf8').split('\n')
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'gi')
      }
      catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      }

      const search = searchLogLines(logLines, regex, { maxResults, contextLines, maxChars, startLine })
      return {
        success: true,
        data: {
          pattern,
          startLine,
          maxResults,
          contextLines,
          maxChars,
          logFilePath,
          ...search,
        },
      }
    }
    catch (error: unknown) {
      return {
        success: false,
        error: `Failed to search project logs: ${getErrorMessage(error)}`,
      }
    }
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }
}
