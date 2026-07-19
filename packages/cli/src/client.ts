// ============================================================
// WebSocket 客户端 — CLI 与 Server 通信
// ============================================================

import WebSocket from 'ws';
import { StreamEvent, ModelConfig } from '@ai-cli/shared';

export interface CLICommand {
  type: 'init' | 'message' | 'system' | 'get_tools' | 'set_config' | 'reset' | 'ping';
  content?: string;
  conversationId?: string;
  config?: Partial<ModelConfig>;
}

export class ServerClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private conversationId = '';
  private silent: boolean;
  private messageListeners: Set<(event: StreamEvent) => void> = new Set();

  constructor(silent = false) {
    this.silent = silent;
  }

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.connected = true;
        if (!this.silent) console.error(`[ai-cli] 已连接到 ${url}`);
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'init_ok') {
            this.conversationId = event.conversationId;
          }
          for (const listener of this.messageListeners) {
            listener(event);
          }
        } catch {
          // ignore malformed
        }
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  onMessage(listener: (event: StreamEvent) => void): void {
    this.messageListeners.add(listener);
  }

  offMessage(listener: (event: StreamEvent) => void): void {
    this.messageListeners.delete(listener);
  }

  send(cmd: CLICommand): void {
    if (!this.connected || !this.ws) {
      throw new Error('未连接到服务器');
    }
    const msg: CLICommand & { conversationId?: string } = { ...cmd };
    if (this.conversationId && (cmd.type === 'message' || cmd.type === 'init' || cmd.type === 'reset')) {
      msg.conversationId = this.conversationId;
    }
    this.ws.send(JSON.stringify(msg));
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConversationId(): string {
    return this.conversationId;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
