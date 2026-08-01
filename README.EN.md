# Cocos Creator MCP Server

[中文](README.md) | [Tool Usage](TOOLS.md)

An MCP server for Cocos Creator 3.8.6+. It lets AI clients operate scenes, nodes, components, prefabs, assets, and projects over HTTP.

This project is forked from [DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server) and continuously fixes and maintains the MCP tools and Cocos Editor integration.

## Major Changes from the Original Project

This version is more than a simple client adaptation or a small collection of fixes. It substantially refactors the tool API, MCP protocol, editor integration, and development workflow:

- **Tool and API renaming**: reorganizes tools around `domain + capability` and standardizes explicit actions such as `get`, `list`, `find`, `check`, and `set`, reducing duplicate wrappers, vague `manage` / `query_*` names, and duplicate operations.
- **Unified tool registry**: manages all public tools from one registry. Each action has its own schema and exposes only the parameters allowed for that operation. Action-specific schemas reduce wrong-tool selection, misspelled actions, and cross-action parameter mixing. Clients can obtain the live contract through `tools/list` or inspect required fields, examples, deprecation status, and capability status with `tool_registry.describe`.
- **MCP protocol upgrade**: uses Streamable HTTP and supports MCP `2026-07-28`.
- **Improved error handling**: adds stable machine-readable error codes and attempted/allowed context for contract failures, allowing AI clients to correct requests automatically.
- **Consolidated asset APIs**: adds `asset_query.resolve_identity` to resolve an asset URL, UUID, and filesystem path in one call. Asset imports support explicit `overwrite` behavior and conflict guidance; legacy conversion actions remain compatible but are marked as deprecated.
- **Expanded editor capabilities**: completes the project, scene, node, component, prefab, asset, reference-image, build, and debugging tools, while fixing multiple Cocos Creator Editor IPC, component-property, prefab, and asset-reference issues.
- **Enhanced node and component operations**: `node_lifecycle.create` can attach `components` when creating a node and accepts either `initialTransform` or top-level `position` / `rotation` / `scale` initial transforms.
- **Configuration and UI improvements**: retains and improves tool management, enabled-tool state, server settings, and the Dev Test Panel for selecting tools, viewing server status, and running editor integration tests.
- **Expanded test coverage**: uses Vitest for MCP server, Editor Message, unified tool, node, component, scene, prefab, asset, and protocol behavior tests. It also provides dispatcher contract tests and dual-era protocol fixtures, while the Dev Test Panel provides six regression-test batches covering previously fixed editor integration issues.
- **Modernized build workflow**: uses TypeScript, ESLint, Vitest, and tsdown; supports `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm watch`, with CJS output for the server, scene, and editor-panel entry points.

## Install

Place this repository in `extensions/cocos-mcp-server` inside a Cocos project, then run:

```bash
pnpm install
pnpm build
```

Restart Cocos Creator or refresh extensions. Open `Extension > Cocos MCP Server`, then start the server. The default endpoint is `http://127.0.0.1:3000/mcp`.

## Connect a Client

This project uses the standard MCP HTTP configuration. The repository root contains the same example in [`.mcp.json`](.mcp.json):

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

Add this configuration to any MCP client that supports HTTP. If you change the port in the Cocos Creator extension panel, update the `url` in the client configuration as well.

The server uses Streamable HTTP and supports MCP `2026-07-28`.

## Capabilities

After connecting, AI clients can use MCP to operate on Cocos Creator projects:

- **Scenes and nodes**: read hierarchies, create, duplicate, delete, and edit nodes;
- **Components**: query, add, remove, and set component properties;
- **Prefabs**: create, instantiate, modify, and manage prefabs;
- **Assets**: query, import, move, delete, and resolve assets;
- **Projects**: inspect project information, build projects, and check editor status;
- **Debugging and views**: inspect editor logs, scene state, views, and performance information;
- **Tool configuration**: enable or disable individual MCP tools.

After connecting, the client discovers available tools and parameters through MCP automatically. No tool-call JSON needs to be maintained manually. See [TOOLS.md](TOOLS.md) for the complete tool reference.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

During development, use `pnpm watch` to rebuild continuously when source files change.

The development test panel is available at `Extension > Cocos MCP Server > Dev Test Panel`. Tool implementations are in `source/tools/`; the public registry and schemas are in `source/tools/unified-tools.ts`.

## Compatibility

- Cocos Creator 3.8.6 or later
- Node.js bundled with Cocos Creator

## Usage Terms

This project is an unofficial fork intended only for learning, communication, and personal non-commercial use. Commercial use and resale are not permitted; please contact the original author for commercial use.
