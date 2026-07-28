/**
 * Dev Test Runner
 * 注册/执行/记录测试用例。串行执行，setup/teardown 真实场景。
 */

import type { TestCase, TestEnvironment } from './metadata'
import type { TestContext, TestSession } from './setup'
import { createTestSession, sleep } from './setup'

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip'

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
    let session: TestSession | undefined
    try {
      session = await createTestSession()
      const result = await this.execute(c, session)
      this.results.set(name, result)
      return result
    }
    finally {
      await session?.cleanup().catch(() => undefined)
      this.running = false
    }
  }

  async runAll(onProgress?: (result: TestResult) => void): Promise<TestResult[]> {
    if (this.running) {
      throw new Error('TestRunner is already running')
    }
    this.running = true
    let session: TestSession | undefined
    try {
      session = await createTestSession()
      const results: TestResult[] = []
      for (const c of this.sortByEnvironment(this.cases)) {
        const r = await this.execute(c, session)
        this.results.set(c.name, r)
        results.push(r)
        onProgress?.(r)
      }
      return results
    }
    finally {
      await session?.cleanup().catch(() => undefined)
      this.running = false
    }
  }

  private async execute(c: TestCase, session: TestSession): Promise<TestResult> {
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

    const environment: TestEnvironment = c.environment ?? 'scene'
    try {
      // Prefab tests often need to create their fixture node in the shared
      // TestScene before opening the Prefab under test. The test itself can
      // then call ctx.ensurePrefabContext() at the exact point where the
      // editor-context transition is part of the scenario.
      if (environment === 'scene' || environment === 'prefab')
        await session.ensureSceneContext()
      scenePath = session.scenePath
      const ctx: TestContext = session.createContext((n, ok, m) => step(n, ok, m), assert)
      await c.run(ctx)
    }
    catch (e: any) {
      status = 'fail'
      error = e?.message ?? String(e)
      stack = e?.stack ?? null
    }
    finally {
      if (environment === 'prefab')
        await session.exitPrefabContext().catch(() => undefined)
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

  private sortByEnvironment(cases: TestCase[]): TestCase[] {
    const order: Record<TestEnvironment, number> = { agnostic: 0, scene: 1, prefab: 2 }
    return [...cases].sort((a, b) => (order[a.environment ?? 'scene'] - order[b.environment ?? 'scene']))
  }

  // 新增：按标签过滤运行测试
  async runByTags(tags: string[], onProgress?: (result: TestResult) => void): Promise<TestResult[]> {
    const filtered = this.cases.filter(c =>
      tags.some(tag => c.tags?.includes(tag)),
    )

    if (filtered.length === 0) {
      console.warn(`[TestRunner] No tests found with tags: ${tags.join(', ')}`)
      return []
    }

    console.log(`[TestRunner] Running ${filtered.length} tests with tags: ${tags.join(', ')}`)

    if (this.running) {
      throw new Error('TestRunner is already running')
    }
    this.running = true
    let session: TestSession | undefined
    try {
      session = await createTestSession()
      const results: TestResult[] = []
      for (const c of this.sortByEnvironment(filtered)) {
        const r = await this.execute(c, session)
        this.results.set(c.name, r)
        results.push(r)
        onProgress?.(r)
      }
      return results
    }
    finally {
      await session?.cleanup().catch(() => undefined)
      this.running = false
    }
  }

  // 新增：只运行核心测试（CI 快速检查）
  async runCoreTests(onProgress?: (result: TestResult) => void): Promise<TestResult[]> {
    return this.runByTags(['core', 'critical'], onProgress)
  }

  // 新增：只运行回归测试
  async runRegressionTests(onProgress?: (result: TestResult) => void): Promise<TestResult[]> {
    return this.runByTags(['regression'], onProgress)
  }

  // 新增：获取所有可用标签
  getAvailableTags(): string[] {
    const tags = new Set<string>()
    this.cases.forEach((c) => {
      c.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags).sort()
  }

  // 新增：按名称获取测试的标签（供 UI 过滤使用，避免直接访问私有 cases）
  getTagsForTest(name: string): string[] {
    const c = this.cases.find(x => x.name === name)
    return c?.tags ?? []
  }

  // 新增：生成测试统计报告
  generateReport() {
    const results = Array.from(this.results.values())
    const byGroup = new Map<string, TestResult[]>()
    const byTag = new Map<string, TestResult[]>()

    results.forEach((r) => {
      // 按 group 分组
      if (!byGroup.has(r.group)) {
        byGroup.set(r.group, [])
      }
      byGroup.get(r.group)!.push(r)

      // 按 tag 分组
      const testCase = this.cases.find(c => c.name === r.name)
      testCase?.tags?.forEach((tag) => {
        if (!byTag.has(tag)) {
          byTag.set(tag, [])
        }
        byTag.get(tag)!.push(r)
      })
    })

    return {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
      skipped: results.filter(r => r.status === 'skip').length,
      duration: results.reduce((sum, r) => sum + r.duration, 0),
      byGroup: Object.fromEntries(byGroup),
      byTag: Object.fromEntries(byTag),
      regressions: results.filter((r) => {
        const testCase = this.cases.find(c => c.name === r.name)
        return testCase?.regression != null
      }),
    }
  }
}

export const testRunner = new TestRunner()

export { sleep }
