/**
 * Dev Test 工具调用客户端
 * 走 panel → main 进程 IPC（Editor.Message.request callTool 通道），
 * 落到 main 进程的 mcpServer.executeToolCall，与真实 MCP server 调用完全一致。
 */

export async function callTool(toolName: string, args: any): Promise<any> {
  return await Editor.Message.request('cocos-mcp-server', 'callTool', toolName, args ?? {})
}
