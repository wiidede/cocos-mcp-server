# 测试用例重构方案

## 目标

1. **清晰的分类**：从名字就能看出测试什么功能
2. **独立运行**：每个测试不依赖其他测试的状态
3. **可维护性**：添加新测试时知道放在哪里
4. **可追溯性**：回归测试能关联到原始 bug

## 新的目录结构

```
source/panels/dev-test/
├── cases/
│   ├── core/                      # 核心功能（CI 必跑）
│   │   ├── scene.ts              # 场景管理测试
│   │   ├── node.ts               # 节点操作测试
│   │   ├── component.ts          # 组件操作测试
│   │   ├── prefab.ts             # 预制体测试
│   │   └── asset.ts              # 资产管理测试
│   │
│   ├── integration/              # 集成测试（多工具协作）
│   │   ├── ui-creation.ts        # UI 元素创建完整流程
│   │   ├── prefab-workflow.ts   # 预制体工作流
│   │   └── asset-pipeline.ts    # 资产导入使用流程
│   │
│   ├── regression/               # 回归测试（已修复 bug）
│   │   └── index.ts             # 所有回归测试集合
│   │
│   ├── edge-cases/               # 边界情况
│   │   ├── invalid-input.ts     # 无效参数测试
│   │   └── timing.ts            # 时序相关测试
│   │
│   └── index.ts                 # 导出所有测试
│
└── test-infra/
    ├── metadata.ts               # 测试元数据定义
    └── runner.ts                # 测试执行器

```

## 迁移映射表

### 当前 bug-fixes.ts → 新结构

| 旧测试 | 测试内容                             | 新位置              | 新名称                                           |
| ------ | ------------------------------------ | ------------------- | ------------------------------------------------ |
| bug_01 | scene_create 同时传 sceneName + path | core/scene.ts       | `scene.create.with_name_and_path`                |
| bug_02 | component_property 大小写敏感        | regression/index.ts | `regression.component_property_case_insensitive` |
| bug_03 | scene_query.get_info 返回信息        | core/scene.ts       | `scene.query.get_info_returns_data`              |
| bug_04 | node_query components 字段完整       | core/node.ts        | `node.query.components_include_type_uuid`        |
| bug_05 | component_property.set 支持多种类型  | core/component.ts   | `component.property.set_supports_all_types`      |
| bug_06 | node_transform.set_property 数值转换 | core/node.ts        | `node.transform.numeric_value_conversion`        |
| bug_07 | prefab_create 内部引用格式           | regression/index.ts | `regression.prefab_internal_reference_format`    |
| bug_08 | asset_query.find_by_name 返回结果    | core/asset.ts       | `asset.query.find_by_name_returns_matches`       |
| bug_09 | component_remove cid vs class name   | regression/index.ts | `regression.component_remove_requires_cid`       |
| bug_10 | component_property native 组件       | core/component.ts   | `component.property.native_component_support`    |

### 当前 recent-fixes.ts → 新结构

| 旧测试    | 测试内容                              | 新位置                        | 新名称                                                   |
| --------- | ------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| recent_01 | create_default_spriteframe 生成白色   | integration/asset-pipeline.ts | `asset.create_spriteframe.default_white_4px`             |
| recent_02 | create_default_spriteframe 自定义颜色 | integration/asset-pipeline.ts | `asset.create_spriteframe.custom_color_size`             |
| recent_03 | spriteFrame 赋值到 cc.Sprite          | regression/index.ts           | `regression.sprite_spriteframe_assignment`               |
| recent_04 | component_property 定位自定义脚本     | regression/index.ts           | `regression.component_property_custom_script_type_field` |
| recent_05 | node_transform 接受序列化格式         | regression/index.ts           | `regression.node_transform_serialized_format`            |

## 测试元数据增强

