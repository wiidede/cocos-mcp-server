# Dev Test Panel 生命周期改造计划

## 1. 背景

Dev Test 当前由 `TestRunner` 对每个测试分别执行：

```text
setupTestScene()
  -> 执行测试
teardownTestScene()
```

`setupTestScene()` 会创建固定路径的测试场景，`teardownTestScene()` 会删除测试场景资源，但不会可靠地恢复 Prefab 编辑上下文，也不会统一清理测试过程中创建的 Prefab 和其他资源。

当某个测试调用 `prefab_browse.load` 进入 Prefab 编辑器后，后续测试可能继续运行在 Prefab 上下文中。需要操作普通 Scene 的测试因此可能产生误报或编辑器 IPC 行为差异。

此前为应对 `remove_component` 回归测试失败而增加的多条删除 fallback 已经回退，后续应优先修复 Dev Test 的测试上下文管理，而不是继续在产品工具中增加针对测试状态污染的兼容逻辑。

## 2. 目标

1. 明确区分普通 Scene 测试、Prefab 编辑模式测试和不依赖编辑器上下文的测试。
2. 保证 Scene 测试绝不会在 Prefab 编辑模式中运行。
3. 保证打开 Prefab 后，无论测试成功、断言失败还是抛出异常，最终都会退出 Prefab 编辑模式。
4. `runAll` 过程中尽量只创建一次测试 Scene，不在每个测试之间反复创建、关闭和重新打开 Scene。
5. Prefab 测试集中运行，减少 Scene/Prefab 上下文切换。
6. 测试创建的节点、Prefab 和临时资产可追踪、可清理。
7. 整个测试运行结束后恢复运行前的编辑器上下文，避免污染用户当前工作。
8. `runOne` 仍然具备独立恢复能力，不依赖上一次测试或上一次 `runAll` 的残留状态。

## 3. 非目标

本次改造暂不包括：

- 修改 MCP 工具的业务语义。
- 为 `remove_component` 增加更多删除路径或重试策略。
- 要求每个测试都创建独立 Scene 或独立 Prefab。
- 立即重写全部现有测试用例。
- 在没有确认 Cocos Creator 3.8.6 正式 IPC 的情况下猜测 Prefab 退出接口。

## 4. 推荐运行模型

### 4.1 测试环境分类

给 `TestCase` 增加可选环境字段：

```ts
type TestEnvironment = 'agnostic' | 'scene' | 'prefab'
```

含义：

- `agnostic`：不依赖当前编辑器 Scene/Prefab 上下文的测试。
- `scene`：必须在普通 Scene 编辑模式中运行，不能处于 Prefab 编辑模式。
- `prefab`：需要进入 Prefab 编辑模式后才能运行，或者明确验证 Prefab 编辑器行为。

默认值建议为 `scene`，因为现有 Dev Test 大多数会通过 `scene/query-node`、节点生命周期或组件工具操作当前场景。

测试元数据示例：

```text
{
  name: 'mcp_reliability_01:remove_component_identity_guidance',
  environment: 'scene',
  ...
}
```

真正验证 Prefab 打开行为的测试：

```text
{
  name: 'batch4_05:prefab_browse_load_opens_prefab_editor',
  environment: 'prefab',
  ...
}
```

### 4.2 `runAll` 的阶段

推荐将完整运行划分为以下阶段：

```text
捕获运行前编辑器上下文
  -> 准备一次共享 TestScene
  -> 运行 agnostic 测试
  -> 确保普通 Scene 上下文
  -> 运行 scene 测试
  -> 运行 prefab 测试
       每个 Prefab 测试结束后保证退出 Prefab
  -> 统一清理测试资源
  -> 恢复运行前编辑器上下文
```

普通 Scene 测试不应穿插在 Prefab 测试之后。Prefab 测试应集中到运行后半段，以减少上下文切换。

### 4.3 场景复用

一次 `runAll` 只创建一次固定测试场景：

```text
db://assets/__dev_test__/TestScene.scene
```

Scene 测试共享该场景，但每个测试负责登记自己创建的节点和资源。测试之间不重新创建场景。

如果某个测试需要完全干净的节点环境，优先删除并重建该测试创建的节点，而不是重建整个场景。

Prefab 测试如需创建 Prefab 资源，应在共享 TestScene 中准备源节点，创建 Prefab 后集中执行相关测试。只有真正需要进入 Prefab 编辑器的测试才调用 `load_prefab`。

