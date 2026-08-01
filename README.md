# Cocos Creator MCP Server

[English](README.EN.md) | [工具使用说明](TOOLS.md)

为 Cocos Creator 3.8.6+ 提供 MCP 服务，让 AI 客户端通过 HTTP 操作场景、节点、组件、预制体、资源和项目。

本项目 Fork 自 [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server)，持续修复并维护 MCP 工具与 Cocos 编辑器的集成。

## 相较原项目的主要改动

本版本不是简单的客户端适配或少量修复，而是对工具 API、MCP 协议、编辑器集成和开发流程进行了较大规模的重构：

- **工具与 API 重命名**：按“领域 + 能力”重新组织工具，统一使用 `get`、`list`、`find`、`check`、`set` 等明确 action；减少重复 wrapper、模糊的 `manage` / `query_*` 名称和重复操作。
- **统一工具注册表**：所有公开工具由统一注册表管理，每个 action 使用独立 schema，只暴露该操作允许的参数；通过 action-specific schema 降低工具选错、action 拼错和参数串用的概率；客户端可以通过 `tools/list` 获取实时契约，也可以通过 `tool_registry.describe` 查看必填字段、示例、弃用状态和能力状态。
- **MCP 协议升级**：使用 HTTP Streamable，支持 MCP `2026-07-28` 协议。
- **错误处理改进**：增加稳定的机器可读错误码，并在契约错误中返回 attempted/allowed 上下文，便于 AI 客户端自动修正参数。
- **资源 API 收敛**：新增 `asset_query.resolve_identity`，一次解析资源 URL、UUID 和文件系统路径；资源导入支持显式 `overwrite` 和冲突提示，旧转换 action 保持兼容但标记为 deprecated。
- **编辑器能力扩展**：补全项目、场景、节点、组件、预制体、资源、引用图片、构建和调试等工具，并修复多项 Cocos Creator Editor IPC、组件属性、预制体和资源引用问题。
- **节点和组件操作增强**：`node_lifecycle.create` 支持创建节点时附加 `components`，并支持 `initialTransform` 或顶层 `position` / `rotation` / `scale` 初始变换。
- **配置与界面改进**：保留并完善工具管理、工具启用状态、服务器设置和 Dev Test Panel，方便选择工具、查看服务状态和执行编辑器集成测试。
- **测试体系补全**：使用 Vitest 编写 MCP server、Editor Message、统一工具、节点、组件、场景、预制体、资源和协议行为测试；提供 dispatcher 契约测试和双时代协议 fixture；Dev Test Panel 还提供 6 组回归测试，覆盖已修复的编辑器集成问题。
- **构建流程现代化**：使用 TypeScript、ESLint、Vitest 和 tsdown；支持 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm watch`，统一输出 CJS 格式的服务端、场景和各编辑器面板入口。

## 安装

将此仓库放入 Cocos 项目的 `extensions/cocos-mcp-server`，然后执行：

```bash
pnpm install
pnpm build
```

重启 Cocos Creator 或刷新扩展，在 `扩展 > Cocos MCP Server` 打开面板并启动服务。默认地址为 `http://127.0.0.1:3000/mcp`。

## 连接客户端

本项目使用标准 MCP HTTP 配置。仓库根目录的 [`.mcp.json`](.mcp.json) 已提供可直接参考的配置：

```json
{
  "mcpServers": {
    "cocos-creator": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "directTools": true
    }
  }
}
```

将上述配置添加到支持 MCP HTTP 的客户端即可。端口可在 Cocos Creator 扩展面板中修改；修改后请同步更新客户端配置中的 `url`。

使用 HTTP Streamable，支持 MCP `2026-07-28` 协议。

## 能力概览

连接后，AI 可以通过 MCP 操作 Cocos Creator 项目中的：

- **场景和节点**：读取层级、创建、复制、删除和修改节点；
- **组件**：查询、添加、移除和设置组件属性；
- **预制体**：创建、实例化、修改和管理预制体；
- **资源**：查询、导入、移动、删除和解析资源；
- **项目**：读取项目信息、构建项目和检查编辑器状态；
- **调试与视图**：查看编辑器日志、场景状态、视图和性能信息；
- **工具配置**：启用或禁用具体 MCP 工具。

连接后，客户端会通过 MCP 自动发现可用工具和参数，无需手动维护工具调用 JSON。完整工具说明见 [TOOLS.md](TOOLS.md)。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

开发时可使用 `pnpm watch` 监听源文件并持续构建。

开发测试面板位于 `扩展 > Cocos MCP Server > Dev Test Panel`。核心实现位于 `source/tools/`，工具注册和公开 schema 位于 `source/tools/unified-tools.ts`。

## 兼容性

- Cocos Creator 3.8.6 或更高版本
- Node.js（由 Cocos Creator 提供）

## 授权说明

本项目基于原项目 fork，为非官方版本，仅供学习、交流和个人非商业使用。不得用于商业用途或转售；商业使用请联系原作者。
