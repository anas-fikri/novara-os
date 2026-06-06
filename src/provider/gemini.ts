import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChatMessage } from "../memory/memory.js";

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: any;
}

// Inner helper class for Gemini API
class GeminiBaseProvider {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string;

  constructor(modelName: string) {
    this.modelName = modelName;
  }

  private init() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in secrets.env or system environment.");
    }
    if (!this.genAI) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  setModel(modelName: string) {
    this.modelName = modelName;
  }

  getModel(): string {
    return this.modelName;
  }

  async generate(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: ProviderTool[]
  ): Promise<{ text: string; toolCalls?: any[] }> {
    this.init();
    if (!this.genAI) throw new Error("GenAI initialization failed.");

    // Convert tools to Gemini format
    let geminiTools: any[] | undefined = undefined;
    if (tools && tools.length > 0) {
      geminiTools = [
        {
          functionDeclarations: tools.map((t) => {
            const parameters = {
              type: "OBJECT",
              properties: t.inputSchema?.properties || {},
              required: t.inputSchema?.required || []
            };

            for (const prop of Object.values(parameters.properties) as any[]) {
              if (prop.type) {
                prop.type = prop.type.toUpperCase();
              }
            }

            return {
              name: t.name,
              description: t.description,
              parameters
            };
          })
        }
      ];
    }

    // Default to a safe model string if contains path
    const targetModel = this.modelName.includes("/") ? this.modelName.split("/")[1] : this.modelName;
    const finalModel = targetModel === "gemini-2.5-flash" ? "gemini-1.5-flash" : targetModel;

    const model = this.genAI.getGenerativeModel({
      model: finalModel,
      systemInstruction: systemPrompt,
      tools: geminiTools
    });

    const contents: any[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }]
        });
      }

      if (msg.role === "model") {
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCallId) {
          try {
            parts.push(...JSON.parse(msg.toolCallId));
          } catch {}
        }
        contents.push({ role: "model", parts });
      }

      if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.name || "",
                response: { result: msg.content }
              }
            }
          ]
        });
      }
    }

    const result = await model.generateContent({ contents });
    const response = result.response;
    const text = response.text() || "";
    const functionCalls = response.functionCalls();

    return {
      text,
      toolCalls: functionCalls ? functionCalls.map((c) => ({
        id: c.name,
        name: c.name,
        args: c.args
      })) : undefined
    };
  }
}

// Unified LLM Provider supporting Gemini, OpenRouter, OpenAI, and Ollama
export class LLMProvider {
  private activeProvider: string; // "gemini" | "openrouter" | "ollama" | "openai"
  private modelName: string;
  private geminiProvider: GeminiBaseProvider;

  constructor(providerConfig: string = "gemini/gemini-1.5-flash") {
    const parts = providerConfig.split("/");
    this.activeProvider = parts[0].toLowerCase();
    this.modelName = parts.slice(1).join("/");
    this.geminiProvider = new GeminiBaseProvider(this.modelName);
  }

  setModel(providerConfig: string) {
    const parts = providerConfig.split("/");
    this.activeProvider = parts[0].toLowerCase();
    this.modelName = parts.slice(1).join("/");
    this.geminiProvider.setModel(this.modelName);
  }

  getModel(): string {
    return `${this.activeProvider}/${this.modelName}`;
  }

  async generate(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: ProviderTool[]
  ): Promise<{ text: string; toolCalls?: any[] }> {
    
    if (this.activeProvider === "gemini") {
      return this.geminiProvider.generate(messages, systemPrompt, tools);
    }

    // Call OpenAI-compatible endpoints
    let baseUrl = "";
    let apiKey = "";

    if (this.activeProvider === "openrouter") {
      baseUrl = "https://openrouter.ai/api/v1";
      apiKey = process.env.OPENROUTER_API_KEY || "";
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not defined in secrets.env.");
    } else if (this.activeProvider === "openai") {
      baseUrl = "https://api.openai.com/v1";
      apiKey = process.env.OPENAI_API_KEY || "";
      if (!apiKey) throw new Error("OPENAI_API_KEY is not defined in secrets.env.");
    } else if (this.activeProvider === "ollama") {
      baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      apiKey = "ollama"; // dummy key
    } else if (this.activeProvider === "9router") {
      baseUrl = process.env.NINEROUTER_BASE_URL || "http://localhost:20128/v1";
      apiKey = process.env.NINEROUTER_API_KEY || "9router";
    } else if (this.activeProvider === "cliproxy") {
      baseUrl = process.env.CLIPROXY_BASE_URL || "http://127.0.0.1:8317/v1";
      apiKey = process.env.CLIPROXY_API_KEY || "cliproxy";
    } else {
      throw new Error(`Unsupported provider: ${this.activeProvider}`);
    }

    // Format tools to OpenAI JSON format
    const openaiTools = tools && tools.length > 0 ? tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }
    })) : undefined;

    // Format messages list
    const formattedMessages = messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.name,
          content: msg.content
        };
      }
      if (msg.role === "model") {
        let tool_calls: any[] | undefined = undefined;
        if (msg.toolCallId) {
          try {
            const parsed = JSON.parse(msg.toolCallId);
            tool_calls = parsed.map((c: any) => ({
              id: c.functionCall?.name || "call_id",
              type: "function",
              function: {
                name: c.functionCall?.name,
                arguments: JSON.stringify(c.functionCall?.args || {})
              }
            }));
          } catch {}
        }
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls
        };
      }
      return {
        role: msg.role === "system" ? "system" : "user",
        content: msg.content
      };
    });

    // Inject system prompt if missing
    if (systemPrompt && !formattedMessages.some((m) => m.role === "system")) {
      formattedMessages.unshift({ role: "system", content: systemPrompt });
    }

    // Make API request via native global fetch
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(this.activeProvider === "openrouter" ? {
          "HTTP-Referer": "https://github.com/anasfikri/novara-os",
          "X-Title": "Novara OS"
        } : {})
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: formattedMessages,
        tools: openaiTools
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error from ${this.activeProvider}: ${response.status} - ${errText}`);
    }

    const data: any = await response.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || "";
    
    let toolCalls: any[] | undefined = undefined;
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      toolCalls = choice.message.tool_calls.map((c: any) => ({
        id: c.function?.name || c.id,
        name: c.function?.name,
        args: typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments) : c.function.arguments
      }));
    }

    return { text, toolCalls };
  }
}

// Re-export under the original name for backward compatibility
export { LLMProvider as GeminiProvider };
