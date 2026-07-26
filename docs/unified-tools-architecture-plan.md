# Unified Tools 架构优化计划

> 状态：阶段 2 已完成；阶段 3 待补充自动化覆盖
> 范围：公共 MCP Unified Tools API；不改变已发布 legacy tool 的内部实现。

## 背景

Unified Tools 将大量细粒度 legacy tools 聚合为少量按领域划分的公共工具，以降低 MCP 初始化时携带的 tool schema 和上下文 token。

当前实现的核心模型是：每个 Unified Tool 具有 `action`，并将调用路由到 legacy executor。这一方向正确，但工具 schema 目前由该工具**所有 action 的参数并集**组成。模型可能因此看到与当前 action 无关的字段，例如 `scene_management.open` 同时暴露了其他 action 的参数。单靠 description 解释例外会增加歧义与维护成本。

## 目标

1. 保留 Unified Tools 的低数量、低初始化 token 优势。
2. 让模型无需猜测 action 的参数、必填字段或能力支持状态。
3. 让 action 描述、schema、示例、路由和失败提示尽可能来自同一份声明，避免能力描述漂移。
4. 保持公共 action 的兼容性；不为纯命名一致性进行破坏性重命名。

## 非目标

- 不重新暴露全部 legacy tools。
- 不全局强制统一既有 action 名称（如 `get`、`get_current`、`refresh_assets`）。它们处于不同 tool 命名空间，当前兼容性价值高于视觉统一性。
- 不把每个 action 的完整示例塞入所有顶层 tool description，避免抵消 token 节省。

## 当前问题

### 1. 参数并集而不是 action 契约

`UnifiedTools.createTool()` 当前接收 actions 和 property keys，并为整个工具生成统一 properties。这能表达 action enum，少数工具还通过 `anyOf` 表达必填参数，但无法表达：

- 某个 action 允许哪些可选字段；
- 另一个 action 的字段不应出现在当前 action 调用中；
- 每个 action 的专属说明和最小示例。

### 2. Description 承担过多精确规则

当前 description 既是概览，又记录 action、例外、兼容别名和样例。它有用，但不是可靠的机读契约；schema 仍可能暴露相互无关的字段。

### 3. 能力信息可能分散漂移

公共 Unified 描述、legacy tool 返回数据和实现可分别维护。例如 preview server 已不受支持时，其他工具的 `availableActions` 仍可能误称它可用。

## 分阶段方案

### 阶段 0：契约清理（已实施）

- `scene_management` 不再在 Unified schema 暴露与 `open` 容易混淆的通用 `path` 字段；`open` 使用 `scenePath`。
- `component_property` 明确：`propertyType: "component"` 可传组件实例 UUID，或承载目标组件的节点 UUID；后者会自动解析，例如 `cc.Camera` 属性可传 Camera 节点 UUID。
- `project_build_system.get_build_settings` 的 `availableActions` 仅列真正支持的操作；preview server 能力进入 `unsupportedActions` 并附原因。
- `project_runtime` 的公开 Unified actions 仅保留 `run`。不把没有 supported Cocos IPC 的 preview server action 宣传为可调用能力。
- 高风险或高频工具 description 只增加一个简短、可复制的最小示例；详情仍使用 `tool_registry.describe` 按需获取。

### 阶段 1：引入 ActionSpec（进行中）

已完成首批试点：

```ts
interface ActionSpec {
  name: string
  description: string
  properties: string[]
  required?: string[]
  example?: Record<string, unknown>
  legacyAction?: string
  deprecated?: boolean
}

interface UnifiedToolSpec {
  name: string
  description: string
  actions: ActionSpec[]
  execute?: (args: ToolArguments) => Promise<ToolResponse>
}
```

- `scene_management`
- `node_lifecycle`
- `node_transform`
- `node_query`
- `node_hierarchy`
- `component_manage`
- `component_query`
- `component_property`
- `project_manage`
- `project_query`
- `project_build_system`
- `project_runtime`
- `node_property_management`
- prefab 系列（`prefab_browse`、`prefab_lifecycle`、`prefab_instance`、`prefab_edit`）
- `asset_manage`
- `asset_query`
- `project_asset_system`
- `asset_analyze`
- `asset_batch`
- `asset_meta`
- `component_script`
- `component_event_binding`
- `component_available`
- `prefab_reference`
- `scene_hierarchy`
- `scene_execution_control`
- `scene_snapshot`
- `scene_query`
- `scene_view_control`
- `scene_view_query`

