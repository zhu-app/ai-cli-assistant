// ============================================================
// WebSocket Server — 流式 AI 对话后端
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import {
  Message,
  StreamEvent,
  ServerConfig,
  Conversation,
  createConversation,
  ModelConfig,
} from '@ai-cli/shared';
import { MCPToolExecutor } from '@ai-cli/tools';
import { createProvider } from './ai-provider';

// 最多保留的系统消息外最近 N 条对话
const MAX_MESSAGES = 40;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 128 * 1024;
const ALLOWED_MESSAGE_TYPES = new Set([
  'init',
  'system',
  'message',
  'get_tools',
  'set_config',
  'reset',
  'ping',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** 截断消息历史，保留 system 提示 + 最近 N 条对话 */
export function truncateMessages(messages: Message[]): Message[] {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const chatMsgs = messages.filter((m) => m.role !== 'system');
  return [...systemMsgs, ...chatMsgs.slice(-MAX_MESSAGES)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireBoundedString(value: unknown, label: string, maxBytes = MAX_MESSAGE_BYTES): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}不能为空`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label}超过 ${maxBytes} 字节上限`);
  }
  return value;
}

export function validateModelConfigPatch(value: unknown): Partial<ModelConfig> {
  if (!isRecord(value)) throw new Error('模型配置必须是对象');
  const allowed = new Set(['provider', 'model', 'apiKey', 'baseUrl', 'maxTokens', 'temperature']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`不支持的模型配置字段: ${key}`);
  }

  const result: Partial<ModelConfig> = {};
  if (value.provider !== undefined) {
    if (!['anthropic', 'openai', 'custom'].includes(String(value.provider))) {
      throw new Error('provider 必须是 anthropic、openai 或 custom');
    }
    result.provider = value.provider as ModelConfig['provider'];
  }
  if (value.model !== undefined) result.model = requireBoundedString(value.model, 'model', 200);
  if (value.apiKey !== undefined) result.apiKey = requireBoundedString(value.apiKey, 'apiKey', 4096);
  if (value.baseUrl !== undefined) {
    const baseUrl = requireBoundedString(value.baseUrl, 'baseUrl', 2048);
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error('baseUrl 必须是有效 URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('baseUrl 只允许 http 或 https');
    }
    if (parsed.username || parsed.password) throw new Error('baseUrl 不能包含用户名或密码');
    result.baseUrl = parsed.toString().replace(/\/$/, '');
  }
  if (value.maxTokens !== undefined) {
    if (!Number.isInteger(value.maxTokens) || Number(value.maxTokens) < 1 || Number(value.maxTokens) > 200_000) {
      throw new Error('maxTokens 必须是 1 到 200000 之间的整数');
    }
    result.maxTokens = Number(value.maxTokens);
  }
  if (value.temperature !== undefined) {
    if (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) ||
        value.temperature < 0 || value.temperature > 2) {
      throw new Error('temperature 必须是 0 到 2 之间的数字');
    }
    result.temperature = value.temperature;
  }
  return result;
}

export class AIServer {
  private wss!: WebSocketServer;
  private config: ServerConfig;
  private conversations = new Map<string, Conversation>();
  private connectionConversations = new WeakMap<WebSocket, Set<string>>();
  private silent: boolean;
  readonly ready: Promise<void>;

