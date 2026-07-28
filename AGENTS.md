# Repository Guide

## Scope

Cocos Creator MCP extension for Cocos Creator 3.8.6+. TypeScript sources build to CommonJS for the editor extension.

## Commands

```bash
pnpm build
pnpm watch
pnpm typecheck
pnpm lint
```

Use `pnpm typecheck` and `pnpm build` after TypeScript changes. The Dev Test Panel is available at `Extension > Cocos MCP Server > Dev Test Panel` and contains editor integration regressions.

## Architecture

- `source/main.ts`: extension entry point and main-process IPC methods.
- `source/mcp-server.ts`: HTTP MCP server and protocol handling.
- `source/tools/unified-tools.ts`: public tool registry, action routing, and MCP input schemas.
- `source/tools/*.ts`: tool implementations.
- `source/scene.ts`: extension-owned scene-process methods. Do not call a scene IPC method unless it is registered by Cocos or this file.
- `source/panels/`: editor panels; panel code communicates through `Editor.Message`.

## Tool Changes

- Public tools use an `action` argument. Keep the implementation, `UnifiedTools.getTools()` definition, and schema aligned.
- `tools/list` is the public API contract. Update `TOOLS.md` only for durable calling rules, not a duplicated parameter inventory.
- Query UUIDs before writes. Node names are not unique.
- For Cocos Creator IPC messages, inspect the installed Creator version's built-in type definitions first (for example, `builtin/scene/@types/public.d.ts` inside the Creator installation), then verify the message handler/implementation. Treat Message Manager examples and prose as guidance only; they may be misleading or version-dependent.
- Use `scene/query-node-tree` for editor hierarchy reads. Do not introduce unsupported message names such as `query-hierarchy`.
- When removing a component, query its actual component instance UUID via `component_query` first. Follow the built-in `RemoveComponentOptions` type: `scene/remove-component` takes the component UUID as `{ uuid: componentUuid }`, not the node UUID plus a component type.
- Add or update a Dev Test regression for fixed editor integration bugs in `source/panels/dev-test/cases/regression/`. Export it from that directory’s `index.ts`; the Dev Test Panel registers `allRegressionTests` from this single aggregate, so do not add a separate registration/import list.

## Conventions

- Strict TypeScript; use the existing ESLint configuration and formatting style.
- Build output is `dist/`; do not manually edit it.
- Use `Editor.Message.request()` for request/response IPC and return `{ success, data?, error? }` consistently from tools.
- Keep changes minimal and avoid compatibility shims without a concrete external need.