```typescript
// source/panels/dev-test/test-infra/metadata.ts
export interface TestMetadata {
  name: string // 格式：category.subcategory.test_name
  group: string // 格式：core/scene-management
  description: string // 简短描述
  tags: string[] // ['critical', 'slow', 'flaky']

  // 可选字段
  dependencies?: string[] // 依赖的其他测试名
  minCocosVersion?: string // '3.8.6'
  timeout?: number // 默认 30000ms
  retry?: number // 失败重试次数
  skipIf?: () => boolean | Promise<boolean> // 跳过条件

  // 回归测试专用
  regression?: {
    bugId: string // 'v1.5.0-bug-03'
    fixedIn: string // 'v1.5.1'
    issueUrl?: string // GitHub issue 链接
    rootCause: string // 简短说明根本原因
  }
}

export interface TestCase extends TestMetadata {
  run: (ctx: TestContext) => Promise<void>
}
```

## 示例：重构后的测试文件

### core/scene.ts

```typescript
import type { TestCase } from '../test-infra/metadata'
import { setupTestScene, teardownTestScene } from '../test-infra/setup'

export const sceneTests: TestCase[] = [
  {
    name: 'scene.create.with_name_and_path',
    group: 'core/scene',
    description: 'scene_management.create accepts both sceneName and savePath parameters',
    tags: ['core', 'scene', 'critical'],
    timeout: 5000,
    run: async (ctx) => {
      const resp = await ctx.callTool('scene_management', {
        action: 'create',
        sceneName: 'TestScene',
        savePath: 'db://assets/__test__/TestScene.scene',
        autoCreateCanvas: false,
      })
      ctx.step('create returns', resp != null)
      ctx.assert(resp?.success, 'create failed')
      ctx.assert(!resp.message?.includes('undefined'), 'message contains undefined')
    },
  },

  {
    name: 'scene.query.get_info_returns_data',
    group: 'core/scene',
    description: 'scene_query with action=get_info returns scene metadata',
    tags: ['core', 'scene', 'query'],
    run: async (ctx) => {
      const resp = await ctx.callTool('scene_query', { action: 'get_info' })
      ctx.assert(resp?.success, 'query failed')
      ctx.assert(resp.data, 'no data returned')
      ctx.assert(typeof resp.data === 'object', 'data is not object')
      ctx.step('has scene name', resp.data.name != null)
      ctx.step('has scene uuid', resp.data.uuid != null)
    },
  },

  // ... 更多场景测试
]
```

### regression/index.ts

```typescript
import type { TestCase } from '../test-infra/metadata'

export const regressionTests: TestCase[] = [
  {
    name: 'regression.sprite_spriteframe_assignment',
    group: 'regression',
    description: 'SpriteFrame created by create_default_spriteframe can be assigned to cc.Sprite component',
    tags: ['regression', 'component', 'asset'],
    timeout: 10000,
    regression: {
      bugId: 'v1.5.0-recent-03',
      fixedIn: 'v1.5.1',
      rootCause: 'Asset import triggered async scene reload, destroying just-created node. Fixed by: 1) Making create_default_spriteframe idempotent (cache check), 2) Waiting for scene ready after first import, 3) Component read matching cc.Sprite correctly.',
    },
    run: async (ctx) => {
      // 1) 生成 SpriteFrame（第二次起会命中缓存）
      const created = await createDefaultSpriteframe(ctx, { color: '#00ff00', size: 2 })
      ctx.assert(created?.spriteFrameUuid, 'create_default_spriteframe failed')

      // 2) 如果首次创建，等待场景稳定
      if (created && !created.cached) {
        const sceneReady = await waitSceneReady(ctx, 5000)
        ctx.assert(sceneReady, 'scene not ready after asset import')
        await sleep(500)
      }

      // 3) 创建节点并添加 Sprite
      const nodeUuid = await createEmptyNode(ctx, 'SpriteTest')
      const added = await addComponentSafely(ctx, nodeUuid, 'cc.Sprite')
      ctx.assert(added, 'failed to add cc.Sprite')

      // 4) 设置 spriteFrame
      const setResp = await ctx.callTool('component_property', {
        action: 'set',
        componentType: 'cc.Sprite',
        nodeUuid,
        property: 'spriteFrame',
        propertyType: 'asset',
        value: created.spriteFrameUuid,
      })
      ctx.assert(setResp?.success, 'failed to set spriteFrame')

      // 5) 读回验证
      await sleep(200)
      const got = await readComponentValue(nodeUuid, 'cc.Sprite', '_spriteFrame')
      const gotUuid = got?.uuid ?? got
      ctx.assert(
        gotUuid && String(gotUuid).includes(created.spriteFrameUuid),
        `uuid mismatch: expected ${created.spriteFrameUuid}, got ${gotUuid}`,
      )
    },
  },

  {
    name: 'regression.component_property_case_insensitive',
    group: 'regression',
    description: 'component_property accepts propertyType in any case (Color, color, COLOR)',
    tags: ['regression', 'component'],
    regression: {
      bugId: 'v1.5.0-bug-02',
      fixedIn: 'v1.5.0',
      rootCause: 'propertyType was case-sensitive, causing "Unsupported property type" for capitalized types. Fixed by normalizing to lowercase.',
    },
    run: async (ctx) => {
      const nodeUuid = await createEmptyNode(ctx, 'TestNode')
      await addComponentSafely(ctx, nodeUuid, 'cc.Sprite')

      // 使用大写 "Color"
      const resp = await ctx.callTool('component_property', {
        action: 'set',
        nodeUuid,
        componentType: 'cc.Sprite',
        property: 'color',
        propertyType: 'Color', // 大写
        value: { r: 255, g: 0, b: 0, a: 255 },
      })
      ctx.assert(resp?.success, `set with "Color" failed: ${resp?.error}`)
    },
  },

  // ... 其他回归测试
]
```

