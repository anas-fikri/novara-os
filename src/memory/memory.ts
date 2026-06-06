import fs from "fs";
import path from "path";

export interface ChatMessage {
  role: "user" | "model" | "system" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export class MemorySystem {
  private memoryDir: string;
  private historyPath: string;
  private factsPath: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.historyPath = path.join(this.memoryDir, "chat_history.jsonl");
    this.factsPath = path.join(this.memoryDir, "facts.json");
  }

  saveMessage(msg: ChatMessage) {
    const logLine = JSON.stringify({ timestamp: new Date().toISOString(), ...msg }) + "\n";
    fs.appendFileSync(this.historyPath, logLine, "utf-8");
  }

  getRecentHistory(limit: number = 30): ChatMessage[] {
    if (!fs.existsSync(this.historyPath)) {
      return [];
    }
    const content = fs.readFileSync(this.historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const messages: ChatMessage[] = [];

    // Parse last N lines
    const startIndex = Math.max(0, lines.length - limit);
    for (let i = startIndex; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        messages.push({
          role: parsed.role,
          content: parsed.content,
          name: parsed.name,
          toolCallId: parsed.toolCallId
        });
      } catch (err) {
        // Skip malformed log lines
      }
    }
    return messages;
  }

  clearHistory() {
    if (fs.existsSync(this.historyPath)) {
      fs.unlinkSync(this.historyPath);
    }
  }

  getFacts(): Record<string, string> {
    if (!fs.existsSync(this.factsPath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.factsPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  saveFact(key: string, value: string) {
    const facts = this.getFacts();
    facts[key] = value;
    fs.writeFileSync(this.factsPath, JSON.stringify(facts, null, 2), "utf-8");
  }

  deleteFact(key: string) {
    const facts = this.getFacts();
    delete facts[key];
    fs.writeFileSync(this.factsPath, JSON.stringify(facts, null, 2), "utf-8");
  }
}
