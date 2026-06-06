import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";


import fs from "fs";
import path from "path";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();

  async connectServer(config: McpServerConfig): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        stderr: "pipe"
      });

      if (transport.stderr) {
        const novaraDir = path.join(process.cwd(), ".novara");
        if (fs.existsSync(novaraDir)) {
          const logDir = path.join(novaraDir, "logs");
          if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
          }
          const logStream = fs.createWriteStream(path.join(logDir, `${config.name}.log`), { flags: "a" });
          transport.stderr.pipe(logStream);
        } else {
          transport.stderr.resume(); // consume stream to avoid blocking
        }
      }

      const client = new Client(
        {
          name: `novara-client-${config.name}`,
          version: "0.1.0"
        },
        {
          capabilities: {
            tools: {},
            roots: {
              listChanged: true
            }
          }
        }
      );

      // Register request handler for listing roots
      client.setRequestHandler(ListRootsRequestSchema, async () => {
        return {
          roots: [
            {
              uri: `file://${process.cwd()}`,
              name: "workspace-root"
            }
          ]
        };
      });

      await client.connect(transport);

      
      this.clients.set(config.name, client);
      this.transports.set(config.name, transport);
    } catch (err: any) {
      console.warn(`[MCP] Failed to connect to server "${config.name}": ${err.message}`);
    }
  }

  async listAllTools(): Promise<Array<{ serverName: string; name: string; description: string; inputSchema: any }>> {
    const allTools: any[] = [];
    
    for (const [serverName, client] of this.clients.entries()) {
      try {
        const response = await client.listTools();
        if (response && response.tools) {
          for (const tool of response.tools) {
            allTools.push({
              serverName,
              name: tool.name, // We will keep track of which server owns this tool
              description: tool.description || "",
              inputSchema: tool.inputSchema
            });
          }
        }
      } catch (err: any) {
        console.warn(`[MCP] Failed to list tools from server "${serverName}": ${err.message}`);
      }
    }

    return allTools;
  }

  async callTool(toolName: string, args: any): Promise<string> {
    // Find which client owns this tool
    for (const [serverName, client] of this.clients.entries()) {
      try {
        const toolsResponse = await client.listTools();
        const hasTool = toolsResponse.tools.some((t) => t.name === toolName);
        if (hasTool) {
          const result = await client.callTool({
            name: toolName,
            arguments: args
          });

          // Standard output format for MCP tools is content array of text/image
          if (result && result.content) {
            return result.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n");
          }
          return JSON.stringify(result);
        }
      } catch {
        // Continue searching in other clients
      }
    }
    throw new Error(`Tool "${toolName}" not found on any active MCP server.`);
  }

  async shutdown(): Promise<void> {
    for (const [name, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch (err: any) {
        console.warn(`[MCP] Error closing transport for "${name}": ${err.message}`);
      }
    }
    this.clients.clear();
    this.transports.clear();
  }
}
