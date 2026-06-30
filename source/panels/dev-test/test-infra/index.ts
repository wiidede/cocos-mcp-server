/**
 * Dev Test 入口
 * 集中注册所有测试用例；导出 testRunner 实例给 panel 直接使用。
 */

import { bugFixTests } from '../cases/bug-fixes'
import { testRunner } from './runner'

for (const c of bugFixTests) {
  testRunner.register(c)
}

console.log(`[dev-test] registered ${bugFixTests.length} bug-fix test cases`)

export { testRunner }
export type { TestCase, TestResult, TestStatus, TestStep } from './runner'
