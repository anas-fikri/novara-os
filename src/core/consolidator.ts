/**
 * Novara OS - Memory Consolidator
 *
 * Provides:
 * 1. Auto Rolling Summary  - Generates a rolling summary after each conversation turn
 *                            using the DEFAULT configured model (no separate cheap model needed)
 *                            with dynamic output limit (targetSummaryTokens)
 * 2. Background Consolidation - Runs consolidation in background (non-blocking)
 * 3. Meta Tagging         - Extracts tags/categories from conversation context
 * 4. Domain Guardrail     - Validates that conversation stays on-topic for the workspace
 *
 * Design decisions:
 * - Uses the same LLMProvider already configured (no separate model needed)
 * - Output is limited dynamically via maxOutputTokens in the prompt
 * - No expiration/TTL on summaries (developer may revisit years-old work)
 * - Summary stored in `.novara/memory/session_summary_{sessionName}.md`
 * - Meta tags stored in `.novara/memory/session_meta_{sessionName}.json`
 */

import fs from "fs";
import path from "path";
import { estimateTokens, compressText } from "./compressor.js";

export interface SessionSummary {
  sessionName: string;
  lastUpdated: string;
  turnCount: number;
  rollingText: string;  // The compressed rolling summary
  tags: string[];       // Meta tags extracted from conversation
  domain: string;       // Primary domain detected (coding, infra, research, etc.)
  keyDecisions: string[]; // Important decisions/changes made
}

export interface ConsolidatorConfig {
  targetSummaryTokens: number;  // Max tokens for the rolling summary (default: 300)
  guardrailDomains: string[];   // Allowed domains for this workspace (empty = unrestricted)
  enableAutoSummary: boolean;   // Auto-generate summary after each turn
  minTurnsBeforeSummary: number; // Only summarize after N turns (default: 3)
}

const DEFAULT_CONFIG: ConsolidatorConfig = {
  targetSummaryTokens: 300,
  guardrailDomains: [],
  enableAutoSummary: true,
  minTurnsBeforeSummary: 3,
};

// DOMAIN PATTERNS for meta-tagging
const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  "coding": [/\b(code|kode|bug|fix|function|fungsi|class|deploy|build|compile|test|debug|refactor|commit|git|npm|pip|typescript|python|javascript|rust|go|java)\b/i],
  "infrastructure": [/\b(server|docker|kubernetes|k8s|ssh|node|proxmox|nginx|caddy|vps|vm|container|deploy|port|firewall|ssl|cert|database|db|redis|postgres|mysql)\b/i],
  "research": [/\b(research|riset|analisis|analysis|laporan|report|artikel|article|paper|dokumentasi|documentation|studi|study|data|statistik|statistics)\b/i],
  "devops": [/\b(ci|cd|pipeline|workflow|github actions|gitlab ci|jenkins|terraform|ansible|helm|monitoring|alert|log|metric|grafana|prometheus)\b/i],
  "planning": [/\b(rencana|plan|roadmap|milestone|sprint|backlog|requirement|spesifikasi|specification|arsitektur|architecture|design|desain)\b/i],
};

export class MemoryConsolidator {
  private memoryDir: string;
  private config: ConsolidatorConfig;
  private consolidationInProgress: boolean = false;