## 5. 测试 Session 设计

新增测试运行级 Session，负责共享场景和资源生命周期。建议抽象为：

```text
interface TestSession {
  scenePath: string
  initialEditorContext: EditorContextSnapshot
  trackedNodeUuids: Set<string>
  trackedAssetUrls: Set<string>
  currentPrefabPath?: string

  ensureSceneContext: () => Promise<void>
  ensurePrefabContext: (prefabPath: string) => Promise<void>
  exitPrefabContext: () => Promise<void>
  trackNode: (uuid: string) => void
  trackAsset: (url: string) => void
  cleanup: () => Promise<void>
}
```

`TestContext` 暴露最少的资源登记 API：

```text
interface TestContext {
  ...
  trackNode(uuid: string): void
  trackAsset(url: string): void
}
```

测试创建资源后立即登记：

```text
const nodeUuid = ...
ctx.trackNode(nodeUuid)

const prefabPath = ...
ctx.trackAsset(prefabPath)
```

清理顺序建议为：

```text
退出 Prefab 编辑模式
  -> 删除 Prefab 实例节点
  -> 删除普通测试节点
  -> 删除测试 Prefab 和其他资产
  -> 删除测试 Scene
  -> 恢复初始编辑器上下文
```

清理必须尽力执行，单个资源删除失败不能阻止后续资源清理。

## 6. Prefab 上下文管理

### 6.1 先确认正式 API

在实现前需要确认 Cocos Creator 3.8.6 中：

1. `asset-db/open-asset` 打开 Prefab 后，如何判断当前已经进入 Prefab 编辑模式；
2. 如何通过已注册 IPC 退出 Prefab 编辑模式；
3. 退出时是否需要保存、放弃修改或等待场景就绪；
4. `scene/query-current-scene` 在 Prefab 编辑模式下返回什么；
5. 当前打开的 Prefab 是否能通过 Asset DB 或 Scene 消息可靠识别。

不得直接引入未经验证的 `scene/close-prefab`、`scene/leave-prefab` 等消息名。

### 6.2 每个 Prefab 测试的 finally

Prefab 测试必须由 Runner 负责上下文恢复，而不是依赖测试作者手写清理：

```text
try {
  await test.run(ctx)
}
finally {
  if (test.environment === 'prefab') {
    await session.exitPrefabContext()
  }
}
```

即使测试断言失败，也必须执行退出逻辑。

`runAll` 和 `runOne` 外层还需要再执行一次兜底：

```text
finally {
  await session.exitPrefabContext().catch(() => undefined)
  await session.cleanup().catch(() => undefined)
  await session.restoreInitialContext().catch(() => undefined)
}
```

## 7. 测试分类建议

### 7.1 `scene`

以下测试应明确标记为 `scene`：

- 节点创建、删除、查询；
- 组件添加、删除、属性读写；
- 场景树和节点引用测试；
- `mcp_reliability_01:remove_component_identity_guidance`；
- `mcp_reliability_02:attach_missing_asset_recovery`；
- Prefab 资源的创建、校验、实例化和引用查询，只要它们是在普通 Scene 中操作，而不是测试 Prefab 编辑器本身。

### 7.2 `prefab`

仅以下情况标记为 `prefab`：

- 测试 `prefab_browse.load` 是否打开 Prefab 编辑器；
- 测试 Prefab 编辑模式下的查询或编辑行为；
- 测试必须在 Prefab 内部操作节点才能验证的功能。

`batch4_05:prefab_browse_load_opens_prefab_editor` 属于 `prefab`，并且建议放在 Prefab 阶段靠后位置。

### 7.3 `agnostic`

适用于：

- 纯协议、Schema、工具注册和错误结构测试；
- 不依赖当前 Scene 的查询测试；
- 能完全通过 mock 或静态数据完成的测试。

## 8. Runner 改造步骤

### 阶段一：生命周期安全修复

目标是先解决上下文污染，不改变共享方式：

1. 确认 Prefab 退出 IPC 和当前上下文检测方式；
2. 为会打开 Prefab 的测试增加 `environment: 'prefab'`；
3. 在 `execute()` 的 finally 中退出 Prefab；
4. 在 `runAll()` 和 `runOne()` 外层增加最终兜底清理；
5. 修正 `teardownTestScene()`，确保 Prefab 退出后再删除资源；
6. 暂时保留现有每测试 setup/teardown，先验证状态恢复正确。

