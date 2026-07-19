// ============================================================
// AI 模型适配器 — 支持 Anthropic / OpenAI / 自定义
// ============================================================

import { Message, ModelConfig, ToolCall, StreamEvent } from '@ai-cli/shared';
import { MCPToolExecutor, MCPTool } from '@ai-cli/tools';

export abstract class AIProvider {
  protected config: ModelConfig;
  protected toolExecutor: MCPToolExecutor;

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    this.config = config;
    this.toolExecutor = toolExecutor;
  }

  abstract chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void>;
}

// ==================== Anthropic Claude ====================

export class AnthropicProvider extends AIProvider {
  private client: any; // Anthropic SDK v0.52 类型不稳定，使用 any

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    super(config, toolExecutor);
    const Anthropic = require('@anthropic-ai/sdk');
    const AnthropicClass = Anthropic.default || Anthropic;
    this.client = new AnthropicClass({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }

  private convertTools(tools: MCPTool[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * 将 Message[] 转为 Anthropic 格式的 messages 数组（content 为 content block 数组）
   * 注意：tool_result 类型的消息需要特殊处理为 content block 格式
   */
  private toAnthropicMessages(messages: Message[]): Array<{ role: string; content: any }> {
    const result: Array<{ role: string; content: any }> = [];
    for (const m of messages) {
      if (m.role === 'system') continue; // system 通过顶层 system 参数传入

      const contentStr = m.content;

      // 检测是否是工具结果标记（由本类内部生成，格式为 JSON）
      // 普通消息直接作为字符串 content
      result.push({
        role: m.role,
        content: contentStr,
      });
    }
    return result;
  }

  async chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void> {
    const tools = this.toolExecutor.getToolDefinitions();
    const systemContent = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const convertedTools = this.convertTools(tools);

    // 构建对话消息列表（可变，后续会追加 assistant 回复和 tool_result）
    const conversation: Array<{ role: string; content: any }> = this.toAnthropicMessages(messages);

    let maxRounds = 10;
    while (maxRounds-- > 0) {
      const stream = await this.client.messages.stream({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature ?? 0.3,
        system: systemContent,
        messages: conversation,
        tools: convertedTools,
        stream: true,
      });

      // 收集本次流式响应的所有 content block
      const contentBlocks: Array<{ type: string; [key: string]: any }> = [];
      let currentBlock: { type: string; [key: string]: any } | null = null;
      let toolUseId = '';
      let toolUseName = '';
      let toolUseInput = '';
      let hadToolCall = false;

      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            currentBlock = { ...event.content_block };
            if (event.content_block.type === 'text') {
              contentBlocks.push({ type: 'text', text: '' });
            } else if (event.content_block.type === 'tool_use') {
              hadToolCall = true;
              toolUseId = event.content_block.id;
              toolUseName = event.content_block.name;
              toolUseInput = '';
              contentBlocks.push({
                type: 'tool_use',
                id: event.content_block.id,
                name: event.content_block.name,
                input: '',
              });
            }
            break;
          }
          case 'content_block_delta': {
            if (event.delta.type === 'text_delta') {
              // 更新最后一个 text block 的内容
              const lastBlock = contentBlocks[contentBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.text += event.delta.text;
              }
              onEvent({ type: 'text', content: event.delta.text });
            } else if (event.delta.type === 'input_json_delta') {
              toolUseInput += event.delta.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            if (currentBlock?.type === 'tool_use') {
              // 更新 tool_use block 的完整 input
              const block = contentBlocks.find(
                (b) => b.type === 'tool_use' && b.id === toolUseId
              );
              if (block) {
                try {
                  block.input = JSON.parse(toolUseInput);
                } catch {
                  block.input = {};
                }
              }
            }
            currentBlock = null;
            break;
          }
          case 'message_delta':
            break;
          case 'error':
            onEvent({ type: 'error', error: event.error?.message || 'Anthropic API 错误' });
            return;
        }
      }

      // 如果没有工具调用，直接结束
      if (!hadToolCall) {
        onEvent({ type: 'done' });
        return;
      }

      // 将 AI 的完整回复（含 tool_use blocks）追加到对话
      conversation.push({
        role: 'assistant',
        content: contentBlocks.map((block) => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text };
          }
          if (block.type === 'tool_use') {
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          }
          return block;
        }),
      });

