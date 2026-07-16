import type { ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { requestEditor, requestScene } from '../editor-message'
import { verifyPrefabInstanceLink } from './prefab-instance'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringOrStringArray(value: unknown): value is string | string[] {
  return typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

export class SceneAdvancedTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'reset_node_property',
        description: 'Reset node property to default value',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
            path: {
              type: 'string',
              description: 'Property path (e.g., position, rotation, scale)',
            },
          },
          required: ['uuid', 'path'],
        },
      },
      {
        name: 'move_array_element',
        description: 'Move array element position',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
            path: {
              type: 'string',
              description: 'Array property path (e.g., __comps__)',
            },
            target: {
              type: 'number',
              description: 'Target item original index',
            },
            offset: {
              type: 'number',
              description: 'Offset amount (positive or negative)',
            },
          },
          required: ['uuid', 'path', 'target', 'offset'],
        },
      },
      {
        name: 'remove_array_element',
        description: 'Remove array element at specific index',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
            path: {
              type: 'string',
              description: 'Array property path',
            },
            index: {
              type: 'number',
              description: 'Target item index to remove',
            },
          },
          required: ['uuid', 'path', 'index'],
        },
      },
      {
        name: 'copy_node',
        description: 'Copy node for later paste operation',
        inputSchema: {
          type: 'object',
          properties: {
            uuids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'Node UUID or array of UUIDs to copy',
            },
          },
          required: ['uuids'],
        },
      },
      {
        name: 'paste_node',
        description: 'Paste previously copied nodes',
        inputSchema: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              description: 'Target parent node UUID',
            },
            uuids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'Node UUIDs to paste',
            },
            keepWorldTransform: {
              type: 'boolean',
              description: 'Keep world transform coordinates',
              default: false,
            },
          },
          required: ['target', 'uuids'],
        },
      },
      {
        name: 'cut_node',
        description: 'Cut node (copy + mark for move)',
        inputSchema: {
          type: 'object',
          properties: {
            uuids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'Node UUID or array of UUIDs to cut',
            },
          },
          required: ['uuids'],
        },
      },
      {
        name: 'reset_node_transform',
        description: 'Reset node position, rotation and scale',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Node UUID',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'reset_component',
        description: 'Reset component to default values',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Component UUID',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'restore_prefab',
        description: 'Restore prefab instance from asset',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Node UUID',
            },
            assetUuid: {
              type: 'string',
              description: 'Prefab asset UUID',
            },
          },
          required: ['nodeUuid', 'assetUuid'],
        },
      },
      {
        name: 'execute_component_method',
        description: 'Execute method on component',
        inputSchema: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'Component UUID',
            },
            name: {
              type: 'string',
              description: 'Method name',
            },
            args: {
              type: 'array',
              description: 'Method arguments',
              default: [],
            },
          },
          required: ['uuid', 'name'],
        },
      },
      {
        name: 'execute_scene_script',
        description: 'Execute a method exported by a registered extension scene script. This does not evaluate arbitrary JavaScript.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Extension package name that contributes the scene script (for this extension: cocos-mcp-server)',
            },
            method: {
              type: 'string',
              description: 'Method exported from the registered scene script methods object',
            },
            args: {
              type: 'array',
              description: 'Method arguments',
              default: [],
            },
          },
          required: ['name', 'method'],
        },
      },
      {
        name: 'scene_snapshot',
        description: 'Create scene state snapshot',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'scene_snapshot_abort',
        description: 'Abort scene snapshot creation',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'begin_undo_recording',
        description: 'Begin an explicit undo record for one or more target nodes. The UUIDs identify every object whose state must be captured, not an arbitrary anchor.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeUuid: {
              type: 'string',
              description: 'Single target node UUID (compatibility form)',
            },
            nodeUuids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: 'All target node UUIDs whose state must be captured',
            },
            label: {
              type: 'string',
              description: 'Undo menu label (mapped to Cocos undo tag)',
            },
          },
          anyOf: [
            { required: ['nodeUuid'] },
            { required: ['nodeUuids'] },
          ],
        },
      },
      {
        name: 'end_undo_recording',
        description: 'End recording undo data',
        inputSchema: {
          type: 'object',
          properties: {
            undoId: {
              type: 'string',
              description: 'Undo recording ID from begin_undo_recording',
            },
          },
          required: ['undoId'],
        },
      },
      {
        name: 'cancel_undo_recording',
        description: 'Cancel undo recording',
        inputSchema: {
          type: 'object',
          properties: {
            undoId: {
              type: 'string',
              description: 'Undo recording ID to cancel',
            },
          },
          required: ['undoId'],
        },
      },
      {
        name: 'soft_reload_scene',
        description: 'Soft reload current scene',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_scene_ready',
        description: 'Check if scene is ready',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_scene_dirty',
        description: 'Check if scene has unsaved changes',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_scene_classes',
        description: 'Query all registered classes',
        inputSchema: {
          type: 'object',
          properties: {
            extends: {
              type: 'string',
              description: 'Filter classes that extend this base class',
            },
          },
        },
      },
      {
        name: 'query_scene_components',
        description: 'Query available scene components',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_component_has_script',
        description: 'Check if component has script',
        inputSchema: {
          type: 'object',
          properties: {
            className: {
              type: 'string',
              description: 'Script class name to check',
            },
          },
          required: ['className'],
        },
      },
      {
        name: 'query_nodes_by_asset_uuid',
        description: 'Find nodes that use specific asset UUID',
        inputSchema: {
          type: 'object',
          properties: {
            assetUuid: {
              type: 'string',
              description: 'Asset UUID to search for',
            },
          },
          required: ['assetUuid'],
        },
      },
      {
        name: 'query_scene_info',
        description: 'Get current scene summary info (name, uuid, path, ready, dirty, child count, asset url)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'reset_node_property':
        return typeof args.uuid === 'string' && typeof args.path === 'string'
          ? this.resetNodeProperty(args.uuid, args.path)
          : toolFailure('reset_node_property requires uuid and path strings')
      case 'move_array_element':
        return typeof args.uuid === 'string' && typeof args.path === 'string' && typeof args.target === 'number' && typeof args.offset === 'number'
          ? this.moveArrayElement(args.uuid, args.path, args.target, args.offset)
          : toolFailure('move_array_element requires uuid, path, target, and offset')
      case 'remove_array_element':
        return typeof args.uuid === 'string' && typeof args.path === 'string' && typeof args.index === 'number'
          ? this.removeArrayElement(args.uuid, args.path, args.index)
          : toolFailure('remove_array_element requires uuid, path, and index')
      case 'copy_node':
        return isStringOrStringArray(args.uuids)
          ? this.copyNode(args.uuids)
          : toolFailure('copy_node requires a UUID string or string array')
      case 'paste_node':
        return typeof args.target === 'string'
          && isStringOrStringArray(args.uuids)
          && (args.keepWorldTransform === undefined || typeof args.keepWorldTransform === 'boolean')
          ? this.pasteNode(args.target, args.uuids, args.keepWorldTransform)
          : toolFailure('paste_node requires target, uuids, and an optional keepWorldTransform boolean')
      case 'cut_node':
        return isStringOrStringArray(args.uuids)
          ? this.cutNode(args.uuids)
          : toolFailure('cut_node requires a UUID string or string array')
      case 'reset_node_transform':
        return typeof args.uuid === 'string' ? this.resetNodeTransform(args.uuid) : toolFailure('reset_node_transform requires a uuid')
      case 'reset_component':
        return typeof args.uuid === 'string' ? this.resetComponent(args.uuid) : toolFailure('reset_component requires a uuid')
      case 'restore_prefab':
        return typeof args.nodeUuid === 'string' && typeof args.assetUuid === 'string'
          ? this.restorePrefab(args.nodeUuid, args.assetUuid)
          : toolFailure('restore_prefab requires nodeUuid and assetUuid')
      case 'execute_component_method':
        return typeof args.uuid === 'string' && typeof args.name === 'string' && (args.args === undefined || Array.isArray(args.args))
          ? this.executeComponentMethod(args.uuid, args.name, args.args)
          : toolFailure('execute_component_method requires uuid, name, and an optional args array')
      case 'execute_scene_script':
        return typeof args.name === 'string' && typeof args.method === 'string' && (args.args === undefined || Array.isArray(args.args))
          ? this.executeSceneScript(args.name, args.method, args.args)
          : toolFailure('execute_scene_script requires name, method, and an optional args array')
      case 'scene_snapshot':
        return this.sceneSnapshot()
      case 'scene_snapshot_abort':
        return this.sceneSnapshotAbort()
      case 'begin_undo_recording':
        if (args.nodeUuid !== undefined && args.nodeUuids !== undefined) {
          return toolFailure('begin_undo_recording accepts either nodeUuid or nodeUuids, not both')
        }
        if (args.label !== undefined && typeof args.label !== 'string') {
          return toolFailure('begin_undo_recording label must be a string when provided')
        }
        if (typeof args.nodeUuid === 'string') {
          return this.beginUndoRecording(args.nodeUuid, args.label)
        }
        if (Array.isArray(args.nodeUuids) && args.nodeUuids.length > 0 && args.nodeUuids.every(uuid => typeof uuid === 'string')) {
          return this.beginUndoRecording(args.nodeUuids, args.label)
        }
        return toolFailure('begin_undo_recording requires nodeUuid or a non-empty nodeUuids array')
      case 'end_undo_recording':
        return typeof args.undoId === 'string' ? this.endUndoRecording(args.undoId) : toolFailure('end_undo_recording requires undoId')
      case 'cancel_undo_recording':
        return typeof args.undoId === 'string' ? this.cancelUndoRecording(args.undoId) : toolFailure('cancel_undo_recording requires undoId')
      case 'soft_reload_scene':
        return this.softReloadScene()
      case 'query_scene_ready':
        return this.querySceneReady()
      case 'query_scene_dirty':
        return this.querySceneDirty()
      case 'query_scene_classes':
        return args.extends === undefined || typeof args.extends === 'string'
          ? this.querySceneClasses(args.extends)
          : toolFailure('query_scene_classes extends must be a string when provided')
      case 'query_scene_components':
        return this.querySceneComponents()
      case 'query_component_has_script':
        return typeof args.className === 'string'
          ? this.queryComponentHasScript(args.className)
          : toolFailure('query_component_has_script requires className')
      case 'query_nodes_by_asset_uuid':
        return typeof args.assetUuid === 'string'
          ? this.queryNodesByAssetUuid(args.assetUuid)
          : toolFailure('query_nodes_by_asset_uuid requires assetUuid')
      case 'query_scene_info':
        return this.querySceneInfo()
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async resetNodeProperty(uuid: string, path: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'reset-property', {
        uuid,
        path,
        dump: { value: null },
      }).then(() => {
        resolve({
          success: true,
          message: `Property '${path}' reset to default value`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async moveArrayElement(uuid: string, path: string, target: number, offset: number): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'move-array-element', {
        uuid,
        path,
        target,
        offset,
      }).then(() => {
        resolve({
          success: true,
          message: `Array element at index ${target} moved by ${offset}`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async removeArrayElement(uuid: string, path: string, index: number): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'remove-array-element', {
        uuid,
        path,
        index,
      }).then(() => {
        resolve({
          success: true,
          message: `Array element at index ${index} removed`,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async copyNode(uuids: string | string[]): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'copy-node', uuids).then((result: string | string[]) => {
        resolve({
          success: true,
          data: {
            copiedUuids: result,
            message: 'Node(s) copied successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async pasteNode(target: string, uuids: string | string[], keepWorldTransform: boolean = false): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'paste-node', {
        target,
        uuids,
        keepWorldTransform,
      }).then((result: string | string[]) => {
        resolve({
          success: true,
          data: {
            newUuids: result,
            message: 'Node(s) pasted successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async cutNode(uuids: string | string[]): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'cut-node', uuids).then((result) => {
        resolve({
          success: true,
          data: {
            cutUuids: result,
            message: 'Node(s) cut successfully',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async resetNodeTransform(uuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'reset-node', { uuid }).then(() => {
        resolve({
          success: true,
          message: 'Node transform reset to default',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async resetComponent(uuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'reset-component', { uuid }).then(() => {
        resolve({
          success: true,
          message: 'Component reset to default values',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async restorePrefab(nodeUuid: string, assetUuid: string): Promise<ToolResponse> {
    try {
      const restored = await requestEditor('scene', 'restore-prefab', nodeUuid, assetUuid)
      if (restored !== true)
        return { success: false, error: 'Cocos restore-prefab returned false; no prefab association was restored.', data: { nodeUuid, assetUuid, restored, prefabLinked: false } }
      const prefabLinked = await verifyPrefabInstanceLink(nodeUuid, assetUuid)
      return prefabLinked
        ? { success: true, message: 'Prefab restored successfully', data: { nodeUuid, assetUuid, restored: true, prefabLinked: true } }
        : { success: false, error: 'Cocos restore-prefab returned true, but the prefab association could not be verified.', data: { nodeUuid, assetUuid, restored: true, prefabLinked: false } }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async executeComponentMethod(uuid: string, name: string, args: unknown[] = []): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'execute-component-method', {
        uuid,
        name,
        args,
      }).then((result) => {
        resolve({
          success: true,
          data: {
            result,
            message: `Method '${name}' executed successfully`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async executeSceneScript(name: string, method: string, args: unknown[] = []): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'execute-scene-script', {
        name,
        method,
        args,
      }).then((result) => {
        resolve({
          success: true,
          data: result,
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async sceneSnapshot(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'snapshot').then(() => {
        resolve({
          success: true,
          message: 'Scene snapshot created',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async sceneSnapshotAbort(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'snapshot-abort').then(() => {
        resolve({
          success: true,
          message: 'Scene snapshot aborted',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async beginUndoRecording(nodeUuids: string | string[], label?: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const options = {
        auto: false,
        ...(label ? { tag: label } : {}),
      }
      Editor.Message.request('scene', 'begin-recording', nodeUuids, options).then((undoId: unknown) => {
        if (typeof undoId !== 'string' || !undoId) {
          resolve(toolFailure('Cocos Editor did not return a valid undoId from begin-recording'))
          return
        }
        resolve({
          success: true,
          data: {
            undoId,
            nodeUuids: typeof nodeUuids === 'string' ? [nodeUuids] : nodeUuids,
            label,
            message: 'Undo recording started',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async endUndoRecording(undoId: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'end-recording', undoId).then(() => {
        resolve({
          success: true,
          message: 'Undo recording ended',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async cancelUndoRecording(undoId: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'cancel-recording', undoId).then(() => {
        resolve({
          success: true,
          message: 'Undo recording cancelled',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async softReloadScene(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'soft-reload').then(() => {
        resolve({
          success: true,
          message: 'Scene soft reloaded successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySceneReady(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-is-ready').then((ready: boolean) => {
        resolve({
          success: true,
          data: {
            ready,
            message: ready ? 'Scene is ready' : 'Scene is not ready',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySceneDirty(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-dirty').then((dirty: boolean) => {
        resolve({
          success: true,
          data: {
            dirty,
            message: dirty ? 'Scene has unsaved changes' : 'Scene is clean',
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySceneClasses(extendsClass?: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const options: { extends?: string } = {}
      if (extendsClass) {
        options.extends = extendsClass
      }

      Editor.Message.request('scene', 'query-classes', options).then((classes) => {
        resolve({
          success: true,
          data: {
            classes,
            count: classes.length,
            extendsFilter: extendsClass,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySceneComponents(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-components').then((components) => {
        resolve({
          success: true,
          data: {
            components,
            count: components.length,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryComponentHasScript(className: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-component-has-script', className).then((hasScript: boolean) => {
        resolve({
          success: true,
          data: {
            className,
            hasScript,
            message: hasScript ? `Component '${className}' has script` : `Component '${className}' does not have script`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async queryNodesByAssetUuid(assetUuid: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'query-nodes-by-asset-uuid', assetUuid).then((nodeUuids: string[]) => {
        resolve({
          success: true,
          data: {
            assetUuid,
            nodeUuids,
            count: nodeUuids.length,
            message: `Found ${nodeUuids.length} nodes using asset`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async querySceneInfo(): Promise<ToolResponse> {
    // 聚合多个独立 API 一次性返回场景状态，避免外部多次组合
    const [tree, ready, dirty, currentScene] = await Promise.all([
      requestScene('query-node-tree').catch(() => null),
      requestScene('query-is-ready').catch(() => null),
      requestScene('query-dirty').catch(() => null),
      requestScene('query-current-scene').catch(() => null),
    ])

    if (!tree) {
      return { success: false, error: 'No scene data available' }
    }

    const childCount = Array.isArray(tree.children) ? tree.children.length : 0

    return {
      success: true,
      data: {
        name: tree.name || 'Current Scene',
        uuid: tree.uuid,
        type: tree.type || 'cc.Scene',
        active: tree.active !== undefined ? tree.active : true,
        childCount,
        ready: ready === true,
        dirty: dirty === true,
        assetUrl: currentScene?.url ?? null,
        sceneAssetUuid: currentScene?.uuid ?? null,
      },
    }
  }
}
