import fs from "fs";
import path from "path";

export interface SearchResult {
  filePath: string;
  snippet: string;
  score: number;
}

export class KnowledgeSystem {
  private workspaceDir: string;
  private maxDepth: number = 4;
  private maxFileSize: number = 100 * 1024; // 100 KB limit for search index

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  // Quick recursive file crawler
  private crawlFiles(dir: string, currentDepth: number = 0): string[] {
    if (currentDepth > this.maxDepth) return [];
    
    let results: string[] = [];
    try {
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        // Ignore common build/config/version-control folders
        if (
          file === "node_modules" ||
          file === ".git" ||
          file === "dist" ||
          file === ".novara" ||
          file === ".cora.yaml" ||
          file.startsWith(".")
        ) {
          continue;
        }

        if (stat.isDirectory()) {
          results = results.concat(this.crawlFiles(fullPath, currentDepth + 1));
        } else if (stat.isFile()) {
          // Check file extensions suitable for indexing
          const ext = path.extname(file).toLowerCase();
          if ([".md", ".txt", ".yaml", ".yml", ".json", ".conf", ".ini", ".sh"].includes(ext)) {
            if (stat.size <= this.maxFileSize) {
              results.push(fullPath);
            }
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
    return results;
  }

  // Simple token-based keyword search over the workspace files
  search(query: string, limit: number = 3): SearchResult[] {
    const files = this.crawlFiles(this.workspaceDir);
    const queryTokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    
    if (queryTokens.length === 0) return [];
    
    const matches: SearchResult[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        let score = 0;
        let bestSnippet = "";
        let bestLineIndex = -1;

        // Substring / token match score
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          let lineScore = 0;
          for (const token of queryTokens) {
            if (lineLower.includes(token)) {
              lineScore += 1;
            }
          }
          if (lineScore > 0) {
            score += lineScore;
            if (lineScore > (bestLineIndex === -1 ? 0 : bestLineIndex)) {
              bestLineIndex = i;
            }
          }
        }

        if (score > 0) {
          // Assemble a snippet around the best matching line
          const start = Math.max(0, bestLineIndex - 2);
          const end = Math.min(lines.length - 1, bestLineIndex + 3);
          const snippet = lines.slice(start, end + 1).join("\n");
          
          matches.push({
            filePath: path.relative(this.workspaceDir, file),
            snippet: snippet,
            score: score
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by score descending and return top matches
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
