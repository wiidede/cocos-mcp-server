# Cocos MCP 会话错误报告（2026-07-28）

后续会话统一按照 [MCP 会话可靠性评估规范](mcp-session-reliability-evaluation.md) 采集、分类并与本报告基线比较。

## 范围与方法

- 会话文件：`/Users/wangziyu/.pi/agent/sessions/--Users-wangziyu-github-cozy-farm--/2026-07-28T16-10-20-264Z_019fa97d-c6e7-737e-be01-73c7cbfd67ef.jsonl`
- 文件规模：1,595 条 JSONL 记录，6,010,520 字节。
- 筛选条件：`details.server == "cocos-creator"` 且 `details.mcpResult.isError == true`。
- 通过 `toolCallId` 将每条错误与原始 MCP 调用参数关联，不依赖文本推测。
- 协议参考：MCP `2026-07-28` 规范。

## 摘要

本次会话共有 **104 次 Cocos MCP 调用失败**，包含 **54 种不同错误信息**。

| 类别         | 数量 |  占比 | 判断                                                                              |
| ------------ | ---: | ----: | --------------------------------------------------------------------------------- |
| 参数契约错误 |   89 | 85.6% | 多数是模型未遵循 schema，但受到命名不一致、重复猜测和客户端 schema 支持情况的放大 |
| 资产错误     |   11 | 10.6% | 其中 9 次源于已确认的公开 schema 与内部实现矛盾                                   |
| 组件错误     |    4 |  3.8% | 主要是场景状态或组件身份错误                                                      |

结论不是简单的“AI 不会传参数”或“MCP 全有问题”，而是多种原因叠加：

1. **已确认的服务端缺陷**：`asset_query.details` 和 `project_query.asset_details` 的公开 schema 要求 `urlOrUUID`，但路由到的旧实现要求 `assetPath`。模型按 schema 修正后仍失败了 9 次。
2. **模型重复忽略修正信息**：`asset_manage.import` 连续 12 次携带不支持的 `overwrite: true`，尽管每次错误都明确要求删除该字段。这更接近模型/客户端恢复失败、旧 schema 缓存或 `oneOf` schema 兼容性问题。
3. **API 词汇容易诱发猜测**：同类资产标识使用 `uuid`、`url`、`path`、`assetPath`、`urlOrUUID`；日志搜索使用 `pattern`，模型反复选择 `query`；节点操作在 `uuid` 和 `nodeUuid` 之间切换。
4. **错误恢复机制没有被采用**：错误要求调用 `tool_registry.describe`，模型多数时候却继续猜 action 或字段；唯一一次 registry 错误也是调用参数不完整。
5. **当前 MCP 服务仍是旧协议实现**：代码固定为 `2024-11-05`，尚未实现 `2026-07-28` 的每请求元数据、`server/discover`、HTTP header 校验及新错误模型。

## 按工具统计

| 工具                   | 错误数 | 主要模式                                                                |
| ---------------------- | -----: | ----------------------------------------------------------------------- |
| `asset_query`          |     27 | action/字段猜错 20 次；确认的 `urlOrUUID` 到 `assetPath` 路由矛盾 7 次  |
| `asset_manage`         |     13 | `import` 重复传入不支持的 `overwrite` 12 次；猜测 `targetUrl` 1 次      |
| `project_query`        |      9 | 使用错误的 `assetPath`/`path` 7 次；按 schema 修正后触发路由矛盾 2 次   |
| `project_manage`       |      6 | 缺少 action 3 次；`refresh_assets` 使用 `path`/`url` 而非 `folder` 3 次 |
| `component_property`   |      5 | 缺少 action 1 次；脚本组件不存在 3 次；组件/目标身份错误 1 次           |
| `debug_logs`           |      4 | 使用 `query` 而非 `pattern` 4 次                                        |
| `scene_query`          |      4 | 猜测了未暴露的 action 或过滤参数                                        |
| `component_available`  |      3 | 缺少 action 1 次；不支持的 `search` 2 次                                |
| `component_query`      |      3 | 全部缺少 action                                                         |
| `debug_scene`          |      3 | 混用了其他 action 的参数，或猜测 `tree` action                          |
| `node_query`           |      3 | 猜测 `get`/`get_node`，实际为 `get_info`                                |
| `scene_hierarchy`      |      3 | 猜测 `get_hierarchy`/`get_children`，实际为 `get`                       |
| `scene_view_query`     |      3 | 猜测 `get`/`get_state`，实际是多个细分状态 action                       |
| `asset_analyze`        |      2 | 字段错误 1 次；公开功能实际不可用 1 次                                  |
| `node_lifecycle`       |      2 | 缺少 action                                                             |
| `node_transform`       |      2 | 缺少 action 1 次；使用 `nodeUuid` 而 action 要求 `uuid` 1 次            |
| `project_build_system` |      2 | action/参数不匹配                                                       |
| `scene_management`     |      2 | `save` 携带不支持的 `scenePath` 等契约错误                              |
| `scene_snapshot`       |      2 | 缺少 action；传入不支持的 `label`                                       |
| 其余 6 个工具          |      6 | 各 1 次                                                                 |

