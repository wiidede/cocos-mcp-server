# MCP Streamable HTTP-only 实施计划

## 目标

将 Cocos MCP Server 设计为一个只实现 MCP Streamable HTTP transport 的服务端。第一阶段不实现更早的 HTTP+SSE transport，但支持最近几代使用 Streamable HTTP 的协议版本。

目标协议边界：

```text
Transport: Streamable HTTP
Protocols: 2025-03-26, 2025-06-18, 2025-11-25, 2026-07-28
Endpoint: POST /mcp
```

`2025-03-26`、`2025-06-18` 和 `2025-11-25` 使用 legacy initialization-based protocol profile；`2026-07-28` 使用 modern per-request metadata profile。两个 profile 共享 Streamable HTTP transport、JSON-RPC dispatcher 和工具执行层。

工具层继续使用当前已经完成规范化的 `UnifiedTools` API。协议层负责可靠地把 MCP 请求传递到工具层，不改变工具名称、action 或 Editor IPC 实现。

## 规范依据

本计划以 MCP 官方 `2026-07-28` 规范为准：

- [Introduction](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)
- [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)

`2024-11-05` 是旧的 HTTP+SSE transport，本阶段不支持。`2025-03-26`、`2025-06-18` 和 `2025-11-25` 属于 legacy 时代，但使用 Streamable HTTP；`2026-07-28` 是 modern 时代。本阶段支持后面四个版本，但只有通过对应 transport 和 protocol profile 测试的版本才能进入 `supportedVersions`。

服务端必须对不支持的版本返回明确的 `UnsupportedProtocolVersionError`，不把请求静默降级到另一个版本。

## 非目标

本阶段不实现：

- `2024-11-05` 旧版 HTTP+SSE 的独立 `GET /sse` endpoint。
- `POST /messages?sessionId=...` 旧消息 endpoint。
- 为 `2024-11-05` 实现旧版 SSE endpoint event 和独立连接生命周期。
- 按 Pi MCP adapter 版本设计协议行为。
- 为历史版本增加长期兼容别名。

本阶段需要实现：

- `2025-03-26`、`2025-06-18`、`2025-11-25` 的 legacy `initialize` session profile。
- `2026-07-28` 的 modern `server/discover` 和 per-request metadata profile。
- 同一个 Streamable HTTP endpoint 上两个 profile 的并发处理。

Pi MCP adapter `2.15.0` 和最新版只能作为真实客户端回归对象，不能作为协议定义来源。

## 设计原则

### 单一 transport

服务端只提供当前 Streamable HTTP MCP endpoint：

```text
POST /mcp
```

每个 JSON-RPC request 或 notification 都是独立的 HTTP POST。客户端必须声明同时接受：

```text
Accept: application/json, text/event-stream
```

服务端可以返回单个 JSON response 或请求范围内的 SSE response stream。第一阶段的工具调用可以优先返回 JSON；transport 仍需正确接受 SSE 能力声明，并为后续请求级 SSE 扩展保留接口。

### 支持的协议版本

服务端支持以下 Streamable HTTP 协议版本：

```text
2025-03-26
2025-06-18
2025-11-25
2026-07-28
```

其中前三个版本使用 legacy profile：通过 `initialize` 协商版本，并在 HTTP session 中保存协商结果。`2026-07-28` 使用 modern profile：通过 `server/discover` 和每请求 `_meta` 声明版本，不依赖 `initialize` 建立协议会话。

服务端不支持 `2024-11-05` 的旧 HTTP+SSE transport。对于不支持的版本，返回：

```json
{
  "error": {
    "code": -32022,
    "message": "Unsupported protocol version",
    "data": {
      "requested": "2024-11-05",
      "supported": [
        "2025-03-26",
        "2025-06-18",
        "2025-11-25",
        "2026-07-28"
      ]
    }
  }
}
```

`supportedVersions` 只列出已经通过对应 transport 测试的版本。

### Legacy 与 modern profile

两个 profile 共享 `/mcp` 和 Streamable HTTP，但请求入口不同：

```text
2025-03-26 / 2025-06-18 / 2025-11-25:
initialize -> notifications/initialized -> session requests

2026-07-28:
server/discover -> per-request metadata -> stateless modern requests
```

现代请求的时代判断依据是请求是否包含合法的 modern `_meta`；不能仅因为请求带有 `MCP-Protocol-Version` header 就把它归类为 modern。`initialize` 请求选择 legacy profile。

## 目标请求流程

### 服务发现

客户端可以发送：

