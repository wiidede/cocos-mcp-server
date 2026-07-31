import type { SceneNodeDump } from '../editor-message'
import type { SceneInfo, ToolDefinition, ToolExecutor, ToolResponse } from '../types'
import { requestAssetDb, requestEditor, requestScene } from '../editor-message'
import { buildSceneHierarchy } from './scene-hierarchy'
import { toolFailure } from './tool-response'

type ToolArguments = Record<string, unknown>

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class SceneTools implements ToolExecutor {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'get_current_scene',
        description: 'Get current scene information',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_scene_list',
        description: 'Get all scenes in the project',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'open_scene',
        description: 'Open a scene by path',
        inputSchema: {
          type: 'object',
          properties: {
            scenePath: {
              type: 'string',
              description: 'The scene file path',
            },
          },
          required: ['scenePath'],
        },
      },
      {
        name: 'save_scene',
        description: 'Save current scene',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'create_scene',
        description: 'Create a new scene asset. If autoCreateCanvas=true, also opens the scene and adds a Canvas 2DNode + cc.Canvas component.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneName: {
              type: 'string',
              description: 'Name of the new scene (optional when savePath already contains the filename)',
            },
            savePath: {
              type: 'string',
              description: 'Path to save the scene (e.g., db://assets/scenes/NewScene.scene)',
            },
            path: {
              type: 'string',
              description: 'Alias of savePath. Either savePath or path is required.',
            },
            autoCreateCanvas: {
              type: 'boolean',
              description: 'After saving the scene, open it and add a Canvas 2DNode with cc.Canvas component',
              default: false,
            },
          },
        },
      },
      {
        name: 'save_scene_as',
        description: 'Save scene as new file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to save the scene',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'close_scene',
        description: 'Close current scene',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_scene_hierarchy',
        description: 'Get the complete hierarchy of current scene',
        inputSchema: {
          type: 'object',
          properties: {
            includeComponents: {
              type: 'boolean',
              description: 'Include component information',
              default: false,
            },
            rootUuid: {
              type: 'string',
              description: 'Optional subtree root node UUID',
            },
            maxDepth: {
              type: 'number',
              description: 'Optional maximum depth relative to the selected root',
            },
          },
        },
      },
    ]
  }

  async execute(toolName: string, args: unknown): Promise<ToolResponse> {
    if (!isToolArguments(args)) {
      return toolFailure('Tool arguments must be a JSON object')
    }

    switch (toolName) {
      case 'get_current_scene':
        return this.getCurrentScene()
      case 'get_scene_list':
        return this.getSceneList()
      case 'open_scene':
        return typeof args.scenePath === 'string'
          ? this.openScene(args.scenePath)
          : toolFailure('open_scene requires a scenePath string')
      case 'save_scene':
        return this.saveScene()
      case 'create_scene':
        return (args.sceneName === undefined || typeof args.sceneName === 'string')
          && (args.savePath === undefined || typeof args.savePath === 'string')
          && (args.path === undefined || typeof args.path === 'string')
          && (args.autoCreateCanvas === undefined || typeof args.autoCreateCanvas === 'boolean')
          ? this.createScene(args.sceneName, args.savePath, args)
          : toolFailure('create_scene accepts optional sceneName, savePath/path strings, and autoCreateCanvas boolean')
      case 'save_scene_as':
        return typeof args.path === 'string'
          ? this.saveSceneAs(args.path)
          : toolFailure('save_scene_as requires a path string')
      case 'close_scene':
        return this.closeScene()
      case 'get_scene_hierarchy':
        return (args.includeComponents === undefined || typeof args.includeComponents === 'boolean')
          && (args.rootUuid === undefined || typeof args.rootUuid === 'string')
          && (args.maxDepth === undefined || typeof args.maxDepth === 'number')
          ? this.getSceneHierarchy(args.includeComponents, args.rootUuid, args.maxDepth)
          : toolFailure('get_scene_hierarchy accepts optional includeComponents boolean, rootUuid string, and maxDepth number')
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async getCurrentScene(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 直接使用 query-node-tree 来获取场景信息（这个方法已经验证可用）
      requestScene('query-node-tree').then((tree) => {
        if (tree && tree.uuid) {
          resolve({
            success: true,
            data: {
              name: tree.name || 'Current Scene',
              uuid: tree.uuid,
              type: tree.type || 'cc.Scene',
              active: tree.active !== undefined ? tree.active : true,
              nodeCount: tree.children ? tree.children.length : 0,
            },
          })
        }
        else {
          resolve({ success: false, error: 'No scene data available' })
        }
      }).catch((err: Error) => {
        // 备用方案：使用场景脚本
        const options = {
          name: 'cocos-mcp-server',
          method: 'getCurrentSceneInfo',
          args: [],
        }

        Editor.Message.request('scene', 'execute-scene-script', options).then((result) => {
          resolve(result)
        }).catch((err2: Error) => {
          resolve({ success: false, error: `Direct API failed: ${err.message}, Scene script failed: ${err2.message}` })
        })
      })
    })
  }

  private async getSceneList(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // Note: query-assets API corrected with proper parameters
      requestAssetDb('query-assets', {
        pattern: 'db://assets/**/*.scene',
      }).then((results) => {
        const scenes: SceneInfo[] = results.map(asset => ({
          name: asset.name,
          path: asset.url,
          uuid: asset.uuid,
        }))
        resolve({ success: true, data: scenes })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async openScene(scenePath: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 首先获取场景的UUID
      requestAssetDb('query-uuid', scenePath).then((uuid) => {
        if (!uuid) {
          throw new Error('Scene not found')
        }

        // 使用正确的 scene API 打开场景 (需要UUID)
        return Editor.Message.request('scene', 'open-scene', uuid)
      }).then(() => {
        resolve({ success: true, message: `Scene opened: ${scenePath}` })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async saveScene(): Promise<ToolResponse> {
    return new Promise((resolve) => {
      Editor.Message.request('scene', 'save-scene').then(() => {
        resolve({ success: true, message: 'Scene saved successfully' })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async createScene(sceneName?: string, savePath?: string, extraArgs: ToolArguments = {}): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // 兼容 path / savePath 两种参数，并允许从 savePath 推断 sceneName
      const rawPath = typeof extraArgs.path === 'string' ? extraArgs.path : savePath || ''
      if (!rawPath) {
        resolve({
          success: false,
          error: 'createScene requires savePath (or path) parameter, e.g. "db://assets/scenes/Main.scene"',
        })
        return
      }

      // 从 savePath 中提取文件名作为 sceneName（如果未提供）
      const fileName = rawPath.split('/').pop() || ''
      const inferredName = fileName.replace(/\.scene$/i, '') || 'NewScene'
      const finalSceneName = (sceneName && sceneName.trim()) || inferredName

      // 确保路径以 .scene 结尾
      const fullPath = rawPath.endsWith('.scene') ? rawPath : `${rawPath.replace(/\/$/, '')}/${finalSceneName}.scene`

      // 使用正确的Cocos Creator 3.8场景格式
      const sceneContent = JSON.stringify([
        {
          __type__: 'cc.SceneAsset',
          _name: finalSceneName,
          _objFlags: 0,
          __editorExtras__: {},
          _native: '',
          scene: {
            __id__: 1,
          },
        },
        {
          __type__: 'cc.Scene',
          _name: finalSceneName,
          _objFlags: 0,
          __editorExtras__: {},
          _parent: null,
          _children: [],
          _active: true,
          _components: [],
          _prefab: null,
          _lpos: {
            __type__: 'cc.Vec3',
            x: 0,
            y: 0,
            z: 0,
          },
          _lrot: {
            __type__: 'cc.Quat',
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          },
          _lscale: {
            __type__: 'cc.Vec3',
            x: 1,
            y: 1,
            z: 1,
          },
          _mobility: 0,
          _layer: 1073741824,
          _euler: {
            __type__: 'cc.Vec3',
            x: 0,
            y: 0,
            z: 0,
          },
          autoReleaseAssets: false,
          _globals: {
            __id__: 2,
          },
          _id: 'scene',
        },
        {
          __type__: 'cc.SceneGlobals',
          ambient: {
            __id__: 3,
          },
          skybox: {
            __id__: 4,
          },
          fog: {
            __id__: 5,
          },
          octree: {
            __id__: 6,
          },
        },
        {
          __type__: 'cc.AmbientInfo',
          _skyColorHDR: {
            __type__: 'cc.Vec4',
            x: 0.2,
            y: 0.5,
            z: 0.8,
            w: 0.520833,
          },
          _skyColor: {
            __type__: 'cc.Vec4',
            x: 0.2,
            y: 0.5,
            z: 0.8,
            w: 0.520833,
          },
          _skyIllumHDR: 20000,
          _skyIllum: 20000,
          _groundAlbedoHDR: {
            __type__: 'cc.Vec4',
            x: 0.2,
            y: 0.2,
            z: 0.2,
            w: 1,
          },
          _groundAlbedo: {
            __type__: 'cc.Vec4',
            x: 0.2,
            y: 0.2,
            z: 0.2,
            w: 1,
          },
        },
        {
          __type__: 'cc.SkyboxInfo',
          _envLightingType: 0,
          _envmapHDR: null,
          _envmap: null,
          _envmapLodCount: 0,
          _diffuseMapHDR: null,
          _diffuseMap: null,
          _enabled: false,
          _useHDR: true,
          _editableMaterial: null,
          _reflectionHDR: null,
          _reflectionMap: null,
          _rotationAngle: 0,
        },
        {
          __type__: 'cc.FogInfo',
          _type: 0,
          _fogColor: {
            __type__: 'cc.Color',
            r: 200,
            g: 200,
            b: 200,
            a: 255,
          },
          _enabled: false,
          _fogDensity: 0.3,
          _fogStart: 0.5,
          _fogEnd: 300,
          _fogAtten: 5,
          _fogTop: 1.5,
          _fogRange: 1.2,
          _accurate: false,
        },
        {
          __type__: 'cc.OctreeInfo',
          _enabled: false,
          _minPos: {
            __type__: 'cc.Vec3',
            x: -1024,
            y: -1024,
            z: -1024,
          },
          _maxPos: {
            __type__: 'cc.Vec3',
            x: 1024,
            y: 1024,
            z: 1024,
          },
          _depth: 8,
        },
      ], null, 2)

      Editor.Message.request('asset-db', 'create-asset', fullPath, sceneContent).then((result) => {
        if (!result) {
          resolve({ success: false, error: 'Scene creation returned no asset information' })
          return
        }
        const finalize = (canvasInfo: unknown = null) => {
          this.getSceneList().then((sceneList) => {
            const createdScene = sceneList.data?.find((scene: unknown) => isToolArguments(scene) && scene.uuid === result.uuid)
            resolve({
              success: true,
              data: {
                uuid: result.uuid,
                url: result.url,
                name: finalSceneName,
                path: fullPath,
                message: `Scene '${finalSceneName}' created successfully`,
                sceneVerified: !!createdScene,
                canvas: canvasInfo,
              },
              verificationData: createdScene,
            })
          }).catch(() => {
            resolve({
              success: true,
              data: {
                uuid: result.uuid,
                url: result.url,
                name: finalSceneName,
                path: fullPath,
                message: `Scene '${finalSceneName}' created successfully (verification failed)`,
                canvas: canvasInfo,
              },
            })
          })
        }

        // autoCreateCanvas：先打开场景，再创建 2D Canvas 节点 + cc.Canvas 组件
        if (extraArgs.autoCreateCanvas === true) {
          this.bootstrapCanvasInScene(result.uuid)
            .then(info => finalize(info))
            .catch((err: Error) => finalize({ error: err.message }))
        }
        else {
          finalize()
        }
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async bootstrapCanvasInScene(sceneUuid: string): Promise<Record<string, unknown>> {
    // 1) 打开新建的场景
    await new Promise<void>((resolve, reject) => {
      Editor.Message.request('scene', 'open-scene', sceneUuid)
        .then(() => resolve())
        .catch((err: Error) => reject(err))
    })

    // 2) 等待场景就绪
    await new Promise<void>((resolve) => {
      const tryReady = () => {
        Editor.Message.request('scene', 'query-is-ready').then((ready: boolean) => {
          if (ready) {
            resolve()
          }
          else {
            setTimeout(tryReady, 100)
          }
        }).catch(() => {
          setTimeout(tryReady, 100)
        })
      }
      tryReady()
    })

    // 3) 拿场景根节点
    const tree = await requestScene('query-node-tree')
    if (!tree || !tree.uuid) {
      throw new Error('Failed to query scene root node after open')
    }

    // 4) 创建 2DNode "Canvas" 作为根节点的子节点（2DNode 类型自带 cc.UITransform）
    const createResult = await Editor.Message.request('scene', 'create-node', {
      name: 'Canvas',
      parent: tree.uuid,
      type: '2DNode',
    })
    const canvasUuid = Array.isArray(createResult) ? createResult[0] : createResult
    if (!canvasUuid) {
      throw new Error('Failed to create Canvas node')
    }

    // 5) 显式添加 cc.Canvas 组件
    try {
      await Editor.Message.request('scene', 'create-component', {
        uuid: canvasUuid,
        component: 'cc.Canvas',
      })
    }
    catch (canvasErr: unknown) {
      // 若 Canvas 已存在则忽略
      const msg = canvasErr instanceof Error ? canvasErr.message : String(canvasErr)
      if (!/already exists/i.test(msg)) {
        throw canvasErr
      }
    }

    return {
      canvasNodeUuid: canvasUuid,
      note: 'cc.UITransform is auto-attached on 2DNode. If cc.Canvas reports "already exists" you can ignore it.',
    }
  }

  private async getSceneHierarchy(includeComponents: boolean = false, rootUuid?: string, maxDepth?: number): Promise<ToolResponse> {
    try {
      const tree = await requestScene('query-node-tree')
      if (!tree) {
        return { success: false, error: 'No scene hierarchy available' }
      }

      const root = rootUuid ? this.findSceneNode(tree, rootUuid) : tree
      if (!root) {
        return { success: false, error: `Node with UUID ${rootUuid} not found` }
      }

      return {
        success: true,
        data: buildSceneHierarchy(root, includeComponents, maxDepth),
      }
    }
    catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private findSceneNode(node: SceneNodeDump, uuid: string): SceneNodeDump | undefined {
    if (node.uuid === uuid) {
      return node
    }
    for (const child of node.children ?? []) {
      const match = this.findSceneNode(child, uuid)
      if (match) {
        return match
      }
    }
    return undefined
  }

  private async saveSceneAs(path: string): Promise<ToolResponse> {
    return new Promise((resolve) => {
      // save-as-scene API 不接受路径参数，会弹出对话框让用户选择
      requestEditor('scene', 'save-as-scene').then(() => {
        resolve({
          success: true,
          data: {
            path,
            message: `Scene save-as dialog opened`,
          },
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }

  private async closeScene(): Promise<ToolResponse> {
    // 预检：没有打开的场景时直接 noop，避免触发 Cocos 内部
    // "Trying to close current edit scene in general edit mode is not allowed" 错误。
    try {
      const currentScene = await Editor.Message.request('scene', 'query-current-scene') as { uuid?: string } | null
      if (!currentScene || !currentScene.uuid) {
        return { success: true, message: 'No scene is open, no-op' }
      }
    }
    catch {
      // 查不到场景信息时不再继续 close
      return { success: true, message: 'No scene is open, no-op' }
    }

    return new Promise((resolve) => {
      Editor.Message.request('scene', 'close-scene').then(() => {
        resolve({
          success: true,
          message: 'Scene closed successfully',
        })
      }).catch((err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
  }
}
