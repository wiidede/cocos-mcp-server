# MCP 调用可靠性优化计划

> 状态：阶段 1 已开始；阶段 2、3、4 部分完成
> 范围：Cocos Creator MCP 公共工具的调用发现、参数校验、失败恢复和编辑器集成验证。
> 关联计划：`docs/unified-tools-architecture-plan.md`
> 参考样本：`/Users/wangziyu/.pi/agent/sessions/--Users-wangziyu-github-cozy-farm--/2026-07-27T17-45-06-793Z_019fa4ae-2fe9-7043-8907-cfe7bf0f93bf.jsonl`

## 背景

一次 Cozy Farm 调试 session 中，MCP 调用了 348 次，其中约 53 次明确失败。失败并不完全来自模型：一部分是节点、脚本资产或 Canvas 配置的真实状态问题；另一部分则来自 action 名称、参数契约和失败恢复信息不够明确。

典型表现包括：

- `asset_query` 使用了不存在的 `find` action；
- `debug_console` 使用了不存在的 `read` action；
- `project_runtime` 使用了未公开支持的 `preview` action；
- `query_url` 的公开参数信息与 action 实际允许字段不一致；
- `component_script.attach` 在脚本资产尚未刷新时返回失败，模型随后重复尝试；
- 删除组件时传入了组件类型/cid，而不是组件实例 UUID；
- 第一次操作失败后，模型没有始终按照提示先查询节点、组件或资产。

目标不是让模型“多试几次”，而是让第一次调用尽可能正确，并让失败结果提供唯一、可执行的下一步。

## 目标

1. 让 `tools/list`、`tool_registry.describe`、运行时 validator 和实际 executor 使用一致的 action-specific 契约。
2. 让模型能够区分：参数错误、目标不存在、资产未就绪、编辑器 IPC 失败和真实运行时错误。
3. 对常见失败返回明确的下一步、推荐工具和推荐参数，避免盲目重复调用。
4. 对节点、组件和资产操作建立稳定的“先查询、后写入”恢复流程。
5. 用自动化测试覆盖契约一致性和高频错误恢复，不依赖人工观察 session 才发现问题。

## 非目标

- 不通过兼容层接受所有模型猜测出的 action 或字段。
- 不把所有 legacy tools 重新暴露给 MCP client。
- 不隐藏真实的 Cocos Creator 编辑器或预览运行时错误。
- 不在没有证据的情况下增加重试、延迟或兼容分支。

## 问题分类与处理原则

### A. Action 名称猜错

示例：`status`、`current`、`find`、`read`、`preview`、`analyze`。

处理原则：

- public schema 只暴露 supported action；
- description 只列真实可调用 action；
- unsupported action 返回结构化替代信息，而不是让模型继续猜；
- 失败提示优先推荐 `tool_registry.describe`，但不要要求模型在简单调用前反复查询 registry。

### B. Action 参数混用

示例：`asset_query.query_url` 传入 `url`，但实际 action 只接受 `uuid`；`asset_query.list` 传入 `maxResults`，但 action 不接受该字段。

处理原则：

- 每个 action 生成独立 `oneOf` 分支；
- `additionalProperties: false` 与实际 validator 保持一致；
- `tools/list` 不再让工具级参数并集误导模型；
- 兼容扁平 schema 时，必须同步验证其描述不会暗示错误字段；
- `tool_registry.describe`、schema 和 validator 必须由同一份 ActionSpec 生成。

### C. 节点和组件身份错误

示例：对场景根节点 attach 脚本；删除组件时使用 component type/cid，而不是组件实例 UUID。

处理原则：

- 写操作失败时返回目标查询建议；
- 组件删除响应明确区分 `component.uuid`、`component.type` 和 `component.cid`；
- 对删除操作优先要求组件实例 UUID；
- 对需要节点 UUID 的工具，错误中明确说明“节点名不能代替 UUID”；
- 不在工具内部静默选择同名节点，避免写错目标。

### D. 资产未导入、未刷新或未注册

示例：`component_script.attach` 第一次添加脚本后，验证阶段没有发现脚本组件；刷新资产并确认 `query_path` 后再次 attach 才成功。

处理原则：

- attach 前检查脚本资产是否存在且可解析；
- 资产不存在时返回 `asset_query.query_path` 或 `project_manage.refresh_assets` 的明确下一步；
- attach 验证失败时不要只返回空的 Available components；
- 对同一参数重复 attach 前，应先查询资产和组件状态；
- 不用固定 sleep 掩盖编辑器异步状态，必要时使用有上限的 readiness/polling。

