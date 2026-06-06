#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const reportPath = '.novara/bug_report.json';
const novaraDir = '.novara';

// Ensure .novara directory exists
if (!fs.existsSync(novaraDir)) {
  fs.mkdirSync(novaraDir, { recursive: true });
}

// Automatically detect target test command from package.json or defaults
let testCommand = 'npm test';

if (fs.existsSync('package.json')) {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    if (pkg.scripts && pkg.scripts.test) {
      testCommand = 'npm run test';
    }
  } catch (err) {
    // Ignore and fallback
  }
} else if (fs.existsSync('requirements.txt') || fs.existsSync('setup.py')) {
  testCommand = 'pytest';
}

console.log(`🚀 Menguji kode dengan perintah: "${testCommand}"...`);

try {
  const stdout = execSync(testCommand, { encoding: 'utf-8', stdio: 'pipe' });
  console.log("✅ Pengujian berhasil! Semua test case lolos.");
  
  // Save clean report
  fs.writeFileSync(reportPath, JSON.stringify({
    status: "success",
    timestamp: new Date().toISOString(),
    bugs: [],
    message: "Semua pengujian berjalan lancar dengan sukses."
  }, null, 2));
  
  process.exit(0);
} catch (error) {
  console.log("❌ Pengujian gagal. Menganalisis stack trace...");
  const rawLog = error.stdout || error.stderr || error.message || "";
  
  // Extract file, line, and message pattern
  // Matches: /path/to/file.js:12:34 or /path/to/file.py:12
  const errorRegex = /(?:at\s+)?([/a-zA-Z0-9_\.-]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/g;
  const matches = [...rawLog.matchAll(errorRegex)];
  
  const uniqueBugs = [];
  const seen = new Set();
  
  for (const match of matches) {
    const filePath = match[1];
    const line = parseInt(match[2], 10);
    const col = match[3] ? parseInt(match[3], 10) : 0;
    
    // Ignore node internals, test libraries, or mock directories
    if (
      filePath.includes('node_modules') || 
      filePath.includes('internal/') ||
      filePath.includes('node:internal')
    ) {
      continue;
    }
    
    const key = `${filePath}:${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueBugs.push({
        file: filePath,
        line: line,
        column: col,
        context: `Ditemukan kegagalan/exception di baris ini.`
      });
    }
    
    // Limit to top 5 bugs to save token context
    if (uniqueBugs.length >= 5) break;
  }

  const report = {
    status: "failed",
    timestamp: new Date().toISOString(),
    test_command: testCommand,
    bugs: uniqueBugs,
    raw_error_snippet: rawLog.substring(0, 1000) // snippet to keep token context minimal
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📁 Hasil saringan bug disimpan di: ${reportPath}`);
  process.exit(1);
}