      // 执行所有工具调用，并将 tool_result 追加到对话
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          const call: ToolCall = {
            id: block.id,
            name: block.name,
            arguments: (block.input || {}) as Record<string, unknown>,
          };
          onEvent({ type: 'tool_call', call });

          const result = await this.toolExecutor.execute(call);
          onEvent({ type: 'tool_result', result });

          conversation.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.success ? result.output : `错误: ${result.error}`,
              },
            ],
          });
        }
      }
    }

    // 达到最大轮次
    onEvent({ type: 'error', error: '工具调用轮次过多，已停止' });
  }
}

// ==================== OpenAI ====================

export class OpenAIProvider extends AIProvider {
  private client: import('openai').OpenAI;

  constructor(config: ModelConfig, toolExecutor: MCPToolExecutor) {
    super(config, toolExecutor);
    const OpenAI = require('openai');
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  private convertTools(tools: MCPTool[]): any[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async chatStream(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void> {
    const tools = this.toolExecutor.getToolDefinitions();
    let conversation: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [];

    // 构建初始消息
    let systemContent = '';
    for (const m of messages) {
      if (m.role === 'system') {
        systemContent += m.content + '\n';
      } else {
        conversation.push({ role: m.role, content: m.content });
      }
    }
    if (systemContent) {
      conversation.unshift({ role: 'system', content: systemContent.trim() });
    }

    const convertedTools = this.convertTools(tools);

    // 循环处理：AI 可能多次调工具
    let maxRounds = 10;
    while (maxRounds-- > 0) {
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature ?? 0.3,
        messages: conversation as any[],
        tools: convertedTools,
        stream: true,
      });

      let toolCallId = '';
      let toolCallName = '';
      let toolCallArgs = '';
      let hadToolCall = false;
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          onEvent({ type: 'text', content: delta.content });
        }

        if (delta.tool_calls) {
          hadToolCall = true;
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) toolCallName += tc.function.name;
            if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
            if (tc.id) toolCallId = tc.id;
          }
        }
      }

      if (finishReason === 'tool_calls' && hadToolCall) {
        // 解析并执行工具
        let inputObj: Record<string, unknown> = {};
        try { inputObj = JSON.parse(toolCallArgs); } catch { /* ignore */ }

        const call: ToolCall = { id: toolCallId, name: toolCallName, arguments: inputObj };
        onEvent({ type: 'tool_call', call });

        const result = await this.toolExecutor.execute(call);
        onEvent({ type: 'tool_result', result });

        // 把 AI 的工具调用和工具结果加回对话，让 AI 继续
        conversation.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: toolCallId,
            type: 'function',
            function: { name: toolCallName, arguments: toolCallArgs },
          }],
        } as any);
        conversation.push({
          role: 'tool',
          content: result.success ? result.output : `错误: ${result.error}`,
          tool_call_id: toolCallId,
        });

        // 重新发请求
        toolCallId = '';
        toolCallName = '';
        toolCallArgs = '';
        continue;
      }

      // finish_reason === 'stop' 或其他情况，结束
      onEvent({ type: 'done' });
      return;
    }

    // 达到最大轮次
    onEvent({ type: 'error', error: '工具调用轮次过多，已停止' });
  }
}

// ==================== 提供者工厂 ====================

export function createProvider(
  config: ModelConfig,
  toolExecutor: MCPToolExecutor
): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config, toolExecutor);
    case 'openai':
    case 'custom':
      return new OpenAIProvider(config, toolExecutor);
    default:
      throw new Error(`不支持的模型提供商: ${config.provider}`);
  }
}
