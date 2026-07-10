import type { ConsoleMessage, PerformanceStats, ToolDefinition, ToolExecutor, ToolResponse, ValidationIssue, ValidationResult } from '../types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

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

  private addConsoleMessage(message: any): void {
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
        description: 'Execute JavaScript in scene context',
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
              description: 'Number of context lines to show around each match',
              default: 2,
              minimum: 0,
              maximum: 10,
            },
          },
          required: ['pattern'],
        },
      },
    ]
  }

  async execute(toolName: string, args: any): Promise<ToolResponse> {
    switch (toolName) {
      case 'get_console_logs':
        return await this.getConsoleLogs(args.limit, args.filter)
      case 'clear_console':
        return await this.clearConsole()
      case 'execute_script':
        return await this.executeScript(args.script)
      case 'get_node_tree':
        return await this.getNodeTree(args.rootUuid, args.maxDepth)
      case 'get_performance_stats':
        return await this.getPerformanceStats()
      case 'validate_scene':
        return await this.validateScene(args)
      case 'get_editor_info':
        return await this.getEditorInfo()
      case 'get_project_logs':
        return await this.getProjectLogs(args.lines, args.filterKeyword, args.logLevel)
      case 'get_log_file_info':
        return await this.getLogFileInfo()
      case 'search_project_logs':
        return await this.searchProjectLogs(args.pattern, args.maxResults, args.contextLines)
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
    catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  private async executeScript(script: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'execute-scene-script', {
        name: 'console',
        method: 'eval',
        args: [script],
      }).then((result: any) => {
        resolve({
          success: true,
          data: {
            result,
            message: 'Script executed successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async getNodeTree(rootUuid?: string, maxDepth: number = 10): Promise<ToolResponse> {
    try {
      const sceneTree = await Editor.Message.request('scene', 'query-node-tree')
      const findNode = (node: any): any => {
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
      const buildTree = (node: any, depth: number = 0): any => {
        const children = node.children || []
        const tree = {
          uuid: node.uuid,
          name: node.name,
          active: node.active,
          components: (node.__comps__ || []).map((component: any) => component.__type__ || component.type || 'Unknown'),
          childCount: children.length,
          children: [] as any[],
        }
        if (depth >= maxDepth) {
          if (children.length > 0) {
            tree.children.push({ truncated: true })
          }
          return tree
        }
        tree.children = children.map((child: any) => buildTree(child, depth + 1))
        return tree
      }

      const root = rootUuid ? findNode(sceneTree) : sceneTree
      if (!root) {
        return { success: false, error: `Node with UUID ${rootUuid} not found` }
      }
      return { success: true, data: buildTree(root) }
    }
    catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  private async getPerformanceStats(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-performance').then((stats: any) => {
        const perfStats: PerformanceStats = {
          nodeCount: stats.nodeCount || 0,
          componentCount: stats.componentCount || 0,
          drawCalls: stats.drawCalls || 0,
          triangles: stats.triangles || 0,
          memory: stats.memory || {},
        }
        resolve({ success: true, data: perfStats })
      }).catch(() => {
        // Fallback to basic stats
        resolve({
          success: true,
          data: {
            message: 'Performance stats not available in edit mode',
          },
        })
      })
    })
  }

  private async validateScene(options: any): Promise<ToolResponse> {
    const issues: ValidationIssue[] = []

    try {
      // Check for performance issues
      if (options.checkPerformance) {
        const hierarchy = await Editor.Message.request('scene', 'query-node-tree')
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
    catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  private countNodes(nodes: any[]): number {
    let count = nodes.length
    for (const node of nodes) {
      if (node.children) {
        count += this.countNodes(node.children)
      }
    }
    return count
  }

  private async getEditorInfo(): Promise<ToolResponse> {
    const info = {
      editor: {
        version: (Editor as any).versions?.editor || 'Unknown',
        cocosVersion: (Editor as any).versions?.cocos || 'Unknown',
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

  private async getProjectLogs(lines: number = 100, filterKeyword?: string, logLevel: string = 'ALL'): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        '/Users/lizhiyong/NewProject_3',
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

      return {
        success: true,
        data: {
          totalLines: logLines.length,
          requestedLines: lines,
          filteredLines: filteredLines.length,
          logLevel,
          filterKeyword: filterKeyword || null,
          logs: filteredLines,
          logFilePath,
        },
      }
    }
    catch (error: any) {
      return {
        success: false,
        error: `Failed to read project logs: ${error.message}`,
      }
    }
  }

  private async getLogFileInfo(): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        '/Users/lizhiyong/NewProject_3',
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
    catch (error: any) {
      return {
        success: false,
        error: `Failed to get log file info: ${error.message}`,
      }
    }
  }

  private async searchProjectLogs(pattern: string, maxResults: number = 20, contextLines: number = 2): Promise<ToolResponse> {
    try {
      // Try multiple possible project paths
      let logFilePath = ''
      const possiblePaths = [
        Editor.Project ? Editor.Project.path : null,
        '/Users/lizhiyong/NewProject_3',
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

      const logContent = fs.readFileSync(logFilePath, 'utf8')
      const logLines = logContent.split('\n')

      // Create regex pattern (support both string and regex patterns)
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'gi')
      }
      catch {
        // If pattern is not valid regex, treat as literal string
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      }

      const matches: any[] = []
      let resultCount = 0

      for (let i = 0; i < logLines.length && resultCount < maxResults; i++) {
        const line = logLines[i]
        if (regex.test(line)) {
          // Get context lines
          const contextStart = Math.max(0, i - contextLines)
          const contextEnd = Math.min(logLines.length - 1, i + contextLines)

          const contextLinesArray = []
          for (let j = contextStart; j <= contextEnd; j++) {
            contextLinesArray.push({
              lineNumber: j + 1,
              content: logLines[j],
              isMatch: j === i,
            })
          }

          matches.push({
            lineNumber: i + 1,
            matchedLine: line,
            context: contextLinesArray,
          })

          resultCount++

          // Reset regex lastIndex for global search
          regex.lastIndex = 0
        }
      }

      return {
        success: true,
        data: {
          pattern,
          totalMatches: matches.length,
          maxResults,
          contextLines,
          logFilePath,
          matches,
        },
      }
    }
    catch (error: any) {
      return {
        success: false,
        error: `Failed to search project logs: ${error.message}`,
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
