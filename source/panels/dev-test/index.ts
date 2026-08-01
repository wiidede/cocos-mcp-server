import type { TestResult } from './test-infra'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { testRunner } from './test-infra'

const staticDir = join(__dirname, '../../static')

interface TestMeta {
  name: string
  group: string
  description: string
}

module.exports = Editor.Panel.define({
  listeners: {
    show() { console.log('[Dev Test] Panel shown') },
    hide() { console.log('[Dev Test] Panel hidden') },
  },
  template: readFileSync(join(staticDir, 'template/default/dev-test.html'), 'utf-8'),
  style: readFileSync(join(staticDir, 'style/default/index.css'), 'utf-8'),
  $: {
    runAllBtn: '#runAllBtn',
    runCoreBtn: '#runCoreBtn',
    runRegressionBtn: '#runRegressionBtn',
    refreshBtn: '#refreshBtn',
    clearBtn: '#clearBtn',
    copyErrorsBtn: '#copyErrorsBtn',
    passCount: '#passCount',
    failCount: '#failCount',
    runningCount: '#runningCount',
    totalCount: '#totalCount',
    testList: '#testList',
    tagFilters: '#tagFilters',
  },
  methods: {
    tests: [] as TestMeta[],
    results: new Map<string, TestResult>(),
    running: false,
    activeTags: new Set<string>(),

    async loadTests(this: any) {
      try {
        this.tests = testRunner.list()
      }
      catch (e: any) {
        this.$.testList.innerHTML = `<div class="empty">加载测试列表失败: ${e?.message ?? e}</div>`
        return
      }
      this.renderTagFilters()
      this.render()
    },

    renderTagFilters(this: any) {
      const tags = testRunner.getAvailableTags()
      const tagCounts: Record<string, number> = {}

      // 统计每个标签的测试数量
      for (const t of this.tests) {
        const tags = testRunner.getTagsForTest(t.name)
        tags.forEach((tag: string) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1
        })
      }

      let html = ''
      for (const tag of tags) {
        const count = tagCounts[tag] || 0
        const active = this.activeTags.has(tag) ? 'active' : ''
        html += `<button class="tag-btn ${active}" data-tag="${this.escape(tag)}">${this.escape(tag)} <span class="tag-btn count">${count}</span></button>`
      }

      this.$.tagFilters.innerHTML = html

      // 绑定标签按钮点击事件
      this.$.tagFilters.querySelectorAll('.tag-btn').forEach((btn: any) => {
        btn.addEventListener('click', () => {
          const tag = btn.dataset.tag
          if (this.activeTags.has(tag)) {
            this.activeTags.delete(tag)
          }
          else {
            this.activeTags.add(tag)
          }
          this.renderTagFilters()
          this.render()
        })
      })
    },

    getFilteredTests(this: any): TestMeta[] {
      if (this.activeTags.size === 0) {
        return this.tests
      }

      return this.tests.filter((t: TestMeta) => {
        const tags = testRunner.getTagsForTest(t.name)
        if (!tags.length)
          return false
        return Array.from(this.activeTags).some((tag: any) => tags.includes(tag))
      })
    },

    render(this: any) {
      const filteredTests = this.getFilteredTests()
      this.$.totalCount.textContent = String(filteredTests.length)
      this.updateSummary()

      if (filteredTests.length === 0) {
        this.$.testList.innerHTML = '<div class="empty">没有符合过滤条件的测试用例</div>'
        return
      }

      // 按 group 分组
      const grouped: Record<string, TestMeta[]> = {}
      for (const t of filteredTests) {
        if (!grouped[t.group])
          grouped[t.group] = []
        grouped[t.group].push(t)
      }

      let html = ''
      for (const [group, tests] of Object.entries(grouped)) {
        html += `<div class="group-title">${group}</div>`
        for (const t of tests) {
          const r: TestResult | undefined = this.results.get(t.name)
          const status = r?.status ?? 'pending'
          const duration = r ? `${r.duration}ms` : ''
          const err = r?.error ? `<div class="test-error">${this.escape(r.error)}${r.stack ? `\n\n${this.escape(r.stack)}` : ''}</div>` : ''
          const stepsHtml = r?.steps?.length
            ? `<div class="test-steps">${r.steps.map((s: any) => `<span class="test-step ${s.ok ? 'ok' : 'fail'}">${this.escape(s.name)}${s.message ? `: ${this.escape(String(s.message).slice(0, 50))}` : ''}</span>`).join('')}</div>`
            : ''
          html += `
            <div class="test-item ${status}" data-name="${this.escape(t.name)}">
              <div class="test-detail" data-action="toggle">
                <span class="chevron">▶</span>
                <span class="test-status-dot ${status}"></span>
                <div class="test-info">
                  <div class="test-name">${this.escape(t.name)}</div>
                  <div class="test-desc">${this.escape(t.description)}</div>
                </div>
                <div class="test-duration">${duration}</div>
                <button class="test-run-btn" data-action="run">Run</button>
              </div>
              <div class="test-detail-body">
                ${stepsHtml}
                ${err}
              </div>
            </div>
          `
        }
      }
      this.$.testList.innerHTML = html

      // 绑定事件
      this.$.testList.querySelectorAll('.test-item').forEach((el: any) => {
        const name = el.dataset.name
        el.querySelector('[data-action="toggle"]').addEventListener('click', (e: any) => {
          if (e.target.dataset.action === 'run')
            return
          el.classList.toggle('open')
        })
        el.querySelector('[data-action="run"]').addEventListener('click', (e: any) => {
          e.stopPropagation()
          this.runOne(name)
        })
      })
    },

    updateSummary(this: any) {
      let pass = 0
      let fail = 0
      let running = 0
      for (const t of this.tests) {
        const r = this.results.get(t.name)
        if (!r)
          continue
        if (r.status === 'pass')
          pass++
        else if (r.status === 'fail')
          fail++
        else if (r.status === 'running')
          running++
      }
      this.$.passCount.textContent = String(pass)
      this.$.failCount.textContent = String(fail)
      this.$.runningCount.textContent = String(running)
      this.$.copyErrorsBtn.disabled = fail === 0
    },

    updateCopyButton(this: any) {
      let fail = 0
      for (const r of this.results.values()) {
        if (r.status === 'fail')
          fail++
      }
      this.$.copyErrorsBtn.disabled = fail === 0
    },

    buildErrorReport(this: any): string {
      const fails: TestResult[] = []
      for (const r of this.results.values()) {
        if (r.status === 'fail')
          fails.push(r)
      }
      if (fails.length === 0)
        return ''

      const now = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '')
      const lines: string[] = []
      lines.push(`# Dev Test Errors (${now})`)
      lines.push('')
      lines.push(`**Total Failures:** ${fails.length}`)
      lines.push('')

      for (const r of fails) {
        const meta = this.tests.find((t: TestMeta) => t.name === r.name)
        lines.push(`## \`${r.name}\``)
        lines.push(`- **Group:** ${r.group || meta?.group || 'unknown'}`)
        lines.push(`- **Duration:** ${r.duration}ms`)
        if (r.scenePath)
          lines.push(`- **Scene:** \`${r.scenePath}\``)
        if (r.error) {
          lines.push('- **Error:**')
          lines.push('  ```')
          lines.push(`  ${r.error}`)
          lines.push('  ```')
        }
        if (r.stack) {
          lines.push('- **Stack:**')
          lines.push('  ```')
          for (const ln of r.stack.split('\n').slice(0, 8)) {
            lines.push(`  ${ln}`)
          }
          lines.push('  ```')
        }
        if (r.steps?.length) {
          lines.push('- **Steps:**')
          for (const s of r.steps) {
            const mark = s.ok ? 'x' : ' '
            const msg = s.message ? ` — ${s.message}` : ''
            lines.push(`  - [${mark}] ${s.name}${msg}`)
          }
        }
        lines.push('')
      }

      return lines.join('\n')
    },

    async copyErrors(this: any) {
      const report = this.buildErrorReport()
      if (!report)
        return
      try {
        await navigator.clipboard.writeText(report)
        const orig = this.$.copyErrorsBtn.textContent
        this.$.copyErrorsBtn.textContent = '已复制 ✓'
        setTimeout(() => {
          this.$.copyErrorsBtn.textContent = orig
        }, 1500)
      }
      catch (e: any) {
        // fallback: 选中 textarea 复制
        try {
          const ta = document.createElement('textarea')
          ta.value = report
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          this.$.copyErrorsBtn.textContent = '已复制 ✓'
          setTimeout(() => {
            this.$.copyErrorsBtn.textContent = '复制错误'
          }, 1500)
        }
        catch (e2: any) {
          Editor.Dialog.error('复制失败', { detail: e2?.message ?? String(e2) })
        }
      }
    },

    escape(this: any, s: string): string {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    },

    async runOne(this: any, name: string) {
      if (this.running) {
        Editor.Dialog.warn('请等待当前测试完成')
        return
      }
      this.running = true
      this.results.set(name, {
        name,
        group: '',
        description: '',
        status: 'running',
        duration: 0,
        error: null,
        stack: null,
        steps: [],
        scenePath: '',
      })
      this.render()
      try {
        const result: TestResult = await testRunner.runOne(name)
        this.results.set(name, result)
      }
      catch (e: any) {
        this.results.set(name, {
          name,
          group: '',
          description: '',
          status: 'fail',
          duration: 0,
          error: e?.message ?? String(e),
          stack: e?.stack ?? null,
          steps: [],
          scenePath: '',
        })
      }
      this.running = false
      this.render()
    },

    async runAll(this: any) {
      if (this.running) {
        Editor.Dialog.warn('已有测试正在运行')
        return
      }
      this.running = true
      this.$.runAllBtn.disabled = true
      this.$.runCoreBtn.disabled = true
      this.$.runRegressionBtn.disabled = true
      try {
        await testRunner.runAll((result) => {
          this.results.set(result.name, result)
          this.render()
        })
      }
      catch (e: any) {
        Editor.Dialog.error('运行全部失败', { detail: e?.message ?? String(e) })
      }
      this.running = false
      this.$.runAllBtn.disabled = false
      this.$.runCoreBtn.disabled = false
      this.$.runRegressionBtn.disabled = false
      this.render()
    },

    async runCoreTests(this: any) {
      if (this.running) {
        Editor.Dialog.warn('已有测试正在运行')
        return
      }
      this.running = true
      this.$.runAllBtn.disabled = true
      this.$.runCoreBtn.disabled = true
      this.$.runRegressionBtn.disabled = true
      try {
        await testRunner.runCoreTests((result) => {
          this.results.set(result.name, result)
          this.render()
        })
      }
      catch (e: any) {
        Editor.Dialog.error('运行核心测试失败', { detail: e?.message ?? String(e) })
      }
      this.running = false
      this.$.runAllBtn.disabled = false
      this.$.runCoreBtn.disabled = false
      this.$.runRegressionBtn.disabled = false
      this.render()
    },

    async runRegressionTests(this: any) {
      if (this.running) {
        Editor.Dialog.warn('已有测试正在运行')
        return
      }
      this.running = true
      this.$.runAllBtn.disabled = true
      this.$.runCoreBtn.disabled = true
      this.$.runRegressionBtn.disabled = true
      try {
        await testRunner.runRegressionTests((result) => {
          this.results.set(result.name, result)
          this.render()
        })
      }
      catch (e: any) {
        Editor.Dialog.error('运行回归测试失败', { detail: e?.message ?? String(e) })
      }
      this.running = false
      this.$.runAllBtn.disabled = false
      this.$.runCoreBtn.disabled = false
      this.$.runRegressionBtn.disabled = false
      this.render()
    },

    clearResults(this: any) {
      this.results.clear()
      this.render()
    },

    bindEvents(this: any) {
      this.$.runAllBtn.addEventListener('click', () => this.runAll())
      this.$.runCoreBtn.addEventListener('click', () => this.runCoreTests())
      this.$.runRegressionBtn.addEventListener('click', () => this.runRegressionTests())
      this.$.refreshBtn.addEventListener('click', () => this.loadTests())
      this.$.clearBtn.addEventListener('click', () => this.clearResults())
      this.$.copyErrorsBtn.addEventListener('click', () => this.copyErrors())
    },
  },
  ready() {
    (this as any).bindEvents()
    ;(this as any).loadTests()
  },
  beforeClose() {},
  close() {},
} as any)
