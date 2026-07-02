# Cocos Creator MCP Server - Common Workflows

AI-oriented workflow guide for typical game development tasks.

## Basic Workflows

### 1. Create a Sprite with Image

**Goal:** Create a 2D node with a sprite component and assign an image.

**Steps:**

```json
// 1. Get scene root UUID
{
  "tool": "scene_management",
  "arguments": { "action": "get_current" }
}
// Returns: { success: true, data: { uuid: "scene-root-uuid", ... } }

// 2. Create a 2D node
{
  "tool": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "MySprite",
    "nodeType": "2DNode",
    "parentUuid": "scene-root-uuid"
  }
}
// Returns: { success: true, uuid: "new-node-uuid" }

// 3. Add Sprite component
{
  "tool": "component_manage",
  "arguments": {
    "action": "add",
    "nodeUuid": "new-node-uuid",
    "componentType": "cc.Sprite"
  }
}

// 4. Find a texture asset
{
  "tool": "asset_query",
  "arguments": {
    "action": "find_by_name",
    "name": "player.png"
  }
}
// Returns: { success: true, data: { uuid: "texture-uuid" } }

// 5. Set sprite's spriteFrame property
{
  "tool": "component_property",
  "arguments": {
    "action": "set",
    "nodeUuid": "new-node-uuid",
    "componentType": "cc.Sprite",
    "property": "spriteFrame",
    "propertyType": "asset",
    "value": "texture-uuid@spriteframe-subasset-id"
  }
}
```

**Common Errors:**

- `"Node not found"` → Node UUID became invalid, re-query with `node_query`
- `"Asset not found"` → Check asset exists with `asset_query action=list`
- `"Component type not found"` → Use `component_available action=list` to see valid types

### 2. Create a Button with Click Event

**Goal:** Create a UI button and bind a click event.

**Steps:**

```json
// 1. Get Canvas node (buttons must be under Canvas)
{
  "tool": "node_query",
  "arguments": {
    "action": "find_by_name",
    "name": "Canvas"
  }
}
// Returns: { success: true, data: { nodes: [{ uuid: "canvas-uuid" }] } }

// 2. Create button node
{
  "tool": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "MyButton",
    "nodeType": "2DNode",
    "parentUuid": "canvas-uuid",
    "components": ["cc.Sprite", "cc.Button"]  // Add multiple components at once
  }
}
// Returns: { success: true, uuid: "button-uuid" }

// 3. Query button's components to get exact component IDs
{
  "tool": "component_query",
  "arguments": {
    "action": "get_components",
    "nodeUuid": "button-uuid"
  }
}
// Returns: { success: true, data: { components: [{ type: "cc.Sprite", ... }, { type: "cc.Button", ... }] } }

// 4. Create target node with handler script
{
  "tool": "node_lifecycle",
  "arguments": {
    "action": "create",
    "name": "GameManager",
    "parentUuid": "scene-root-uuid"
  }
}

{
  "tool": "component_script",
  "arguments": {
    "action": "attach",
    "nodeUuid": "manager-uuid",
    "scriptName": "GameManager"  // Must exist in project
  }
}

// 5. Bind click event
{
  "tool": "component_event_binding",
  "arguments": {
    "action": "set_button_events",
    "nodeUuid": "button-uuid",
    "events": [{
      "target": "manager-uuid",
      "component": "GameManager",
      "handler": "onButtonClick",
      "customEventData": ""
    }]
  }
}
```

**Common Errors:**

- `"Script not found"` → Script must exist in `assets/` and be compiled
- `"Handler method not found"` → Method must be public in the script class
- `"Target node not found"` → Target UUID became invalid, re-query

### 3. Instantiate Prefab to Scene

**Goal:** Create an instance of a prefab in the scene.

**Steps:**

