# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cocos Creator MCP Server** is a comprehensive Model Context Protocol (MCP) server plugin for Cocos Creator 3.8+. It enables AI assistants to interact with the Cocos Creator editor through a standardized HTTP protocol, providing 50 unified tools that cover 99% of editor functionality.

- **Language**: TypeScript
- **Runtime**: Node.js (bundled with Cocos Creator)
- **Build tool**: tsdown (Rolldown-based)
- **UI Framework**: Vue 3
- **Target**: Cocos Creator extension (3.8.6+)

## Common Commands

### Build

```bash
pnpm build          # Production build → dist/
pnpm watch          # Development build with watch mode
```

### Code Quality

```bash
pnpm lint           # Run ESLint (uses @antfu/eslint-config)
pnpm typecheck      # TypeScript type checking (no emit)
```

### Installation (for users)

After placing the plugin in `extensions/cocos-mcp-server/`:

```bash
cd extensions/cocos-mcp-server
pnpm install
pnpm build
```

Then restart Cocos Creator or refresh extensions, and open the panel via `Extension > Cocos MCP Server`.

## Architecture

### High-Level Structure

```
source/
├── main.ts                    # Extension entry point, defines Editor.methods
├── mcp-server.ts              # HTTP server handling MCP protocol
├── settings.ts                # Settings persistence
├── scene.ts                   # Scene operations exposed to Editor
├── types/index.ts             # TypeScript type definitions
├── tools/
│   ├── unified-tools.ts       # Tool registry and dispatcher
│   ├── scene-tools.ts         # Scene management (598 lines)
│   ├── node-tools.ts          # Node operations (1291 lines)
│   ├── component-tools.ts     # Component operations (2301 lines)
│   ├── prefab-tools.ts        # Prefab operations (2901 lines)
│   ├── project-tools.ts       # Project control (1110 lines)
│   ├── debug-tools.ts         # Console/logs/validation (651 lines)
│   ├── asset-advanced-tools.ts # Asset operations (844 lines)
│   ├── scene-advanced-tools.ts # Advanced scene ops (817 lines)
│   ├── scene-view-tools.ts    # Scene view control (628 lines)
│   ├── reference-image-tools.ts # Reference images (403 lines)
│   ├── preferences-tools.ts   # Editor preferences (334 lines)
│   ├── server-tools.ts        # Server info (264 lines)
│   ├── broadcast-tools.ts     # Message broadcasting (268 lines)
│   ├── validation-tools.ts    # Validation utilities (267 lines)
│   └── tool-manager.ts        # Tool enable/disable system (424 lines)
└── panels/
    ├── default/               # Main control panel (Vue 3)
    ├── tool-manager/          # Tool configuration panel
    └── dev-test/              # Development testing panel
```

### Key Architectural Concepts

**1. Unified Tool System (v1.5.0)**

- All tools follow `category_operation` naming: `node_lifecycle`, `scene_management`, etc.
- Every tool accepts an `action` parameter to switch between operations (create/delete/update/query)
- Replaces the legacy 150+ fine-grained tools with 50 high-reuse tools
- Example:
  ```json
  {
    "tool": "node_lifecycle",
    "arguments": {
      "action": "create", // or "delete"
      "name": "Player",
      "parentUuid": "parent-uuid"
    }
  }
  ```

**2. MCP Protocol Over HTTP**

- Server runs on configurable port (default 3000)
- Endpoint: `http://127.0.0.1:3000/mcp`
- Supports standard MCP methods: `initialize`, `tools/list`, `tools/call`
- Also provides simplified REST API: `POST /api/{category}/{tool_name}` for direct testing

**3. Cocos Creator Extension System**

- `main.ts` exports `methods` object that defines IPC messages
- `package.json` defines panels, menu items, and message routing
- Scene operations run in the scene process via `scene.ts`
- UI panels use Vue 3 and communicate via `Editor.Message.send()`

**4. Tool Manager**

- Allows selective tool enable/disable via UI
- Configurations are persisted and can be imported/exported
- When tools are disabled, they're filtered out from `tools/list` responses
- Tool manager state is synchronized between main process and panels