这些工具现在以 action-specific metadata 生成 `oneOf` schema 分支，并由 `tool_registry.describe` 返回 action 的说明、允许字段、必填字段与最小示例。

- `scene_undo_manage`（`begin` 使用 `requiredAnyOf` 表达 `nodeUuid` / `nodeUuids` 二选一）
- `node_clipboard`、`node_reference`
- `debug_console`、`debug_logs`、`debug_execute`、`debug_scene`、`debug_performance`
- `preferences_manage`
- `server_info`、`server_network`、`server_control`
- `broadcast_message`、`reference_image_manage`
- `validation_params`、`resource_reference`、`tool_registry`

全部公共 Unified Tools 现已拥有 action-specific `oneOf` schema 分支；后续阶段专注于从同一份 ActionSpec 自动生成更多文档、失败恢复与契约测试。

后续继续扩展 action 元数据（例如 `requiredAnyOf`、弃用/不支持状态）与自动化契约测试。

### 阶段 2：由 ActionSpec 自动生成公开契约（已完成）

- 顶层 MCP JSON Schema：`action` enum 和按 action 的 `oneOf` 约束；
- 顶层 description：统一以领域概览加由 ActionSpec 推导出的可调用 action 摘要收束；
- `tool_registry.describe`：每个 action 的说明、允许/必填参数、`requiredAnyOf`、最小 JSON example、deprecated/unsupported 状态与不支持原因；
- unsupported action：统一在 Unified 层返回结构化 `{ toolName, action, status, reason }` 与替代操作提示，且不进入公开 action enum / `oneOf`；
- 缺参、任选必填参数不足或 action 参数混用：在路由前根据 ActionSpec 返回精确 retry instruction。

在 MCP client 对 `oneOf` 支持不足时，仍保留扁平 properties 作为兼容层；`tool_registry.describe` 是完整的按需发现接口。

### 阶段 3：能力状态和文档测试（已完成）

- `supported`、`unsupported`、`deprecated` 已作为 ActionSpec metadata；`unsupported` action 带结构化原因且不会进入 public schema。
- 新增全量 contract test，遍历每个 public Unified Tool 和其 action，验证：
  - action enum、`oneOf` branch、flat compatibility properties 和 `tool_registry.describe` 输出一致；
  - required / `requiredAnyOf`、`additionalProperties: false` 及 discriminator 一致；
  - example（若存在）仅使用该 action 允许字段，并满足 required 条件；
  - 每个 supported action 都会在 legacy routing 前被统一 contract guard 识别；
  - unsupported action 具备明确 reason 且不会泄露到 public action enum。
- 顶层 description 的 action summary 纳入全量防回退断言；既有高风险 Cocos 能力限制仍保留关键断言。
- `TOOLS.md` 已遵循只说明稳定调用规则和工作流、以 `tools/list` / `tool_registry.describe` 为参数真相来源的原则，不复制易漂移参数表。

## API 与 token 策略

- 默认模型只看到简洁 Unified Tools，不要求每次调用 `tool_registry`。
- 常见操作应可仅凭顶层 description 与 schema 正确调用。
- 模型在复杂、低频或失败后调用一次 `tool_registry.describe`，拿到完整 action-specific contract，而不是反复试错。
- 每个顶层 description 最多保留一个最常见或最容易误用的 JSON example。

## 兼容性策略

- 既有 public action 默认不重命名。
- 若未来需要更好的名称，新增 alias 并标记旧名称 deprecated；同时提供迁移提示。
- 没有 supported Cocos IPC 的能力不列入公开 supported actions；如必须兼容旧入口，内部可返回明确的 unsupported-operation 响应。

## 验收标准

1. 所有公开 Unified Tool 的 `tool_registry.describe` 能返回每个 action 的必填参数、允许参数和最小 example（若定义）。
2. 顶层 schema 与 registry 均由同一 ActionSpec 生成，不再仅依赖 description 来纠正 action 参数歧义。
3. 不支持的能力不会出现在任意 public action enum / `oneOf` 中，并返回结构化 unsupported 信息。
4. 全量 contract test 防止 schema、registry、example、description action summary 或 dispatch guard 漂移。
5. `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
6. 旧 public action 调用在未声明弃用前保持兼容。
