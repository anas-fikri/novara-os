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
  private historyPath!: string;
  private factsPath: string;
  private activeSessionName: string = "default";

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.factsPath = path.join(this.memoryDir, "facts.json");

    // Ensure memory directory exists
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }

    // Legacy migration: Rename legacy chat_history.jsonl to chat_history_default.jsonl
    const legacyHistoryPath = path.join(this.memoryDir, "chat_history.jsonl");
    const defaultHistoryPath = path.join(this.memoryDir, "chat_history_default.jsonl");
    if (fs.existsSync(legacyHistoryPath) && !fs.existsSync(defaultHistoryPath)) {
      try {
        fs.renameSync(legacyHistoryPath, defaultHistoryPath);
      } catch {}
    }

    // Load last active session name or default to "default"
    const activeSessionPath = path.join(this.memoryDir, "active_session.txt");
    let activeSession = "default";
    if (fs.existsSync(activeSessionPath)) {
      try {
        activeSession = fs.readFileSync(activeSessionPath, "utf-8").trim() || "default";
      } catch {}
    }
    this.setSession(activeSession);
  }

  setSession(sessionName: string) {
    const cleanSessionName = sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    this.activeSessionName = cleanSessionName || "default";
    this.historyPath = path.join(this.memoryDir, `chat_history_${this.activeSessionName}.jsonl`);

    const activeSessionPath = path.join(this.memoryDir, "active_session.txt");
    try {
      fs.writeFileSync(activeSessionPath, this.activeSessionName, "utf-8");
    } catch {}
  }

  getActiveSession(): string {
    return this.activeSessionName;
  }

  listSessions(): string[] {
    if (!fs.existsSync(this.memoryDir)) return ["default"];
    try {
      const files = fs.readdirSync(this.memoryDir);
      const sessions = files
        .filter((file) => file.startsWith("chat_history_") && file.endsWith(".jsonl"))
        .map((file) => file.substring("chat_history_".length, file.length - ".jsonl".length));
      return sessions.length > 0 ? sessions : ["default"];
    } catch {
      return ["default"];
    }
  }

  deleteSession(sessionName: string) {
    const sessionFile = path.join(this.memoryDir, `chat_history_${sessionName}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      try {
        fs.unlinkSync(sessionFile);
      } catch {}
    }
    if (this.activeSessionName === sessionName) {
      this.setSession("default");
    }
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