### E. 编辑器 IPC 或真实运行时错误

示例：Canvas 摄像机引用问题导致浏览器出现 `cameraPriority` null 错误；场景保存出现 timeout。

处理原则：

- MCP 工具错误与浏览器/编辑器 Console 错误分开报告；
- IPC 失败推荐 `debug_console.get` 或 `debug_logs.search`，并禁止猜测未注册的 Editor message；
- 场景写操作后执行明确的保存、重新加载和验证流程；
- 预览验证必须区分旧日志、当前页面和当前启动实例；
- 不把“暂时未复现”描述成“问题已修复”，除非有清空日志、重载和等待后的证据。

## 实施阶段

### 阶段 1：建立失败样本和指标

- [x] 将上述 session 中的失败调用整理为脱敏样本并完成初步分类。
- [x] 为 ToolResponse 增加可选的结构化失败 metadata：category、retryable、nextTool、nextAction、retryWith、attempted。
- [ ] 将上述 session 中的失败调用整理为可执行的脱敏 fixture。
- [ ] 为错误增加分类字段：`contract`、`target`、`asset`、`ipc`、`runtime`、`unknown`。
- [ ] 记录 `retryable`、`nextTool`、`nextAction` 和 `retryWith`（如适用）。
- [ ] 统计重复调用：相同 tool/action/关键参数在失败后是否无状态变化地重复。
- [ ] 将失败率、重复率和平均恢复调用次数作为后续回归指标。

### 阶段 2：统一 ActionSpec 和公开契约

- [ ] 检查所有 Unified Tool 的 ActionSpec 是否包含完整的 action-specific properties、required、requiredAnyOf 和 example。
- [ ] 确保 `tools/list` 和 `tool_registry.describe` 由同一份 ActionSpec 生成。
- [ ] 为所有 action 验证 `additionalProperties: false` 与 validator 行为一致。
- [ ] 对 unsupported/deprecated action 统一返回状态、原因和替代 action。
- [ ] 为高频工具补充最小可复制示例：`node_query`、`component_query`、`component_script`、`asset_query`、`project_manage`、`debug_console`。
- [ ] 检查兼容扁平 schema 不会把其他 action 的字段误认为当前 action 可用字段。

重点文件：

- `source/tools/unified-tools.ts`
- `source/tools/unified-tools.test.ts`
- `TOOLS.md`

### 阶段 3：改进目标查询和组件操作

- [x] 组件移除失败时返回查询建议和当前可用组件摘要。
- [x] 组件移除失败时明确要求不要无状态重复相同请求。
- [x] `component_script.attach` 在写入前查询目标节点，避免把无效节点 UUID 与资产问题混淆。
- [ ] 为其他高风险写操作补充 attach 前的节点存在性检查。
- [x] 为 `component_script.detach` 和 `component_manage.remove` 的公开契约补充组件实例 UUID/type/cid 使用说明和最小示例。
- [x] 删除目标不存在时返回节点当前组件摘要，包含 `uuid`、`type`，并通过摘要保留 `cid`/名称信息。
- [x] 对“节点不存在”和“节点存在但组件查询为空”使用不同错误消息。
- [ ] 对节点名称查询结果包含精确 UUID，并提示后续写操作必须使用该 UUID。
- [x] 在 `batch-6.ts` 增加并验证“查询组件 UUID → 执行删除 → 查询确认”的工具工作流。

重点文件：

- `source/tools/component-tools.ts`
- `source/tools/node-tools.ts`
- `source/tools/unified-tools.ts`

### 阶段 4：改进脚本资产 attach 流程

- [x] attach 验证失败时返回脚本路径、节点、实际组件列表和资产查询下一步。
- [x] attach 写入前通过 `asset-db.query-path` 检查脚本资产是否已注册。
- [x] 资产未注册时建议 `project_manage.refresh_assets`，并阻止 `create-component`。
- [ ] 从 `scriptPath` 解析并验证 `db://` 资产是否存在。
- [x] 资产不存在时明确建议 `project_manage.refresh_assets`，而不是直接重复 attach。
- [x] attach 后验证脚本组件；失败时返回资产状态、节点状态和实际组件列表。
- [ ] 对编辑器异步导入使用有上限的状态查询，避免无限等待或固定延迟重试。
- [ ] 验证 fallback `execute-scene-script` 仅调用已注册的 scene method，并在失败时说明限制。
- [ ] 增加脚本 attach 的 Dev Test 回归：未刷新资产、已刷新资产、重复 attach、错误节点 UUID。

