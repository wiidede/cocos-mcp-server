/**
 * Dev Test Runner
 * 注册/执行/记录测试用例。串行执行，setup/teardown 真实场景。
 */

import type { TestContext } from './setup'
import { setupTestScene, sleep, teardownTestScene } from './setup'

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip'

export interface TestCase {
  name: string
  group: string
  description: string
  run: (ctx: TestContext) => Promise<void>
}

export interface TestStep {
  name: string
  ok: boolean
  message?: string
}

export interface TestResult {
  name: string
  group: string
  description: string
  status: TestStatus
  duration: number
  error: string | null
  stack: string | null
  steps: TestStep[]
  scenePath: string
}

export class TestRunner {
  private cases: TestCase[] = []
  private results: Map<string, TestResult> = new Map()
  private running = false

  register(c: TestCase) {
    if (this.cases.some(x => x.name === c.name)) {
      console.warn(`[TestRunner] duplicate test name: ${c.name}`)
      return
    }
    this.cases.push(c)
  }

  list() {
    return this.cases.map(c => ({
      name: c.name,
      group: c.group,
      description: c.description,
    }))
  }

  getResults() {
    return Array.from(this.results.values())
  }

  async runOne(name: string): Promise<TestResult> {
    const c = this.cases.find(x => x.name === name)
    if (!c) {
      return {
        name,
        group: 'unknown',
        description: '',
        status: 'fail',
        duration: 0,
        error: `Test not found: ${name}`,
        stack: null,
        steps: [],
        scenePath: '',
      }
    }
    if (this.running) {
      return {
        name,
        group: c.group,
        description: c.description,
        status: 'skip',
        duration: 0,
        error: 'Another test is running',
        stack: null,
        steps: [],
        scenePath: '',
      }
    }
    this.running = true
    const result = await this.execute(c)
    this.results.set(name, result)
    this.running = false
    return result
  }

  async runAll(onProgress?: (result: TestResult) => void): Promise<TestResult[]> {
    if (this.running) {
      throw new Error('TestRunner is already running')
    }
    this.running = true
    try {
      const results: TestResult[] = []
      for (const c of this.cases) {
        const r = await this.execute(c)
        this.results.set(c.name, r)
        results.push(r)
        onProgress?.(r)
      }
      return results
    }
    finally {
      this.running = false
    }
  }

  private async execute(c: TestCase): Promise<TestResult> {
    const start = Date.now()
    const steps: TestStep[] = []
    const step = (name: string, ok: boolean, message?: string) => {
      steps.push({ name, ok, message })
    }
    const assert = (cond: any, message: string) => {
      if (!cond) {
        throw new Error(`Assertion failed: ${message}`)
      }
    }

    let status: TestStatus = 'pass'
    let error: string | null = null
    let stack: string | null = null
    let scenePath = ''

    try {
      const setup = await setupTestScene()
      scenePath = setup.scenePath
      const ctx: TestContext = {
        callTool: setup.callTool,
        step: (n, ok, m) => {
          step(n, ok, m)
          setup.step(n, ok, m)
        },
        assert: setup.assert,
        scenePath: setup.scenePath,
        nodeUuid: setup.nodeUuid,
      }
      await c.run(ctx)
    }
    catch (e: any) {
      status = 'fail'
      error = e?.message ?? String(e)
      stack = e?.stack ?? null
    }
    finally {
      try {
        await teardownTestScene()
      }
      catch {
        // 忽略清理错误
      }
    }

    return {
      name: c.name,
      group: c.group,
      description: c.description,
      status,
      duration: Date.now() - start,
      error,
      stack,
      steps,
      scenePath,
    }
  }
}

export const testRunner = new TestRunner()

export { sleep }
