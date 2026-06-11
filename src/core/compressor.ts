/**
 * Novara OS - Built-in Context Compressor
 *
 * Inspired by caveman-compress philosophy:
 * "Why use many words when few words do trick?"
 *
 * Strips filler/redundant grammar while preserving:
 * - ALL code blocks (byte-for-byte)
 * - File paths, URLs, technical terms
 * - Numbers, constraints, error messages
 * - Markdown headings and list structure
 *
 * Target: ~40-60% token reduction on conversational text
 */

// Words to strip when they appear at the start of a sentence / are standalone fillers
const FILLER_PHRASES: RegExp[] = [
  // Pleasantries and hedging
  /^(tentu saja|tentu|baiklah|baik|oke|ok|boleh|sangat senang|dengan senang hati|saya akan|saya dapat|saya bisa|mari kita|ayo|silahkan|silakan),?\s*/i,
  /^(of course|sure|certainly|absolutely|great|awesome|definitely|happy to|i'll|i will|i can|let me|let's|please|go ahead),?\s*/i,
  /\b(pada dasarnya|sebenarnya|sejatinya|intinya|perlu dicatat bahwa|perlu diingat bahwa|harap diingat bahwa)\b/gi,
  /\b(essentially|basically|fundamentally|it should be noted that|it is worth noting that|please note that|keep in mind that)\b/gi,
  // Redundant connectors
  /^(selain itu,?\s*|lebih lanjut,?\s*|tambahan lagi,?\s*)/i,
  /^(additionally,?\s*|furthermore,?\s*|moreover,?\s*|in addition,?\s*)/i,
  // Verbose sentence starters
  /^(dalam konteks ini,?\s*|berkaitan dengan hal ini,?\s*)/i,
  /^(in this context,?\s*|with regard to this,?\s*|regarding this,?\s*)/i,
];

// Articles and auxiliary verbs to collapse (only in non-code context)
const COLLAPSE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(adalah|merupakan|ialah)\b/g, "="],
  [/\byang\s+(?=\w)/g, ""],
  [/\bdengan menggunakan\b/gi, "pakai"],
  [/\buntuk dapat\b/gi, "agar"],
  [/\bsehingga dapat\b/gi, "→"],
  [/\byang kemudian\b/gi, "lalu"],
  [/\btidak ada\b/gi, "∅"],
];

/**
 * Compress a single line of plain text (non-code)
 */
function compressLine(line: string): string {
  let out = line;

  // Strip filler phrases at line start
  for (const pat of FILLER_PHRASES) {
    out = out.replace(pat, "");
  }

  // Collapse verbose patterns
  for (const [pat, replacement] of COLLAPSE_PATTERNS) {
    out = out.replace(pat, replacement);
  }

  // Collapse multiple spaces
  out = out.replace(/  +/g, " ").trim();

  return out;
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for Latin/Indonesian text)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compress text while preserving code blocks, file paths, and structure.
 * Returns compressed text and compression ratio.
 */
export function compressText(text: string, options: { maxTokens?: number; aggressive?: boolean } = {}): {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
} {
  const originalTokens = estimateTokens(text);

  if (!text || text.trim().length === 0) {
    return { compressed: text, originalTokens: 0, compressedTokens: 0, ratio: 1.0 };
  }

  // Split into segments: code blocks vs plain text
  const segments: Array<{ type: "code" | "text"; content: string }> = [];
  const codeBlockRegex = /```[\s\S]*?```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[0] }); // Preserve verbatim
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  // Process each segment
  const processedSegments = segments.map((seg) => {
    if (seg.type === "code") return seg.content; // Never touch code

    const lines = seg.content.split("\n");
    const processedLines = lines.map((line) => {
      // Preserve markdown headings, list items, and empty lines
      if (line.match(/^#{1,6}\s/) || line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/) || line.trim() === "") {
        return line;
      }
      return compressLine(line);
    });

    let result = processedLines.join("\n");

    // If aggressive mode: collapse multiple blank lines into one
    if (options.aggressive) {
      result = result.replace(/\n{3,}/g, "\n\n");
    }

    return result;
  });

  let compressed = processedSegments.join("");

  // If maxTokens specified, truncate with indicator
  if (options.maxTokens && estimateTokens(compressed) > options.maxTokens) {
    const charLimit = options.maxTokens * 4;
    // Try to truncate at a sentence boundary
    const truncated = compressed.slice(0, charLimit);
    const lastPeriod = Math.max(truncated.lastIndexOf("."), truncated.lastIndexOf("\n"));
    compressed = (lastPeriod > charLimit * 0.8 ? truncated.slice(0, lastPeriod + 1) : truncated) + "\n[... dikompresi ...]";
  }

  const compressedTokens = estimateTokens(compressed);
  const ratio = originalTokens > 0 ? compressedTokens / originalTokens : 1.0;

  return { compressed, originalTokens, compressedTokens, ratio };
}

/**
 * Compress a list of ChatMessages to fit within a target token budget.
 * Strategy:
 * 1. Always keep system messages intact
 * 2. Keep the most recent N messages verbatim (recency bias)
 * 3. Compress older messages aggressively
 * 4. If still over budget, drop oldest compressed messages
 */
export function compressHistory(
  messages: Array<{ role: string; content: string; name?: string; toolCallId?: string }>,
  targetTokens: number,
  keepRecentCount: number = 6
): Array<{ role: string; content: string; name?: string; toolCallId?: string }> {
  if (messages.length === 0) return messages;

  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content || ""), 0);

  if (totalTokens <= targetTokens) return messages; // Already fits

  // Split: recent (verbatim) vs older (compress)
  const recent = messages.slice(-keepRecentCount);
  const older = messages.slice(0, -keepRecentCount);

  // Compress older messages
  const compressedOlder = older.map((msg) => {
    if (msg.role === "system") return msg; // Never touch system

    // Skip tool result messages that are very short
    if ((msg.role === "tool" || msg.role === "model") && (msg.content?.length || 0) < 100) return msg;

    const { compressed } = compressText(msg.content || "", { aggressive: true });
    return { ...msg, content: compressed };
  });

  let combined = [...compressedOlder, ...recent];

  // If still over budget, drop oldest non-system messages
  while (combined.reduce((sum, m) => sum + estimateTokens(m.content || ""), 0) > targetTokens && combined.length > keepRecentCount) {
    // Find first non-system message to drop
    const dropIdx = combined.findIndex((m) => m.role !== "system");
    if (dropIdx === -1) break;
    combined.splice(dropIdx, 1);
  }

  return combined;
}