### 阶段 5：完善错误响应和恢复协议

已完成第一版 metadata 接入：contract guard 和 legacy route failure 会返回分类、可重试性和下一步工具信息。后续继续补齐各 executor 的精确分类。

建议在不破坏现有 `{ success, data?, error? }` 的前提下增加可选字段：

```ts
interface ToolFailureMetadata {
  category: 'contract' | 'target' | 'component' | 'asset' | 'ipc' | 'runtime' | 'unknown'
  retryable?: boolean
  nextTool?: string
  nextAction?: string
  retryWith?: Record<string, unknown>
  attempted?: Record<string, unknown>
}
```

- [x] 统一 `toolFailure` 的 metadata 结构。
- [x] contract 错误返回允许字段、缺少字段和最小 example。
- [ ] target 错误返回查询工具及推荐 action。
- [ ] component 错误返回组件查询结果或查询建议。
- [ ] asset 错误返回资产查询/刷新建议。
- [ ] IPC 错误返回日志诊断建议。
- [ ] 对不可重试错误明确 `retryable: false`，避免模型重复调用。

### 阶段 6：测试和 session 回放

- [ ] 为每个 public Unified Tool 遍历所有 action，断言 schema、registry、validator 和 executor 对齐。
- [ ] 增加错误 fixture 测试，覆盖本计划列出的所有 session 错误。
- [ ] 增加重复调用测试：失败后返回的 `nextTool/nextAction` 应引导状态查询，而不是原调用。
- [x] 增加 component attach/remove 的 Dev Test regression，并从对应 `index.ts` 导出（`batch-6.ts`）。
- [ ] 用原 session 的调用序列做离线回放，比较优化前后的：
  - 首次成功率；
  - 相同参数重复率；
  - 平均恢复调用次数；
  - 因 action/参数猜错造成的失败数。
- [ ] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。

## 错误消息设计要求

错误消息应回答四个问题：

1. **失败在哪里**：tool、action、nodeUuid 或 asset URL。
2. **失败是什么**：参数不合法、目标不存在、资产未就绪、IPC 失败还是运行时错误。
3. **下一步做什么**：明确的工具和 action。
4. **重试时改什么**：给出字段和值来源，避免只说“请重试”。

推荐格式：

```text
[action] failed: <specific reason>.
Next: call <tool> with action=<action> to <query/refresh/verify>.
Then retry <original tool> only with <exact field/value source>.
Do not repeat the same request before the verification step succeeds.
```

## 验收标准

1. 任意 public action 的 schema 不展示其他 action 专属字段，或兼容层有明确且不会误导的行为。
2. `tools/list`、`tool_registry.describe`、ActionSpec 和运行时 validator 对同一 action 的允许/必填字段完全一致。
3. session 中记录的 action/参数错误均能在第一次失败后给出正确的下一步。
4. 脚本 attach 在资产未刷新时不会导致模型无状态重复 attach。
5. 组件删除错误能区分实例 UUID、type 和 cid，并提供正确查询结果。
6. 每个可恢复错误最多需要一次状态查询后重试；不可恢复错误不会建议盲目重试。
7. Dev Test 和单元测试覆盖节点、组件、资产、IPC 和运行时诊断路径。
8. `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
9. 不改变既有 public action 的兼容性；需要变更时提供 deprecated/迁移提示。

## 优先级

### P0

- action-specific schema 与 validator 一致性；
- `tools/list` / `tool_registry.describe` / ActionSpec 契约测试；
- attachScript 资产未就绪时的明确恢复提示；
- 组件删除时实例 UUID 与 type/cid 的区分。

### P1

- 结构化错误 metadata；
- 高频工具最小示例和恢复工作流；
- session fixture 回放和重复调用指标。

### P2

- 更完整的 IPC、预览和运行时错误诊断；
- 面向 MCP client 的错误恢复文档和可观测性报表。

## 完成定义

只有在以下条件同时满足时，本计划才可标记为完成：

- P0 项全部完成并有自动化测试；
- 原始 session 的关键失败序列能够离线回放；
- 回放中不存在由公开 schema 与实际 validator 不一致引起的错误；
- attach、remove 和资产刷新流程均能在一次明确查询后恢复；
- 构建、类型检查、测试和 Dev Test 回归全部通过。