## 主要错误链路

### 1. `asset_manage.import` 携带 `overwrite`（12 次）

代表调用：

```json
{
  "action": "import",
  "sourcePath": "/Users/wangziyu/github/cozy-farm/art/exports/glb/crop_radish_seed.glb",
  "targetFolder": "db://assets/art/models",
  "overwrite": true
}
```

服务端返回：`Action 'import' for asset_manage does not accept: overwrite`，并明确给出允许字段为 `action`、`sourcePath`、`targetFolder`。

判断：按当前公开契约，拒绝行为正确。完全相同的非法参数重复 12 次，主要是客户端/模型恢复失败。但 `overwrite` 是导入操作的自然选项，在相邻资产 API 中存在，而且位于工具的扁平兼容 properties 中，因此当前 schema 也容易误导模型。应明确选择一种方案：让 import 支持该参数，或从所有可能暴露给模型的 schema 层和描述中移除它。

### 2. 资产详情 schema 与实现矛盾（9 次）

符合公开 schema 的调用：

```json
{
  "action": "details",
  "urlOrUUID": "db://assets/scripts/gameplay/FarmLoop.ts",
  "includeSubAssets": false
}
```

执行层返回：`get_asset_details requires assetPath and optional includeSubAssets`。

这是确定的服务端缺陷。`source/tools/unified-tools.ts` 中两个公开 action 都路由到旧的 `project_get_asset_details`；`source/tools/project-tools.ts` 中该操作仍校验 `args.assetPath`。所以不存在能够同时通过公开契约和内部实现的参数。模型先尝试 `assetPath` 时被公开契约拒绝，改为正确的 `urlOrUUID` 后又被内部实现拒绝。

### 3. 资产标识猜测（20 次契约错误）

模型在以下字段间反复切换：

- `asset_query.details`：`assetPath` 6 次、`url` 3 次，之后改为合法 `urlOrUUID`，但触发上述服务端 bug。
- `project_query.asset_details`：`assetPath` 4 次、`path` 2 次，之后合法 `urlOrUUID` 同样触发 bug。
- `asset_query.query_url`：使用 `url` 3 次和 `urlOrUUID` 1 次，而该 action 实际要求 `uuid`。
- `asset_query.query_path`：使用 `assetPath` 1 次，而该 action 实际要求 `uuid`。

`query_url` 在实现中的含义是“根据 UUID 获取 URL”，但模型很自然地将其理解成“用 URL 查询”。建议改为明确的 `get_url_by_uuid`、`get_uuid_by_url`，或者合并成接受统一 `identifier` 的 lookup action 并返回所有已知标识。

### 4. 缺少 `action`（13 次）

涉及 `component_query` 3 次、`project_manage` 3 次、`node_lifecycle` 2 次，以及 `component_available`、`component_property`、`node_transform`、`scene_snapshot` 等。

服务端错误中已经给出 action enum，但模型有时是在故意“探测”参数。一次探测甚至真实创建了 `__invalid__` 节点，随后才删除。只读契约发现不应该依赖调用有副作用的工具。

可能原因包括：

- 客户端传给模型的 schema 没有突出显示 `action` 必填。
- 客户端或模型对根级 properties 加 `oneOf` 分支的支持不完整。
- 扩展重建/重载后，当前会话仍缓存旧版 `tools/list`。
- 工具数量和 action 数量太多，模型将空调用当作 discovery。

### 5. 猜测通用 action

常见猜测包括 `get`、`get_node`、`get_hierarchy`、`get_children`、`get_state`、`query`、`search`、`tree`。这些语义上合理，但不是当前 enum 值。说明 action 命名过多且缺乏统一规律，不能期待模型脱离 schema 准确记忆。

## 非契约执行错误

| 数量 | 错误                                          | 判断                                               |
| ---: | --------------------------------------------- | -------------------------------------------------- |
|    9 | 合法 `urlOrUUID` 调用后仍提示需要 `assetPath` | 已确认的路由缺陷                                   |
|    3 | 目标节点上找不到 `GrayboxWorld` 组件          | 场景状态、脚本编译或挂载问题；写入前应查询实际组件 |
|    1 | 组件引用设置解析到错误组件身份                | 需要复查 component instance/type 契约              |
|    1 | 脚本资产在 Cocos asset database 中不可用      | 可能是资产刷新时序或编译失败                       |
|    1 | 依赖分析所需 API 未实现                       | 不可用功能被作为可调用 action 暴露                 |

资产依赖分析如果必然返回“当前实现不支持”，就不应出现在公开 action enum 中。应在 registry 中标记 unsupported，并像现有其他不支持 action 一样从 `tools/list` schema 中移除。

## MCP 2026-07-28 协议差距

当前仓库只实现了旧版 MCP `2024-11-05` 的一小部分：

