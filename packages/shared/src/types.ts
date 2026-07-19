// ============================================================
// @ai-cli/shared — 共享类型定义
// ============================================================

// --- AI 模型提供商 ---
export type ModelProvider = 'anthropic' | 'openai' | 'custom';

// --- 消息角色 ---
export type MessageRole = 'user' | 'assistant' | 'system';

// --- 消息 ---
export interface Message {
  role: MessageRole;
  content: string;
}

// --- 工具调用 ---
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// --- 工具结果 ---
export interface ToolResult {
  id: string;
  name: string;
  success: boolean;
  output: string;
  error?: string;
}

// --- 流式事件 ---
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'tools'; tools: Array<{ name: string; description: string; parameters: any }> }
  | { type: 'done' }
  | { type: 'error'; error: string };

// --- 会话 ---
export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// --- 模型配置 ---
export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

// --- Server 配置 ---
export interface ServerConfig {
  model: ModelConfig;
  port?: number;
  host?: string;
  cwd?: string;
}

// --- CLI 配置 ---
export interface CLIConfig {
  serverUrl: string;
  model: ModelConfig;
}
