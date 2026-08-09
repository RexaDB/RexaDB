import {
  AgentTool,
  AgentToolContext,
  AgentToolResult,
  GeminiFunctionCall,
  GeminiToolWrapper,
  OpenAIFunctionTool,
  OpenAIFunctionToolCall,
  ToolArgs,
} from "@/tools/types";

function safeParseJsonObject(raw: string): ToolArgs {
  if (!raw || !raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as ToolArgs;
}

export class ToolRegistry {
  private readonly toolsByName: Map<string, AgentTool>;

  constructor(tools: AgentTool[]) {
    this.toolsByName = new Map();

    for (const tool of tools) {
      if (this.toolsByName.has(tool.name)) {
        throw new Error(`Duplicate tool name detected: ${tool.name}`);
      }
      this.toolsByName.set(tool.name, tool);
    }
  }

  list(): AgentTool[] {
    return Array.from(this.toolsByName.values());
  }

  get(name: string): AgentTool | undefined {
    return this.toolsByName.get(name);
  }

  toOpenAIFunctionTools(strict: boolean = true): OpenAIFunctionTool[] {
    return this.list().map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict,
    }));
  }

  toGeminiTools(): GeminiToolWrapper[] {
    return [
      {
        functionDeclarations: this.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];
  }

  catalog(): Array<{ provider: string; name: string; description: string; parameters: unknown }> {
    return this.list().map((tool) => ({
      provider: tool.provider,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async execute(name: string, args: ToolArgs, context: AgentToolContext): Promise<AgentToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${name}`,
      };
    }

    return tool.execute(args, context);
  }

  async executeOpenAIFunctionCall(
    call: OpenAIFunctionToolCall,
    context: AgentToolContext,
  ): Promise<{ callId: string; output: AgentToolResult }> {
    const args = safeParseJsonObject(call.arguments);
    const output = await this.execute(call.name, args, context);
    return {
      callId: call.call_id,
      output,
    };
  }

  async executeGeminiFunctionCall(
    call: GeminiFunctionCall,
    context: AgentToolContext,
  ): Promise<{ name: string; output: AgentToolResult }> {
    const rawArgs = call.args && typeof call.args === "object" ? call.args : {};
    const output = await this.execute(call.name, rawArgs, context);
    return {
      name: call.name,
      output,
    };
  }
}