  constructor(config: ServerConfig, silent = false) {
    const host = config.host || '127.0.0.1';
    if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
      throw new Error('服务端没有身份认证，只允许监听本机回环地址');
    }
    this.config = config;
    this.silent = silent;
    this.ready = new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: config.port ?? 3210,
        host,
        maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
      }, () => resolve());

      // 监听错误事件（端口冲突等），防止进程崩溃
      this.wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          if (!this.silent) console.error(`[ai-cli-server] 端口 ${config.port || 3210} 已被占用，请先关闭其他实例或更换端口`);
        } else {
          if (!this.silent) console.error(`[ai-cli-server] 服务器错误:`, err.message);
        }
        reject(err);
      });

      this.setupHandlers();
    });
  }

  private setupHandlers(): void {
    this.wss.on('listening', () => {
      const addr = this.wss.address();
      if (addr && typeof addr !== 'string' && !this.silent) {
        console.log(`[ai-cli-server] 监听 ws://${addr.address}:${addr.port}`);
      }
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.connectionConversations.set(ws, new Set());
      if (!this.silent) console.log('[ai-cli-server] 新客户端连接');

      ws.on('message', async (data: Buffer) => {
        try {
          if (data.byteLength > MAX_WEBSOCKET_PAYLOAD_BYTES) throw new Error('消息体过大');
          const msg: unknown = JSON.parse(data.toString('utf8'));
          if (!isRecord(msg) || typeof msg.type !== 'string' || !ALLOWED_MESSAGE_TYPES.has(msg.type)) {
            throw new Error('消息格式或类型无效');
          }
          await this.handleMessage(ws, msg);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            error: `消息解析失败: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      });

      ws.on('close', () => {
        for (const conversationId of this.connectionConversations.get(ws) || []) {
          this.conversations.delete(conversationId);
        }
        this.connectionConversations.delete(ws);
        if (!this.silent) console.log('[ai-cli-server] 客户端断开连接');
      });

      ws.on('error', (err) => {
        console.error('[ai-cli-server] 连接错误:', err.message);
      });

      // 发送就绪信号
      ws.send(JSON.stringify({ type: 'ready' }));
    });
  }

  private async handleMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'init':
        await this.handleInit(ws, msg);
        break;
      case 'system':
        await this.handleSystem(ws, msg);
        break;
      case 'message':
        await this.handleChat(ws, msg);
        break;
      case 'get_tools':
        this.handleGetTools(ws);
        break;
      case 'set_config':
        this.handleSetConfig(ws, msg);
        break;
      case 'reset':
        this.handleReset(ws, msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', error: `未知消息类型: ${msg.type}` }));
    }
  }

  private async handleInit(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const convId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
    const owned = this.connectionConversations.get(ws)!;
    const existingConv = convId && owned.has(convId) ? this.conversations.get(convId) : null;

    if (existingConv) {
      ws.send(JSON.stringify({
        type: 'init_ok',
        conversationId: existingConv.id,
        messageCount: existingConv.messages.length,
      }));
    } else {
      const conv = createConversation();
      this.conversations.set(conv.id, conv);
      owned.add(conv.id);
      ws.send(JSON.stringify({
        type: 'init_ok',
        conversationId: conv.id,
        messageCount: 0,
      }));
    }
  }

  private async handleSystem(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const content = requireBoundedString(msg.content, '系统消息内容');
    const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';

    const conv = this.getOwnedConversation(ws, conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: '会话未初始化，请先发送 init 消息' }));
      return;
    }

    // 清除旧的 system 消息，追加新的（确保 system 消息始终在对话最前面）
    conv.messages = conv.messages.filter((m) => m.role !== 'system');
    conv.messages.unshift({ role: 'system', content });
    conv.updatedAt = Date.now();

    ws.send(JSON.stringify({ type: 'system_ok' }));
  }

  private async handleChat(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const content = requireBoundedString(msg.content, '消息内容');
    const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';

    const conv = this.getOwnedConversation(ws, conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: '会话未初始化，请先发送 init 消息' }));
      return;
    }

    // 添加用户消息到会话
    const userMessage: Message = { role: 'user', content };
    conv.messages.push(userMessage);
    conv.updatedAt = Date.now();

    try {
      const provider = createProvider(this.config.model, new MCPToolExecutor({
        workspaceRoot: this.config.cwd || process.cwd(),
        allowShell: this.config.allowShell,
        allowGitCommit: this.config.allowGitCommit,
      }));
      // 截断过长对话，防止 token 超限
      const messagesToSend = truncateMessages(conv.messages);

      // 流式输出
      await provider.chatStream(messagesToSend, (event: StreamEvent) => {
        ws.send(JSON.stringify(event));

        // 收集 assistant 回复
        if (event.type === 'text') {
          const lastMsg = conv.messages[conv.messages.length - 1];
          if (lastMsg?.role === 'assistant') {
            lastMsg.content += event.content;
          } else {
            conv.messages.push({ role: 'assistant', content: event.content });
          }
          conv.updatedAt = Date.now();
        }
      });
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'error',
        error: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }

  private handleGetTools(ws: WebSocket): void {
    const executor = new MCPToolExecutor({
      workspaceRoot: this.config.cwd || process.cwd(),
      allowShell: this.config.allowShell,
      allowGitCommit: this.config.allowGitCommit,
    });
    const tools = executor.getToolDefinitions();
    ws.send(JSON.stringify({
      type: 'tools',
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }));
  }

  private handleSetConfig(ws: WebSocket, msg: Record<string, unknown>): void {
    const newConfig = validateModelConfigPatch(msg.config);
    this.config.model = { ...this.config.model, ...newConfig };
    ws.send(JSON.stringify({ type: 'config_updated' }));
  }

  private handleReset(ws: WebSocket, msg: Record<string, unknown>): void {
    const convId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
    if (convId) {
      const conv = this.getOwnedConversation(ws, convId);
      if (conv) {
        conv.messages = [];
        conv.updatedAt = Date.now();
      }
    }
    ws.send(JSON.stringify({ type: 'reset_ok' }));
  }

  private getOwnedConversation(ws: WebSocket, conversationId: string): Conversation | undefined {
    if (!conversationId || !this.connectionConversations.get(ws)?.has(conversationId)) return undefined;
    return this.conversations.get(conversationId);
  }

  stop(): void {
    this.wss.close();
  }
}
