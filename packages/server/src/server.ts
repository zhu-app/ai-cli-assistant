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
  ModelProvider,
} from '@ai-cli/shared';
import { MCPToolExecutor } from '@ai-cli/tools';
import { createProvider } from './ai-provider';

// 最多保留的系统消息外最近 N 条对话
const MAX_MESSAGES = 40;

/** 截断消息历史，保留 system 提示 + 最近 N 条对话 */
function truncateMessages(messages: Message[]): Message[] {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const chatMsgs = messages.filter((m) => m.role !== 'system');
  if (chatMsgs.length > MAX_MESSAGES) {
    chatMsgs.length = MAX_MESSAGES; // 截取最后 MAX_MESSAGES 条
  }
  return [...systemMsgs, ...chatMsgs];
}

export class AIServer {
  private wss!: WebSocketServer;
  private config: ServerConfig;
  private conversations = new Map<string, Conversation>();
  private silent: boolean;
  readonly ready: Promise<void>;

  constructor(config: ServerConfig, silent = false) {
    this.config = config;
    this.silent = silent;
    this.ready = new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: config.port || 3210,
        host: config.host || '127.0.0.1',
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
      if (!this.silent) console.log('[ai-cli-server] 新客户端连接');

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(ws, msg);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            error: `消息解析失败: ${err instanceof Error ? err.message : String(err)}`,
          }));
        }
      });

      ws.on('close', () => {
        if (!this.silent) console.log('[ai-cli-server] 客户端断开连接');
      });

      ws.on('error', (err) => {
        console.error('[ai-cli-server] 连接错误:', err.message);
      });

      // 发送就绪信号
      ws.send(JSON.stringify({ type: 'ready' }));
    });
  }

  private async handleMessage(ws: WebSocket, msg: any): Promise<void> {
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

  private async handleInit(ws: WebSocket, msg: any): Promise<void> {
    const convId = msg.conversationId || '';
    const existingConv = convId ? this.conversations.get(convId) : null;

    if (existingConv) {
      ws.send(JSON.stringify({
        type: 'init_ok',
        conversationId: existingConv.id,
        messageCount: existingConv.messages.length,
      }));
    } else {
      const conv = createConversation();
      this.conversations.set(conv.id, conv);
      ws.send(JSON.stringify({
        type: 'init_ok',
        conversationId: conv.id,
        messageCount: 0,
      }));
    }
  }

  private async handleSystem(ws: WebSocket, msg: any): Promise<void> {
    const content = msg.content as string;
    const conversationId = msg.conversationId as string;

    if (!content) {
      ws.send(JSON.stringify({ type: 'error', error: '系统消息内容不能为空' }));
      return;
    }

    const conv = conversationId ? this.conversations.get(conversationId) : null;
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

  private async handleChat(ws: WebSocket, msg: any): Promise<void> {
    const content = msg.content as string;
    const conversationId = msg.conversationId as string;

    if (!content) {
      ws.send(JSON.stringify({ type: 'error', error: '消息内容不能为空' }));
      return;
    }

    const conv = this.conversations.get(conversationId);
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', error: '会话未初始化，请先发送 init 消息' }));
      return;
    }

    // 添加用户消息到会话
    const userMessage: Message = { role: 'user', content };
    conv.messages.push(userMessage);
    conv.updatedAt = Date.now();

    try {
      const provider = createProvider(this.config.model, new MCPToolExecutor());
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
    const executor = new MCPToolExecutor();
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

  private handleSetConfig(ws: WebSocket, msg: any): void {
    const newConfig = msg.config as Partial<ModelConfig>;
    this.config.model = { ...this.config.model, ...newConfig };
    ws.send(JSON.stringify({ type: 'config_updated' }));
  }

  private handleReset(ws: WebSocket, msg: any): void {
    const convId = msg.conversationId as string;
    if (convId) {
      const conv = this.conversations.get(convId);
      if (conv) {
        conv.messages = [];
        conv.updatedAt = Date.now();
      }
    }
    ws.send(JSON.stringify({ type: 'reset_ok' }));
  }

  stop(): void {
    this.wss.close();
  }
}
