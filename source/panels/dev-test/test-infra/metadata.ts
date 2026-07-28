/**
 * 测试元数据增强
 *
 * 为现有测试添加标签、分类等元数据，方便过滤和组织
 */

export type TestEnvironment = 'agnostic' | 'scene' | 'prefab'

export interface TestMetadata {
  name: string // 测试名称
  environment?: TestEnvironment // 测试所需的编辑器上下文，默认 scene
  group: string // 测试分组
  description: string // 描述
  tags?: string[] // 标签：['core', 'critical', 'slow', 'flaky', 'regression']

  // 可选字段
  dependencies?: string[] // 依赖的其他测试名
  minCocosVersion?: string // 最低 Cocos Creator 版本
  timeout?: number // 超时时间（默认 30000ms）
  retry?: number // 失败重试次数
  skipIf?: () => boolean | Promise<boolean> // 跳过条件

  // 回归测试专用
  regression?: {
    bugId: string // bug 标识，如 'v1.5.0-bug-03'
    fixedIn: string // 修复版本，如 'v1.5.1'
    issueUrl?: string // GitHub issue 链接
    rootCause: string // 根本原因简述
  }
}

export interface TestCase extends TestMetadata {
  run: (ctx: TestContext) => Promise<void>
}

export interface TestContext {
  callTool: (name: string, args: any) => Promise<any>
  step: (name: string, ok: boolean, message?: string) => void
  assert: (cond: any, message: string) => void
  scenePath: string
  nodeUuid: string
  ensurePrefabContext: (prefabPath: string) => Promise<void>
  trackNode: (uuid: string) => void
  trackAsset: (url: string) => void
}

// 标签说明
export const TAG_DESCRIPTIONS = {
  core: '核心功能测试，CI 必须通过',
  critical: '关键功能，失败会阻塞发布',
  slow: '耗时较长的测试（>5s）',
  flaky: '可能不稳定的测试，需要重点关注',
  regression: '回归测试，验证已修复的 bug',
  integration: '集成测试，涉及多个工具协作',
  edge_case: '边界情况测试',
  performance: '性能测试',
  scene: '场景相关',
  node: '节点相关',
  component: '组件相关',
  prefab: '预制体相关',
  asset: '资产相关',
  project: '项目相关',
}