```json
// 1. Find the prefab asset
{
  "tool": "prefab_browse",
  "arguments": {
    "action": "list",
    "folder": "db://assets/prefabs"
  }
}
// Returns: { success: true, data: { prefabs: [{ uuid: "prefab-uuid", path: "..." }] } }

// 2. Get parent node UUID
{
  "tool": "scene_management",
  "arguments": { "action": "get_current" }
}

// 3. Instantiate prefab
{
  "tool": "prefab_instance",
  "arguments": {
    "action": "instantiate",
    "prefabPath": "db://assets/prefabs/Player.prefab",
    "parentUuid": "scene-root-uuid",
    "unlinkPrefab": false  // Keep prefab link for updates
  }
}
// Returns: { success: true, data: { uuid: "instance-uuid" } }

// 4. (Optional) Modify instance
{
  "tool": "node_transform",
  "arguments": {
    "action": "set_property",
    "uuid": "instance-uuid",
    "property": "position",
    "value": { "x": 100, "y": 200, "z": 0 }
  }
}
```

**Important Notes:**

- Prefab instances can be modified but changes won't affect the prefab asset
- Use `prefab_edit action=update` to push changes back to prefab
- Use `prefab_instance action=revert` to restore instance to prefab state

### 4. Import Asset and Wait for Completion

**Goal:** Import a new asset file and use it immediately.

**Steps:**

```json
// 1. Import asset (triggers async processing)
{
  "tool": "asset_manage",
  "arguments": {
    "action": "import",
    "sourcePath": "/path/to/image.png",
    "targetPath": "db://assets/textures/image.png"
  }
}
// Returns immediately: { success: true }

// 2. Poll until asset is ready (max 5 seconds)
// Wait 200ms, then:
{
  "tool": "asset_query",
  "arguments": {
    "action": "get_info",
    "path": "db://assets/textures/image.png"
  }
}
// If returns uuid, asset is ready. Otherwise wait 200ms and retry.

// 3. Use the asset
{
  "tool": "component_property",
  "arguments": {
    "action": "set",
    "nodeUuid": "sprite-uuid",
    "componentType": "cc.Sprite",
    "property": "spriteFrame",
    "value": "imported-texture-uuid@f9941"
  }
}
```

**Critical:**

- **Always poll** after `asset_manage action=import/create`
- Asset import can take 200ms to 5 seconds depending on file size
- Using an asset immediately after import will fail with "Asset not found"

## Error Recovery Patterns

### UUID Became Invalid

**Symptom:** `"Node not found"` or `"Component not found"`

**Recovery:**

```json
// Re-query the scene hierarchy
{
  "tool": "scene_hierarchy",
  "arguments": { "action": "get" }
}
// Find your node by name in the returned tree, get new UUID
```

### Component Type Name Wrong

**Symptom:** `"Component type 'MyScript' not found"`

**Recovery:**

```json
// List all available components
{
  "tool": "component_available",
  "arguments": { "action": "list" }
}
// Use exact name from the list (case-sensitive)
```

### Asset Path vs UUID Confusion

**Symptom:** Operation fails with path when UUID expected (or vice versa)

**Recovery:**

```json
// Convert path to UUID
{
  "tool": "asset_query",
  "arguments": {
    "action": "query_uuid",
    "path": "db://assets/..."
  }
}

// Convert UUID to path
{
  "tool": "asset_query",
  "arguments": {
    "action": "query_path",
    "uuid": "..."
  }
}
```

### Scene Reload During Operation

**Symptom:** Node/component operations fail mid-workflow

**Recovery:**

```json
// Check if scene is ready
{
  "tool": "scene_execution_control",
  "arguments": { "action": "query_ready" }
}
// If not ready, wait 500ms and retry
// If ready, re-query all UUIDs and continue
```

## Best Practices

1. **Always query before modify**
   - Don't assume UUIDs are stable across operations
   - Query scene/node/component state before each modification

2. **Use batch operations when possible**
   - `node_lifecycle action=create` with `components` array
   - Reduces round trips and timing issues

3. **Handle async operations correctly**
   - Poll after asset import/create
   - Wait for scene ready after scene create/open

4. **Prefer UUID over name**
   - Names are not unique, UUIDs are
   - Always use UUID for node/component/asset references

5. **Check operation success**
   - Every tool returns `{ success: boolean, error?: string }`
   - If `success: false`, read `error` for recovery hint