- 固定 `PROTOCOL_VERSION = '2024-11-05'`。
- 只处理 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`。
- 客户端请求任何其他版本时，初始化响应仍静默返回 `2024-11-05`。
- HTTP POST 不要求现代 MCP request headers。
- 工具结果仅作为 JSON 字符串放在 text content 中。

`2026-07-28` 已发生较大协议变化：

| 领域              | 2026-07-28 要求                                                   | 当前状态                              |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------- |
| 版本机制          | 每个请求在 `_meta` 携带版本；HTTP 同时使用 `MCP-Protocol-Version` | 缺失                                  |
| 服务发现          | 服务端必须实现 `server/discover`                                  | 缺失                                  |
| 不支持版本        | 返回 `-32022`，包含 requested 与 supported                        | 缺失；当前静默降级                    |
| 请求元数据        | client info 和 capabilities 改为每请求携带                        | 缺失                                  |
| HTTP headers      | 校验 `Mcp-Method`、`Mcp-Name`、版本及 header/body 一致性          | 缺失                                  |
| HTTP 协商         | 客户端接受 JSON 与 SSE；服务端可返回 JSON 或请求级 SSE            | 当前仅 JSON                           |
| 未知方法状态码    | 现代 HTTP 返回 404 加 JSON-RPC `-32601`                           | 当前 dispatch 后仍 HTTP 200           |
| Origin 安全       | 非法 Origin 必须返回 HTTP 403                                     | 当前行为需进一步审查                  |
| 工具列表          | 顺序稳定；支持 pagination/caching 语义                            | 顺序基本稳定，但无 pagination/caching |
| 工具输出          | 支持 `structuredContent`；声明 `outputSchema` 时必须匹配          | 仅 text JSON，无 output schema        |
| 现代结果 envelope | 结果包含 `resultType`，server info 位于结果 metadata              | 仍是 legacy 结果形状                  |
| 动态列表通知      | 声明后通过现代 subscription stream 发送                           | 未声明、未实现                        |

这应当被视为“双协议时代的 transport/protocol 重构”，不能只修改版本常量。仅把版本字符串改成 `2026-07-28` 会让服务端不符合规范并破坏客户端。

## 建议实施计划

### Phase 1：修正工具契约与可观测性

1. 修复 `urlOrUUID`/`assetPath` 矛盾，并为两个公开 wrapper 添加回归测试。
2. 决定 `asset_manage.import.overwrite` 是否支持，使 ActionSpec、生成 schema、实现和测试保持一致。
3. 从公开 schema 移除依赖分析等确定不可用的 action。
4. 增加契约测试：将每个 action example 实际送入公开 dispatcher，至少执行到能发现 legacy 参数名不一致的位置，而不只测试当前 contract guard。
5. 为错误增加稳定的机器可读 code，并在 structured result 中返回 attempted/allowed arguments。

### Phase 2：简化工具 API

1. 按领域统一 `uuid`、`nodeUuid`、`assetUuid`、URL 的命名和转换方向。
2. 重命名含糊的 `query_url`、`query_uuid`、`query_path`，或合并为统一 lookup。
3. 减少 `asset_query` 与 `project_query`、多组资产管理 wrapper 的重叠。
4. 对高频操作考虑拆成独立 MCP 工具。一个工具包含大量 `oneOf` action 分支在 JSON Schema 上合法，但不同客户端/模型支持程度不一，本次记录显示 discriminator 没有被可靠遵循。
5. 保留 `tool_registry` 用于诊断，但不要把它作为基本参数恢复的唯一途径。

### Phase 3：双时代 MCP transport

1. 将现有 `2024-11-05` 行为保留在 legacy adapter 中，避免破坏已有客户端。
2. 新增 `2026-07-28` modern adapter，实现 `server/discover`、每请求 metadata、必需 HTTP headers、校验与现代错误码。
3. 将 HTTP transport 校验、JSON-RPC method dispatch、tool execution 分层。
4. 添加现代成功、不支持版本、缺失/不匹配 headers、未知 method、notification 和 legacy fallback 的协议 fixture。
5. 增加 `structuredContent`，同时保留序列化 text 以兼容旧客户端；对稳定工具逐步增加 `outputSchema`。

### Phase 4：集成验证

1. 执行 `pnpm typecheck`、`pnpm test`、`pnpm build`。
2. 为依赖 Cocos Editor 的修复增加 Dev Test Panel regression。
3. 重放本报告中的代表性失败调用，确认每个调用要么一次成功，要么只需一次明确修正，不再重复猜测。
4. 扩展重载后使用全新客户端会话，排除旧 `tools/list` 缓存。

## 验收指标

- 公开 schema 与内部实现之间零参数名矛盾。
- 每个 supported action 的 example 都能通过公开 dispatch，并到达目标 legacy/editor operation。
- unsupported action 不出现在 `tools/list`。
- 重放 89 次契约错误时，要么首次形成合法调用，要么一次错误后正确修正；同一非法调用不重复超过一次。
- 现代协议测试覆盖 `2026-07-28` 所有必需 request metadata 和 HTTP headers。
- 双时代迁移期间，旧 `2024-11-05` 客户端继续通过现有测试。

## 协议资料

- [MCP 2026-07-28 introduction](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Lifecycle and versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Schema reference](https://modelcontextprotocol.io/specification/2026-07-28/schema)
