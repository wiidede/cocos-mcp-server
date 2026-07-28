/**
 * 回归测试集合
 *
 * 所有已修复 bug 的回归测试
 */

// 合并所有回归测试
import { batch1Tests } from './batch-1'
import { batch2Tests } from './batch-2'
import { batch3Tests } from './batch-3'
import { batch4Tests } from './batch-4'
import { batch5Tests } from './batch-5'
import { batch6Tests } from './batch-6'

export { batch1Tests } from './batch-1'
export { batch2Tests } from './batch-2'
export { batch3Tests } from './batch-3'
export { batch4Tests } from './batch-4'
export { batch5Tests } from './batch-5'
export { batch6Tests } from './batch-6'

export const allRegressionTests = [
  ...batch1Tests,
  ...batch2Tests,
  ...batch3Tests,
  ...batch4Tests,
  ...batch5Tests,
  ...batch6Tests,
]
