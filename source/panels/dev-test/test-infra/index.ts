/**
 * Dev Test 入口
 * 集中注册所有测试用例；导出 testRunner 实例给 panel 直接使用。
 */

import { batch1Tests } from '../cases/regression/batch-1'
import { batch2Tests } from '../cases/regression/batch-2'
import { batch3Tests } from '../cases/regression/batch-3'
import { testRunner } from './runner'

for (const c of batch1Tests) {
  testRunner.register(c)
}
for (const c of batch2Tests) {
  testRunner.register(c)
}
for (const c of batch3Tests) {
  testRunner.register(c)
}

console.log(`[dev-test] registered ${batch1Tests.length} batch-1 + ${batch2Tests.length} batch-2 + ${batch3Tests.length} batch-3 regression tests`)

export { testRunner }
export type { TestCase } from './metadata'
export type { TestResult, TestStatus, TestStep } from './runner'