  constructor(memoryDir: string, config: Partial<ConsolidatorConfig> = {}) {
    this.memoryDir = memoryDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Load existing session summary (or create empty one)
   */
  loadSummary(sessionName: string): SessionSummary {
    const summaryPath = this.getSummaryPath(sessionName);
    if (!fs.existsSync(summaryPath)) {
      return this.emptySession(sessionName);
    }
    try {
      const raw = fs.readFileSync(summaryPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return this.emptySession(sessionName);
    }
  }

  /**
   * Save session summary to disk
   */
  saveSummary(summary: SessionSummary): void {
    const summaryPath = this.getSummaryPath(summary.sessionName);
    try {
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    } catch {
      // Fail silently - summary is non-critical
    }
  }

  /**
   * List all sessions that have summaries
   */
  listSummarizedSessions(): string[] {
    if (!fs.existsSync(this.memoryDir)) return [];
    try {
      return fs.readdirSync(this.memoryDir)
        .filter(f => f.startsWith("session_summary_") && f.endsWith(".json"))
        .map(f => f.replace("session_summary_", "").replace(".json", ""));
    } catch {
      return [];
    }
  }

  /**
   * Delete summary for a session
   */
  deleteSummary(sessionName: string): void {
    const p = this.getSummaryPath(sessionName);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch {}
    }
  }

  /**
   * Extract meta tags from text content
   */
  extractTags(text: string): { tags: string[]; domain: string } {
    const detectedDomains: Record<string, number> = {};

    for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
      let score = 0;
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) score += matches.length;
      }
      if (score > 0) detectedDomains[domain] = score;
    }

    // Primary domain = highest score
    const sortedDomains = Object.entries(detectedDomains).sort((a, b) => b[1] - a[1]);
    const primaryDomain = sortedDomains[0]?.[0] || "general";
    const tags = sortedDomains.slice(0, 3).map(([d]) => d);

    return { tags, domain: primaryDomain };
  }

  /**
   * Check if a user query violates domain guardrails.
   * Returns null if OK, or a warning message if restricted.
   */
  checkGuardrail(query: string): string | null {
    if (!this.config.guardrailDomains || this.config.guardrailDomains.length === 0) {
      return null; // No restrictions
    }

    const { domain } = this.extractTags(query);
    const isAllowed = this.config.guardrailDomains.some(
      (d) => d.toLowerCase() === domain || domain === "general"
    );

    if (!isAllowed) {
      const allowedStr = this.config.guardrailDomains.join(", ");
      return `⚠️  Guardrail: Pertanyaan ini tampak di luar domain workspace (${domain}). Domain yang diizinkan: ${allowedStr}. Lanjutkan dengan peringatan.`;
    }

    return null;
  }

  /**
   * Generate a rolling summary using the LLM provider.
   * Called by the orchestrator AFTER each turn — runs in background (non-blocking).
   *
   * @param sessionName  Active session name
   * @param recentTurns  Last few conversation turns [{ role, content }]
   * @param provider     LLM provider instance (same model as main chat)
   * @param turnCount    Total turn count so far
   */
  async consolidateInBackground(
    sessionName: string,
    recentTurns: Array<{ role: string; content: string }>,
    provider: { generate: (msgs: any[], systemPrompt?: string) => Promise<{ text: string }> },
    turnCount: number
  ): Promise<void> {
    // Skip if already running or below threshold
    if (this.consolidationInProgress) return;
    if (turnCount < this.config.minTurnsBeforeSummary) return;
    if (!this.config.enableAutoSummary) return;

    // Fire and forget — non-blocking
    this.consolidationInProgress = true;
    setImmediate(async () => {
      try {
        await this.runConsolidation(sessionName, recentTurns, provider, turnCount);
      } catch {
        // Fail silently in background
      } finally {
        this.consolidationInProgress = false;
      }
    });
  }

  /**
   * Synchronous summary generation (used for /exit consolidation report)
   */
  async consolidateNow(
    sessionName: string,
    recentTurns: Array<{ role: string; content: string }>,
    provider: { generate: (msgs: any[], systemPrompt?: string) => Promise<{ text: string }> },
    turnCount: number
  ): Promise<SessionSummary> {
    return this.runConsolidation(sessionName, recentTurns, provider, turnCount);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async runConsolidation(
    sessionName: string,
    recentTurns: Array<{ role: string; content: string }>,
    provider: { generate: (msgs: any[], systemPrompt?: string) => Promise<{ text: string }> },
    turnCount: number
  ): Promise<SessionSummary> {
    const existing = this.loadSummary(sessionName);

    // Build compressed context of recent turns to send to LLM
    const turnText = recentTurns
      .filter((t) => t.role === "user" || t.role === "model")
      .slice(-8) // Max 8 turns for consolidation context
      .map((t) => {
        const prefix = t.role === "user" ? "USR" : "NOS";
        const { compressed } = compressText(t.content || "", { aggressive: true });
        // Limit each turn to 200 chars for consolidation context
        const snippet = compressed.length > 200 ? compressed.slice(0, 200) + "…" : compressed;
        return `${prefix}: ${snippet}`;
      })
      .join("\n");

    // Dynamic token limit for summary output
    const maxSummaryWords = Math.floor(this.config.targetSummaryTokens * 0.75); // rough word count

    const systemPrompt = `Kamu adalah sistem memory manager. Buat ringkasan singkat percakapan.
ATURAN WAJIB:
- Maksimum ${maxSummaryWords} kata
- Fokus: keputusan teknis, perubahan kode/infra, error yang ditemukan, solusi diterapkan
- Format: poin singkat, bahasa padat (caveman-style boleh)
- JANGAN tulis kalimat pembuka/penutup
- JANGAN tulis ulang hal teknis yang tidak relevan`;

    const existingSummaryContext = existing.rollingText
      ? `[Summary sebelumnya]:\n${existing.rollingText}\n\n`
      : "";

    const userMsg = `${existingSummaryContext}[Percakapan terbaru (sesi: ${sessionName}, giliran ke-${turnCount})]:\n${turnText}\n\nUpdate ringkasan:`;

    let newSummaryText = "";
    try {
      const result = await provider.generate(
        [{ role: "user", content: userMsg }],
        systemPrompt
      );
      newSummaryText = result.text?.trim() || "";
    } catch {
      // If LLM fails, compress existing manually
      const { compressed } = compressText(existing.rollingText + "\n" + turnText, {
        maxTokens: this.config.targetSummaryTokens,
        aggressive: true,
      });
      newSummaryText = compressed;
    }

    // Ensure summary doesn't exceed token budget (compress if needed)
    if (estimateTokens(newSummaryText) > this.config.targetSummaryTokens) {
      const { compressed } = compressText(newSummaryText, {
        maxTokens: this.config.targetSummaryTokens,
        aggressive: true,
      });
      newSummaryText = compressed;
    }

    // Extract meta tags from full context
    const fullContext = (existing.rollingText || "") + " " + turnText;
    const { tags, domain } = this.extractTags(fullContext);

    // Extract key decisions (lines starting with action words)
    const decisionLines = newSummaryText
      .split("\n")
      .filter((line) => line.match(/^[-•*]\s*(tambah|buat|hapus|ubah|fix|perbaiki|install|update|refactor|deploy|setup|create|add|remove|change|implement)/i))
      .slice(0, 5)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim());

    const updatedSummary: SessionSummary = {
      sessionName,
      lastUpdated: new Date().toISOString(),
      turnCount,
      rollingText: newSummaryText,
      tags,
      domain,
      keyDecisions: decisionLines,
    };

    this.saveSummary(updatedSummary);
    return updatedSummary;
  }

  private getSummaryPath(sessionName: string): string {
    return path.join(this.memoryDir, `session_summary_${sessionName}.json`);
  }

  private emptySession(sessionName: string): SessionSummary {
    return {
      sessionName,
      lastUpdated: new Date().toISOString(),
      turnCount: 0,
      rollingText: "",
      tags: [],
      domain: "general",
      keyDecisions: [],
    };
  }

  getConfig(): ConsolidatorConfig {
    return this.config;
  }

  updateConfig(partial: Partial<ConsolidatorConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