## 测试运行器增强

```typescript
// source/panels/dev-test/test-infra/runner.ts
export class TestRunner {
  // ... 现有方法

  // 新增：按标签过滤
  async runByTags(tags: string[]): Promise<TestResult[]> {
    const filtered = this.cases.filter(c =>
      tags.some(tag => c.tags?.includes(tag))
    )
    return this.runTests(filtered)
  }

  // 新增：只运行 core 测试（CI 快速检查）
  async runCoreTests(): Promise<TestResult[]> {
    return this.runByTags(['core', 'critical'])
  }

  // 新增：运行回归测试
  async runRegressionTests(): Promise<TestResult[]> {
    const filtered = this.cases.filter(c => c.regression != null)
    return this.runTests(filtered)
  }

  // 新增：生成测试报告
  generateReport(): TestReport {
    const results = Array.from(this.results.values())
    return {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
      skipped: results.filter(r => r.status === 'skip').length,
      duration: results.reduce((sum, r) => sum + r.duration, 0),
      byGroup: groupBy(results, r => r.group),
      regressions: results.filter(r => r.regression != null),
    }
  }
}
```

## 迁移步骤

### 阶段 1：创建新结构（不破坏现有）

1. 创建 `cases/core/`, `cases/regression/` 等目录
2. 创建 `test-infra/metadata.ts` 定义新接口
3. 将 `bug_01` 作为示例迁移到 `core/scene.ts`
4. 同时保留 `bug-fixes.ts` 和新文件，两者都注册

### 阶段 2：批量迁移

1. 按映射表迁移所有测试
2. 为每个测试添加元数据（tags, description 等）
3. 回归测试添加 `regression` 字段

### 阶段 3：清理

1. 删除 `bug-fixes.ts` 和 `recent-fixes.ts`
2. 更新 `test-infra/index.ts` 导入新文件
3. 更新文档说明新的测试组织方式

## 好处

1. **开发者体验**
   - 想测场景功能 → 打开 `core/scene.ts`
   - 想看某个 bug 怎么复现 → 打开 `regression/index.ts`，找到 bugId

2. **CI 集成**

   ```bash
   # 快速检查（只跑 core 测试，5-10 分钟）
   runCoreTests()

   # 完整检查（所有测试，20-30 分钟）
   runAll()

   # 回归检查（确保老 bug 不复现，5 分钟）
   runRegressionTests()
   ```

3. **可追溯性**
   - 每个回归测试都有 `bugId`, `fixedIn`, `rootCause`
   - 可以生成"已修复 bug 列表"文档
   - 可以关联到 GitHub issues

4. **团队协作**
   - 新人知道在哪里添加测试
   - Code review 时能快速定位相关测试
   - 测试失败时能立即知道是哪个模块的问题
