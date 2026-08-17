import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundRecentLogLines, DebugTools, searchLogLines } from './debug-tools'

const temporaryProjects: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const projectPath of temporaryProjects.splice(0))
    fs.rmSync(projectPath, { recursive: true, force: true })
})

describe('bounded recent project logs', () => {
  it('keeps the newest complete lines in chronological order', () => {
    const lines = [
      `old ${'x'.repeat(40)}`,
      `middle ${'x'.repeat(40)}`,
      `latest ${'x'.repeat(40)}`,
    ]
    const maxChars = JSON.stringify(lines.slice(1)).length

    expect(boundRecentLogLines(lines, maxChars)).toEqual({
      logs: lines.slice(1),
      chars: maxChars,
      returnedLines: 2,
      omittedLines: 1,
      truncated: true,
      lineTruncated: false,
    })
  })

  it('clips one oversized line while keeping a valid character budget', () => {
    const result = boundRecentLogLines([`error ${'x'.repeat(1000)}`], 100)

    expect(result.returnedLines).toBe(1)
    expect(result.omittedLines).toBe(0)
    expect(result.truncated).toBe(true)
    expect(result.lineTruncated).toBe(true)
    expect(result.chars).toBeLessThanOrEqual(100)
  })

  it('returns bounded metadata and the original log path', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-mcp-debug-'))
    temporaryProjects.push(projectPath)
    const logFilePath = path.join(projectPath, 'temp/logs/project.log')
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
    const lines = Array.from({ length: 4 }, (_, index) => `${index + 1}: ${'x'.repeat(1500)}`)
    fs.writeFileSync(logFilePath, lines.join('\n'))
    vi.stubGlobal('Editor', { Project: { path: projectPath } })

    await expect(new DebugTools().execute('get_project_logs', {
      lines: 4,
      maxChars: 4000,
    })).resolves.toMatchObject({
      success: true,
      instruction: expect.stringContaining('debug_logs.search'),
      data: {
        filteredLines: 4,
        returnedLines: 2,
        omittedLines: 2,
        truncated: true,
        lineTruncated: false,
        maxChars: 4000,
        logs: lines.slice(2),
        logFilePath,
      },
    })
  })

  it('rejects invalid get limits before reading the log file', async () => {
    const tools = new DebugTools()

    await expect(tools.execute('get_project_logs', { lines: 1.5 })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
    })
    await expect(tools.execute('get_project_logs', { maxChars: 3999 })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
    })
    await expect(tools.execute('get_project_logs', { logLevel: 'FATAL' })).resolves.toMatchObject({
      success: false,
      errorCode: 'TOOL_CONTRACT_ERROR',
    })
  })
})

describe('bounded project log search', () => {
  const lines = [
    'before',
    'error first',
    'between',
    'error second',
    'after',
    'error third',
  ]

  it('counts all matches while returning only the requested page', () => {
    const result = searchLogLines(lines, /error/gi, {
      maxResults: 2,
      contextLines: 1,
      maxChars: 12000,
      startLine: 1,
    })

    expect(result).toMatchObject({
      returned: 2,
      matchedTotal: 3,
      truncated: true,
      scanComplete: true,
      nextStartLine: 5,
    })
    expect(result.matches.map(match => match.lineNumber)).toEqual([2, 4])
    expect(result.contextBlocks).toHaveLength(1)
    expect(result.contextBlocks[0].lines.map(line => line.lineNumber)).toEqual([1, 2, 3, 4, 5])
  })

  it('supports pagination and keeps the character budget bounded', () => {
    const result = searchLogLines(
      Array.from({ length: 20 }, (_, index) => `${index + 1}: error ${'x'.repeat(1000)}`),
      /error/gi,
      {
        maxResults: 20,
        contextLines: 1,
        maxChars: 4000,
        startLine: 5,
      },
    )

    expect(result.matches[0].lineNumber).toBe(5)
    expect(result.returned).toBeLessThan(result.matchedTotal)
    expect(result.truncated).toBe(true)
    expect(result.chars).toBeLessThanOrEqual(4000)
  })

  it('clips a single oversized matching line instead of violating the budget', () => {
    const result = searchLogLines([`error ${'x'.repeat(20000)}`], /error/gi, {
      maxResults: 20,
      contextLines: 1,
      maxChars: 4000,
      startLine: 1,
    })

    expect(result.returned).toBe(1)
    expect(result.chars).toBeLessThanOrEqual(4000)
    expect(result.matches[0].matchedLine.length).toBeLessThan(20000)
  })
})