**5. Prefab System (Critical)**

- v1.4.0 completely rewrote prefab creation to match official format
- Internal references (nodes/components within prefab) use `{"__id__": x}` format
- External references (outside prefab) are set to `null`
- Asset references (textures, sprites) preserve UUID format
- Component removal requires `cid` (component type), not class name

## Tool Categories and Key Operations

Reference `FEATURE_GUIDE_V1_5_EN.md` for the complete AI-oriented tool guide. Key categories:

- **scene_management**: Get/open/save/create/close scenes
- **node_query / node_lifecycle / node_transform**: Node operations
- **component_manage / component_script / component_query**: Component operations
- **prefab_browse / prefab_lifecycle / prefab_instance / prefab_edit**: Prefab operations
- **asset_manage / asset_analyze / asset_query**: Asset operations
- **project_manage / project_build_system**: Project run/build
- **debug_console / debug_logs**: Console and log management
- **preferences_manage**: Editor preferences
- **server_info**: Server status
- **broadcast_message**: Custom message broadcasting

## Development Patterns

### Adding a New Tool

1. Identify the category (scene/node/component/prefab/asset/etc.)
2. Add the tool definition in the corresponding file in `source/tools/`
3. Register it in `UnifiedTools.getTools()` in `unified-tools.ts`
4. Tools are automatically exposed via MCP protocol

### Modifying Panel UI

1. Panel source: `source/panels/{panel-name}/index.ts`
2. Uses Vue 3 Composition API
3. Communicate with main process via:
   ```typescript
   Editor.Message.send('cocos-mcp-server', 'message-name', ...args)
   ```
4. Panel config in `package.json` → `panels` → `{panel-name}`

### Build Output

- `tsdown.config.ts` defines entry points
- All source compiles to CommonJS in `dist/`
- Entry points:
  - `main.ts` → `dist/main.cjs`
  - `scene.ts` → `dist/scene.cjs`
  - Panel entries → `dist/panels/{name}/index.cjs`

### TypeScript Configuration

- Strict mode enabled
- `@cocos/creator-types/editor` and `engine` provide Cocos API types
- `NodeNext` module resolution
- JSON imports enabled for schema files

### ESLint (Anthony Fu's Config)

- Uses `@antfu/eslint-config` with formatters
- Automatic formatting via ESLint (no Prettier)
- `console` and unused vars allowed for this project
- Format on save disabled; use `source.fixAll.eslint` instead

## Testing

The `dev-test` panel provides:

- Tool call testing UI
- Recent test cases in `source/panels/dev-test/cases/`
- Test infrastructure in `source/panels/dev-test/test-infra/`

Use `Extension > Cocos MCP Server > Dev Test Panel` to open.

## AI Client Configuration

### Claude CLI

```bash
claude mcp add --transport http cocos-creator http://127.0.0.1:3000/mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "cocos-creator": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### Cursor / VS Code

```json
{
  "mcpServers": {
    "cocos-creator": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Common Pitfalls

1. **Component Removal**: Must use `cid` (component type) from `component_query`, not script name or class name
2. **Prefab References**: Internal refs use `__id__`, external refs are `null`, asset refs use UUID
3. **UUID vs Name**: Always query UUIDs before operations; names are not unique identifiers
4. **Server Not Running**: Check if server started via panel or auto-start setting
5. **Port Conflicts**: Default port 3000 might be in use; change in settings

## Key Files for Reference

- **Tool Documentation**: `FEATURE_GUIDE_V1_5_EN.md` (AI-oriented guide)
- **Legacy Tool Docs**: `FEATURE_GUIDE_CN.md` / `FEATURE_GUIDE_EN.md` (v1.4 reference)
- **README**: `README.md` (Chinese), `README.EN.md` (English)
- **Architecture**: `AGENTS.md` (project structure and conventions)
- **Type Definitions**: `source/types/index.ts`

## Version Notes

- Current version: 1.5.0
- Major refactor from 150+ tools to 50 unified tools
- Prefab system fully rewritten in v1.4.0
- Requires Cocos Creator 3.8.6 or higher
