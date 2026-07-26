/**
 * Dev Test entry point.
 *
 * Regression batches are exported and aggregated by `cases/regression/index.ts`.
 * Keep registration here data-driven so a newly added batch cannot be exported
 * without appearing in the Dev Test Panel.
 */

import { allRegressionTests } from '../cases/regression'
import { testRunner } from './runner'

for (const testCase of allRegressionTests) {
  testRunner.register(testCase)
}

console.log(`[dev-test] registered ${allRegressionTests.length} regression tests`)

export { testRunner }
export type { TestCase } from './metadata'
export type { TestResult, TestStatus, TestStep } from './runner'