```http
POST /mcp
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: server/discover
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

服务端返回当前支持版本、工具能力和 server instructions。

### 工具列表

```text
POST /mcp
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/list
```

请求 body 的 `_meta` 版本必须和 header 一致。返回当前 `UnifiedTools` 过滤后的工具列表和现代结果 envelope。

### 工具调用

```text
POST /mcp
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: cocos_creator_scene_lifecycle
```

`Mcp-Name` 必须与 `tools/call.params.name` 一致。非 ASCII 或不安全的 header 值按官方 Base64 sentinel 规则解码后再比较。

## 实现分层

### `StreamableHttpTransport`

职责：

- 只处理 `/mcp` 的 HTTP transport。
- 接收 POST JSON-RPC request/notification。
- 校验 `Origin`，本地服务只绑定 `127.0.0.1`。
- 校验 `Accept` 是否包含 `application/json` 和 `text/event-stream`。
- 设置正确的响应 `Content-Type` 和 HTTP status。
- 支持 JSON response，并为请求级 SSE response 保留实现入口。
- 将取消和断开连接传递给请求处理。
- 不执行工具业务逻辑。

### `LegacyProtocolProfile`

职责：

- 支持 `2025-03-26`、`2025-06-18` 和 `2025-11-25`。
- 处理 `initialize` 和 `notifications/initialized`。
- 根据客户端请求版本选择一个服务端支持的 legacy 版本。
- 为 HTTP session 保存协商后的版本、client info 和 capabilities。
- 在 session 生命周期内路由 `tools/list` 和 `tools/call`。
- 按对应历史 Streamable HTTP 版本处理 session headers、GET/DELETE 语义和通知行为。

### `ModernProtocol2026`

职责：

- 处理 `2026-07-28` 的 `server/discover`。
- 校验每请求 `_meta`。
- 校验 `MCP-Protocol-Version` 与 `_meta` 版本一致。
- 校验 `Mcp-Method` 与 JSON-RPC method 一致。
- 对 `tools/call` 校验 `Mcp-Name`。
- 返回 `UnsupportedProtocolVersionError`、`HeaderMismatch` 等规范错误。
- 生成现代结果 envelope、`structuredContent` 和 server metadata。

### `JsonRpcDispatcher`

职责：

- 校验 JSON-RPC request/notification。
- 路由 `server/discover`、`initialize`、`tools/list`、`tools/call`。
- 对未知 method 返回对应的 JSON-RPC method-not-found 错误。
- 保持协议错误与工具执行错误分离。
- 调用现有 `UnifiedTools`，不直接调用 Cocos IPC。

### `UnifiedTools`

保持现状：

- 继续暴露规范化的公开工具和 action。
- 继续使用 action-specific schema。
- 继续由 `tools/list` 提供唯一公开契约。
- 不加入协议版本判断。

## 实施阶段

### Phase 1：建立协议核心类型和请求 profile

- 定义支持版本常量：`2025-03-26`、`2025-06-18`、`2025-11-25`、`2026-07-28`。
- 定义 `LegacyProtocolProfile` 和 `ModernProtocol2026`。
- 删除“所有请求都按 legacy”或“仅按 header 判断 modern”的模糊逻辑。
- 定义统一的内部请求模型，包含 `protocolVersion`、`era`、`sessionId` 和 JSON-RPC request。
- 定义 modern request metadata、legacy session metadata、HTTP routing headers 和协议错误类型。
- 将协议版本、transport、session 和 JSON-RPC dispatch 分离。
- 保留 `server/discover` 作为 modern 服务发现入口。

验收：内部请求 profile 能区分四个支持版本、`initialize` legacy 请求、合法 modern request、缺少 `_meta` 的 request 和未知版本 request。

### Phase 2：重构 `/mcp` Streamable HTTP handler

- 保留 `POST /mcp` 为主要 MCP endpoint。
- 根据 `initialize` 或 modern `_meta` 选择 protocol profile。
- 为 legacy profile 管理 `Mcp-Session-Id` 和协商后的协议版本。
- 校验 modern 请求的 `Origin`、`Accept`、`MCP-Protocol-Version`、`Mcp-Method`。
- 对 modern `tools/call` 校验并解码 `Mcp-Name`。
- 按各 legacy Streamable HTTP 版本处理需要的 session GET、DELETE、reconnect 和 notification 行为。
- 对协议校验失败返回规范 HTTP status 和 JSON-RPC error。
- 明确拒绝 `2024-11-05` 的旧 `/sse` 和 `/messages` transport，不将其误判为当前 Streamable HTTP。

验收：legacy 客户端可以完成 initialize、tools/list、tools/call；modern 客户端可以完成 server/discover、tools/list、tools/call。

### Phase 3：现代结果和错误契约

- 统一 `resultType`、`structuredContent` 和 text compatibility content。
- 统一 `UnsupportedProtocolVersionError`、`HeaderMismatch` 和 method-not-found 错误。
- 保持工具执行失败与协议错误的不同层级。
- 为稳定工具补充 output schema 的实现评估，不阻塞第一阶段工具调用。

验收：协议错误可由客户端识别，工具错误仍能保留 `ToolResponse` 的机器可读结构。

### Phase 4：自动化测试矩阵

新增或重构 `source/mcp-server.test.ts`，覆盖：

成功路径：

- legacy `initialize` 协商四个支持版本中的三个 legacy 版本。
- legacy `notifications/initialized`。
- legacy `tools/list` 和 `tools/call`。
- modern `server/discover`。
- modern `tools/list` 和 `tools/call`。
- JSON response。
- notification `202`。
- session create、reuse、DELETE 和 reconnect（针对实际支持的 legacy profile）。
- 合法 `Origin` 和 Accept。

失败路径：

- 请求版本为 `2024-11-05`。
- 请求版本为未知值。
- modern 请求缺失 `_meta`。
- modern 请求缺失或不匹配 `MCP-Protocol-Version`。
- modern 请求缺失或不匹配 `Mcp-Method`。
- modern `tools/call` 缺失或不匹配 `Mcp-Name`。
- legacy 请求缺失或伪造 `Mcp-Session-Id`。
- 非法 `Origin`。
- 不满足 Accept 要求。
- 未知 JSON-RPC method。
- 旧 `GET /sse` 或 `POST /messages` transport 请求。

工具层回归：

- `scene_lifecycle.get_current`
- `scene_hierarchy.get_tree`
- 一个代表性只读工具
- 一个代表性写工具的契约错误

### Phase 5：真实客户端验收

- 使用支持 legacy Streamable HTTP 的客户端验证 `2025-11-25`，并覆盖至少一个更早的 Streamable HTTP 版本。
- 使用支持 modern Streamable HTTP 的客户端验证 `2026-07-28`。
- 用协议 fixture 覆盖全部四个声明支持的版本。
- 使用 Pi MCP adapter 的不同版本作为客户端兼容性观察，不改变服务端实现目标。

每个客户端至少验证：

- 连接 `/mcp`。
- legacy 客户端可以 initialize 并完成 initialized notification。
- modern 客户端可以获取 `server/discover`。
- 获取当前 `tools/list`。
- 调用 `scene_lifecycle.get_current`。
- 调用 `scene_hierarchy.get_tree`。
- 不出现 404 `/mcp`、`HeaderMismatch`、错误 session 或协议版本静默降级。

### Phase 6：文档和配置收敛

- 更新 `README.md` 和 `README.EN.md`，明确支持 Streamable HTTP 的四个协议版本。
- 更新 `TOOLS.md`，区分 MCP transport、legacy/modern protocol profile 和 `directTools`。
- 更新会话错误报告，说明 `2024-11-05` HTTP+SSE 不属于当前支持范围。
- 在 `.mcp.json` 示例中保留标准 HTTP URL；`directTools` 作为客户端显示策略单独说明。
- 不在文档中声称支持未通过对应 transport 测试的历史版本。

## 验收标准

完成后必须满足：

```text
只提供 Streamable HTTP endpoint
支持 2025-03-26 / 2025-06-18 / 2025-11-25 / 2026-07-28
不支持 2024-11-05 的旧 HTTP+SSE
legacy 请求可以 initialize 并建立 session
modern 请求可以 server/discover 并携带 per-request metadata
每个现代请求都能验证 _meta 和 HTTP routing headers
server/discover 成功
tools/list 成功并返回规范化工具
tools/call 成功
协议错误返回明确的机器可读错误
未知版本不会静默降级
旧 /sse 和 /messages 不会被误报为当前 transport
PI adapter 版本差异不会改变服务端协议判断
```

同时通过：

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

以及 Cocos Creator Dev Test Panel 的完整回归套件。

## 后续扩展

如果实际用户需要兼容 `2024-11-05` 客户端，后续新增独立的 legacy HTTP+SSE transport 模块，而不是修改当前 Streamable HTTP profile：

```text
LegacyHttpSseTransport
├── GET /sse
└── POST /messages
```

该扩展需要单独实现旧版 session、endpoint event 和 SSE 生命周期，并单独加入 supported/compatibility 测试。它不属于本阶段目标。