验收：Prefab 测试失败后，下一次 Scene 测试仍能在普通 Scene 中运行。

### 阶段二：引入环境分组

1. 给 metadata 增加 `environment`；
2. Runner 按 `agnostic -> scene -> prefab` 顺序执行；
3. Scene 测试开始前调用 `ensureSceneContext()`；
4. Prefab 测试开始前调用 `ensurePrefabContext()`；
5. 每个 Prefab 测试结束后退出 Prefab；
6. 更新测试报告显示测试环境和当前阶段。

验收：完整运行时，所有 Scene 测试都在 Prefab 阶段前完成。

### 阶段三：共享 TestSession

1. `runAll` 只调用一次 `setupTestScene()`；
2. 所有普通 Scene 测试共享场景；
3. 测试通过 `trackNode`、`trackAsset` 登记资源；
4. Prefab 测试集中运行；
5. 统一清理资源和恢复上下文；
6. `runOne` 保持独立 Session，避免依赖 `runAll` 残留。

验收：完整测试运行不再为每个测试重新创建 TestScene，且资源数量不会持续增长。

## 9. 错误恢复策略

### 测试内部失败

- 记录失败结果和 stack；
- 继续执行当前测试的 finally；
- 删除该测试已登记资源；
- 恢复到该测试所属环境。

### 测试 Session 初始化失败

- 不执行依赖 Scene 的测试；
- 返回明确的 setup failure；
- 仍执行全局 Prefab 退出和编辑器上下文恢复。

### 全部测试中途异常

- 停止后续测试或按现有策略继续；
- 最外层 finally 退出 Prefab；
- 清理已登记资源；
- 恢复初始编辑器状态。

## 10. 性能预期

目标不是每个测试完全隔离，而是：

- `runAll` 只创建一次 TestScene；
- Scene 测试期间不打开/关闭 Prefab；
- Prefab 测试集中执行；
- 只在测试确实需要时创建 Prefab；
- 只在测试确实需要时进入 Prefab 编辑模式；
- 退出 Prefab 时等待必要的编辑器稳定时间，但不做无意义的场景重载。

预计相比“每个测试创建/删除场景”的模式，完整运行会减少大量 Asset DB 导入和场景切换开销，同时降低跨测试状态污染。

## 11. 验收清单

### 功能

- [ ] Scene 测试不会在 Prefab 编辑模式运行。
- [ ] Prefab 测试成功时退出 Prefab。
- [ ] Prefab 测试断言失败时退出 Prefab。
- [ ] Prefab 测试抛异常时退出 Prefab。
- [ ] `runAll` 中途异常时退出 Prefab并清理资源。
- [ ] `runOne` 不依赖上次运行的 Scene/Prefab 状态。
- [ ] 测试结束后恢复运行前的编辑器上下文。

### 资源

- [ ] 测试节点被删除。
- [ ] 测试 Prefab 被删除。
- [ ] 测试目录不会持续累积无主资源。
- [ ] 清理失败不会阻止其他资源继续清理。

### 性能

- [ ] `runAll` 不为每个测试重复创建 TestScene。
- [ ] 普通 Scene 测试之间不发生 Prefab 切换。
- [ ] 只有 Prefab 测试进入 Prefab 编辑模式。
- [ ] 完整运行耗时和场景切换次数有记录。

### 回归

- [ ] `mcp_reliability_01:remove_component_identity_guidance` 在普通 Scene 中通过。
- [ ] `mcp_reliability_02:attach_missing_asset_recovery` 在普通 Scene 中通过。
- [ ] `batch4_04:prefab_create_and_validate_complete_asset` 在普通 Scene 中通过。
- [ ] `batch4_05:prefab_browse_load_opens_prefab_editor` 在 Prefab 阶段通过并退出编辑器。
- [ ] 全部 Dev Test 连续运行两次，第二次不受第一次上下文和资源残留影响。

## 12. 实施顺序

1. 只读确认 Cocos Creator Prefab 编辑模式的进入、检测和退出 API。
2. 在不改共享 Session 的情况下，先增加 Prefab finally 和全局兜底恢复。
3. 为现有测试补充 `environment` 标记。
4. 按环境拆分 `runAll` 执行顺序。
5. 引入共享 TestSession 和资源登记。
6. 删除旧的每测试 Scene setup/teardown 依赖。
7. 连续运行全部测试并检查资源、编辑器上下文和耗时。

在第 1 步 API 确认完成前，不修改 Runner 的 Prefab 操作消息名。
