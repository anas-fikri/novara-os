import { WorkspaceManager, WorkspaceConfig } from "../workspace/workspace.js";
import { MemorySystem, ChatMessage } from "../memory/memory.js";
import { KnowledgeSystem } from "../knowledge/knowledge.js";
import { GeminiProvider } from "../provider/gemini.js";
import { McpClientManager } from "../mcp/mcp-client.js";
import { runInteractiveSetup } from "../workspace/setup.js";
import { MemoryConsolidator, ConsolidatorConfig } from "./consolidator.js";
import { compressHistory } from "./compressor.js";
import prompts from "prompts";
import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import https from "https";
import http from "http";

export class CoreOrchestrator {
  private workspaceManager: WorkspaceManager;
  private memorySystem!: MemorySystem;
  private knowledgeSystem!: KnowledgeSystem;
  private mcpManager!: McpClientManager;
  private provider!: GeminiProvider;
  private config!: WorkspaceConfig;
  private consolidator!: MemoryConsolidator;
  private openRouterModels: Array<{ id: string; name: string }> = [];
  private sessionTurnCount: number = 0;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceManager = new WorkspaceManager(workspaceDir);
  }

  getActiveSession(): string {
    return this.memorySystem ? this.memorySystem.getActiveSession() : "default";
  }

  async checkForUpdates(): Promise<string | null> {
    try {
      const response = await fetch("https://raw.githubusercontent.com/anas-fikri/novara-os/main/package.json", {
        signal: AbortSignal.timeout(1500)
      });
      if (!response.ok) return null;
      const data = (await response.json()) as any;
      const remoteVersion = data.version;
      const localVersion = "0.1.0";
      
      if (remoteVersion && remoteVersion !== localVersion) {
        const parseVersion = (v: string) => v.split(".").map(Number);
        const [rMajor, rMinor, rPatch] = parseVersion(remoteVersion);
        const [lMajor, lMinor, lPatch] = parseVersion(localVersion);
        
        if (
          rMajor > lMajor ||
          (rMajor === lMajor && rMinor > lMinor) ||
          (rMajor === lMajor && rMinor === lMinor && rPatch > lPatch)
        ) {
          return remoteVersion;
        }
      }
    } catch {
      // Fail silently
    }
    return null;
  }

  async init(): Promise<void> {
    if (!this.workspaceManager.isWorkspace()) {
      throw new Error("Directory is not a Novara OS workspace. Run 'novara init' first.");
    }
    
    // Load config and secrets
    this.config = this.workspaceManager.loadConfig();
    this.workspaceManager.loadSecrets();

    // Initialize systems
    this.memorySystem = new MemorySystem(this.workspaceManager.getMemoryDir());
    this.knowledgeSystem = new KnowledgeSystem(this.workspaceManager.getWorkspaceDir());
    this.mcpManager = new McpClientManager();
    this.provider = new GeminiProvider(this.config.provider.default);

    // Initialize Memory Consolidator with workspace-level config if present
    const consolidatorConfig = (this.config as any).memory_consolidator as Partial<ConsolidatorConfig> | undefined;
    this.consolidator = new MemoryConsolidator(
      this.workspaceManager.getMemoryDir(),
      consolidatorConfig || {}
    );

    // Restore session turn count from existing message count
    this.sessionTurnCount = Math.floor(this.memorySystem.getMessageCount() / 2);

    // Boot MCP Servers
    if (this.config.mcp_servers && this.config.mcp_servers.length > 0) {
      const spinner = ora("Memulai MCP Servers...").start();
      for (const server of this.config.mcp_servers) {
        await this.mcpManager.connectServer(server);
      }
      spinner.succeed("MCP Servers aktif");
    }

    // Fetch OpenRouter models in the background asynchronously
    this.fetchOpenRouterModels().then((models) => {
      this.openRouterModels = models;
    }).catch(() => {});
  }

  /**
   * Get the current session summary (for display or injection)
   */
  getSessionSummary(): import("./consolidator.js").SessionSummary | null {
    if (!this.consolidator) return null;
    const s = this.consolidator.loadSummary(this.memorySystem.getActiveSession());
    return s.turnCount > 0 ? s : null;
  }

  /**
   * Trigger immediate (synchronous) consolidation — used on /exit
   */
  async consolidateSessionNow(): Promise<import("./consolidator.js").SessionSummary | null> {
    if (!this.consolidator || this.sessionTurnCount < 1) return null;
    const history = this.memorySystem.getRecentHistory(20);
    try {
      return await this.consolidator.consolidateNow(
        this.memorySystem.getActiveSession(),
        history,
        this.provider,
        this.sessionTurnCount
      );
    } catch {
      return null;
    }
  }

  private isMutativeTool(toolName: string): boolean {
    const mutativePrefixes = ["write", "replace", "delete", "create", "execute", "run", "edit", "mkdir", "rm", "destroy", "post", "put"];
    const nameLower = toolName.toLowerCase();
    return mutativePrefixes.some((prefix) => nameLower.startsWith(prefix) || nameLower.includes(`_${prefix}`));
  }

  private assembleSystemPrompt(userQuery: string, agentType?: string): string {
    const primaryLang = this.config.settings?.localization?.primary_language || "id";
    const fallbackLang = this.config.settings?.localization?.fallback_language || "en";
    
    // Language instructions
    const langInstructions = primaryLang === "id"
      ? `PENTING: Komunikasikan semua hasil, analisis, penjelasan, dan interaksi dengan pengguna menggunakan Bahasa Indonesia secara alami dan profesional. Gunakan Bahasa Inggris (atau '${fallbackLang}') hanya jika istilah teknis tidak memiliki terjemahan yang tepat.`
      : `IMPORTANT: Communicate with the user using ${primaryLang}. Fallback to ${fallbackLang} if necessary.`;

    // Fetch facts from memory
    const facts = this.memorySystem.getFacts();
    const factsStr = Object.keys(facts).length > 0
      ? `\n[Persistent Facts / User Preferences]:\n${JSON.stringify(facts, null, 2)}`
      : "";

    // Fetch relevant local knowledge files
    const searchResults = this.knowledgeSystem.search(userQuery, 3);
    const knowledgeStr = searchResults.length > 0
      ? `\n[Relevant Local Knowledge Documents]:\n` + searchResults.map((r) => `--- File: ${r.filePath} ---\n${r.snippet}`).join("\n\n")
      : "";

    // Inject rolling session summary if available (token-efficient context continuity)
    let summaryStr = "";
    if (this.consolidator && !agentType) { // Only for main agent, not sub-agents
      const summary = this.consolidator.loadSummary(this.memorySystem.getActiveSession());
      if (summary.rollingText) {
        summaryStr = `\n[Ringkasan Sesi Sebelumnya (${summary.sessionName}, giliran ke-${summary.turnCount})]:\n${summary.rollingText}\nTag: ${summary.tags.join(", ")} | Domain: ${summary.domain}`;
      }
    }

    let roleDescription = `Anda adalah Novara OS, sebuah Workspace-Oriented Intelligence Operating System.
Misi Anda adalah membantu pengguna mengelola kode, dokumentasi, server, dan alur kerja dalam workspace ini.`;

    if (agentType === "infrastructure") {
      roleDescription = `Anda adalah Sub-Agent INFRASTRUCTURE dari Novara OS.
Tugas utama Anda adalah mengelola node server, SSH, Docker container, dan cluster Proxmox.
Fokus pada keandalan sistem, pemeriksaan status konektivitas node, pembacaan log server remote, dan manajemen kontainer/VM.
Laporkan hasil tindakan Anda secara terperinci.`;
    } else if (agentType === "research") {
      roleDescription = `Anda adalah Sub-Agent RESEARCH dari Novara OS.
Tugas utama Anda adalah mengumpulkan informasi, melakukan analisis data, membaca dokumen knowledge/codebase, dan merangkum temuan.
Fokus pada akurasi informasi, pencarian fakta, dan penyusunan ringkasan komprehensif. Anda tidak boleh memodifikasi infrastruktur server atau melakukan tindakan destruktif.`;
    } else if (agentType === "coder") {
      roleDescription = `Anda adalah Sub-Agent CODER dari Novara OS.
Tugas utama Anda adalah menulis kode, mengedit file konfigurasi, merancang arsitektur perangkat lunak, dan memperbaiki bug.
Fokus pada kualitas kode, dokumentasi API, dan kepatuhan terhadap standar pengembangan.`;
    } else if (agentType === "general") {
      roleDescription = `Anda adalah Sub-Agent GENERAL dari Novara OS.
Tugas Anda adalah membantu koordinasi tugas umum dan merespons pertanyaan bantuan umum dalam workspace.`;
    }

    return `${roleDescription}

${langInstructions}
${summaryStr}
${factsStr}
${knowledgeStr}

Instruksi tambahan:
1. Selesaikan tugas pengguna dengan memanggil alat-alat (tools) yang disediakan.
2. Jika Anda perlu mengubah file, jalankan perintah berbahaya, atau menghapus resource, pastikan Anda meminta persetujuan pengguna terlebih dahulu (melalui integrasi persetujuan di runtime).
3. Usahakan untuk menghemat token dengan tidak membaca file besar secara keseluruhan jika tidak diperlukan. gunakan grep/pencarian baris.
`;
  }

  async runTask(userQuery: string, interactive: boolean = false, agentType?: string): Promise<string> {
    // ── Guardrail check (domain prompt restriction) ──────────────────────────
    if (this.consolidator && !agentType) {
      const guardrailWarning = this.consolidator.checkGuardrail(userQuery);
      if (guardrailWarning) {
        console.log(chalk.hex("#f9e2af")(guardrailWarning));
      }
    }

    const systemPrompt = this.assembleSystemPrompt(userQuery, agentType);
    
    // Load recent chat history
    let history = this.memorySystem.getRecentHistory(20);

    // ── Context compression if history is token-heavy (>= 4000 tokens) ───────
    const TOKEN_BUDGET = 4000;
    const historyTokens = history.reduce((sum, m) => sum + Math.ceil((m.content || "").length / 4), 0);
    if (historyTokens > TOKEN_BUDGET) {
      history = compressHistory(history, TOKEN_BUDGET, 6) as ChatMessage[];
    }
    
    // Add current user query to execution context
    const sessionMessages: ChatMessage[] = [
      ...history,
      { role: "user", content: userQuery }
    ];

    // Log the user prompt to memory
    this.memorySystem.saveMessage({ role: "user", content: userQuery });

    let loop = true;
    let iterations = 0;
    const maxIterations = this.config.settings?.max_iterations ?? 300;
    let lastResponseText = "";

    while (loop && iterations < maxIterations) {
      iterations++;
      
      const spinner = ora(chalk.blue("Memproses langkah...")).start();
      
      // Get all tools from MCP
      const mcpTools = await this.mcpManager.listAllTools();

      // Native built-in tools for self-evolution and infrastructure node management
      const nativeTools = [
        {
          name: "record_fact",
          description: "Menyimpan fakta atau preferensi pengguna ke memori jangka panjang secara otomatis dari percakapan. GUARDRAIL: HANYA catat preferensi/fakta permanen (misal: OS, arsitektur, standar kode). DILARANG KERAS merekam status debugging, error sementara, atau log eksekusi.",
          inputSchema: {
            type: "object",
            properties: {
              key: { type: "string", description: "Kunci fakta/preferensi (misal: editor_pilihan)" },
              value: { type: "string", description: "Nilai dari fakta (misal: vscode)" }
            },
            required: ["key", "value"]
          }
        },
        {
          name: "record_knowledge",
          description: "Menulis catatan pengetahuan baru ke dalam basis pengetahuan workspace agar terekam secara otomatis.",
          inputSchema: {
            type: "object",
            properties: {
              fileName: { type: "string", description: "Nama file markdown (misal: panduan_deploy.md)" },
              content: { type: "string", description: "Isi catatan markdown lengkap" }
            },
            required: ["fileName", "content"]
          }
        },
        {
          name: "record_skill",
          description: "Membuat skill baru berupa kumpulan instruksi/prosedur kerja spesifik ke folder skill workspace.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nama skill (misal: push_ke_git)" },
              description: { type: "string", description: "Deskripsi singkat skill" },
              instructions: { type: "string", description: "Isi instruksi detail markdown yang akan ditulis ke SKILL.md" }
            },
            required: ["name", "description", "instructions"]
          }
        },
        {
          name: "node_list",
          description: "Mendapatkan daftar semua node server/infrastruktur remote (seperti SSH atau Docker) yang terdaftar di konfigurasi workspace beserta status koneksinya.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "node_execute",
          description: "Mengeksekusi perintah shell secara remote pada node Linux/UNIX yang terdaftar di workspace menggunakan SSH (memerlukan persetujuan karena berpotensi mutatif).",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan eksekusi (contoh: app-server-prod)" },
              command: { type: "string", description: "Perintah shell/bash yang ingin dieksekusi" }
            },
            required: ["nodeName", "command"]
          }
        },
        {
          name: "node_read_file",
          description: "Membaca isi file log atau file konfigurasi secara remote pada node yang terdaftar menggunakan SSH secara aman.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan (contoh: app-server-prod)" },
              filePath: { type: "string", description: "Path mutlak menuju file di server remote" },
              lines: { type: "number", description: "Jumlah baris dari akhir file yang ingin dibaca (opsional, menggunakan tail)" }
            },
            required: ["nodeName", "filePath"]
          }
        },
        {
          name: "docker_list_containers",
          description: "Mendapatkan daftar kontainer Docker pada node tertentu (baik lokal maupun remote) beserta statusnya.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan (contoh: homelab-docker)" },
              all: { type: "boolean", description: "Tampilkan semua kontainer (termasuk yang berhenti), default false hanya yang running" }
            },
            required: ["nodeName"]
          }
        },
        {
          name: "docker_container_execute_action",
          description: "Mengubah status kontainer Docker (start, stop, restart, pause, unpause) pada node tertentu (memerlukan persetujuan karena mutatif).",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" },
              action: { type: "string", description: "Aksi status (pilihan: start, stop, restart, pause, unpause)" }
            },
            required: ["nodeName", "containerId", "action"]
          }
        },
        {
          name: "docker_container_logs",
          description: "Mendapatkan log stdout/stderr dari kontainer Docker tertentu.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" },
              lines: { type: "number", description: "Jumlah baris log dari akhir yang ingin diambil (default 50)" }
            },
            required: ["nodeName", "containerId"]
          }
        },
        {
          name: "docker_inspect_container",
          description: "Mendapatkan konfigurasi detail objek kontainer Docker dalam format JSON.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" }
            },
            required: ["nodeName", "containerId"]
          }
        },
        {
          name: "proxmox_list_resources",
          description: "Mendapatkan daftar semua VM (qemu), LXC container, node fisik, dan storage pada cluster Proxmox VE.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE terdaftar (contoh: proxmox-pve)" },
              type: { type: "string", description: "Filter tipe resource (opsional, pilihan: vm, storage, node, lxc, qemu)" }
            },
            required: ["nodeName"]
          }
        },
        {
          name: "proxmox_vm_execute_action",
          description: "Mengubah status daya VM qemu atau LXC container (start, stop, shutdown, reboot, suspend) pada cluster Proxmox (memerlukan persetujuan karena mutatif).",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE terdaftar" },
              vmid: { type: "number", description: "ID virtual machine atau container (contoh: 100)" },
              action: { type: "string", description: "Aksi status (pilihan: start, stop, shutdown, reboot, suspend)" }
            },
            required: ["nodeName", "vmid", "action"]
          }
        },
        {
          name: "proxmox_inspect_vm",
          description: "Mendapatkan status terkini dan detail konfigurasi dari VM qemu atau LXC container di Proxmox VE.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE terdaftar" },
              vmid: { type: "number", description: "ID virtual machine atau container (contoh: 100)" },
              vmType: { type: "string", description: "Tipe virtualisasi (pilihan: qemu, lxc)" }
            },
            required: ["nodeName", "vmid", "vmType"]
          }
        },
        {
          name: "delegate_task",
          description: "Mendelegasikan sub-tugas tertentu ke sub-agent khusus (seperti 'infrastructure', 'research', 'coder', atau 'hermes') dan mendapatkan laporan hasilnya.",
          inputSchema: {
            type: "object",
            properties: {
              agentType: { type: "string", description: "Tipe sub-agent (pilihan: infrastructure, research, coder, general, hermes)" },
              subTaskQuery: { type: "string", description: "Deskripsi tugas spesifik yang harus diselesaikan sub-agent" }
            },
            required: ["agentType", "subTaskQuery"]
          }
        }
      ];

      const allActiveTools = [...mcpTools, ...nativeTools];
      
      try {
        const response = await this.provider.generate(sessionMessages, systemPrompt, allActiveTools);
        spinner.stop();

        // Print text response if any
        if (response.text) {
          lastResponseText = response.text;
          console.log(chalk.green(`\n🤖 Novara OS:`));
          console.log(this.formatMarkdownResponse(response.text));
          console.log(chalk.gray("─".repeat(64)));
          
          sessionMessages.push({ role: "model", content: response.text });
          this.memorySystem.saveMessage({ role: "model", content: response.text });
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Store raw tool calls details for Gemini context history
          const rawCallsStr = JSON.stringify(response.toolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.args }
          })));
          
          sessionMessages.push({
            role: "model",
            content: `Memanggil tool: ${response.toolCalls.map(c => c.name).join(", ")}`,
            toolCallId: rawCallsStr
          });

          for (const call of response.toolCalls) {
            console.log(chalk.hex("#f9e2af")(`\n⚙️  [Agent Activity] Memanggil alat: `) + chalk.bold.hex("#89b4fa")(call.name));
            console.log(chalk.hex("#a6adc8")(`   Args   » `) + chalk.hex("#9399b2")(JSON.stringify(call.args)));
            
            let result: string = "";
            let execute = true;

            // Security gatekeep for mutative tools (ignore native tools from manual gatekeeping)
            const isNative = ["record_fact", "record_knowledge", "record_skill", "delegate_task"].includes(call.name);
            if (interactive && this.isMutativeTool(call.name) && !isNative) {
              let approved = false;
              let filePath = call.args?.path || call.args?.filePath || call.args?.targetFile || call.args?.file || "";
              let fileContent = call.args?.content || call.args?.codeContent || call.args?.replacementContent || "";

              while (!approved) {
                console.log(chalk.bold.hex("#f38ba8")("\n🚨 Persetujuan Diperlukan untuk Alat Mutatif:"));
                console.log(`   Alat    : ${chalk.cyan(call.name)}`);
                if (filePath) {
                  console.log(`   Berkas  : ${chalk.yellow(filePath)}`);
                }

                const choices = [
                  { title: "Ya (Setujui Eksekusi)", value: "yes" },
                  { title: "Tidak (Tolak Eksekusi)", value: "no" }
                ];

                if (fileContent) {
                  choices.push(
                    { title: "🔍 Lihat Pratinjau Isi (Preview)", value: "preview" },
                    { title: "✏️  Edit Isi Sebelum Disetujui (Modify)", value: "edit" }
                  );
                }

                choices.push(
                  { title: "Steer (Beri Koreksi Kustom)", value: "steer" },
                  { title: "Keluar (Batalkan Seluruh Tugas)", value: "quit" }
                );

                const approval = await prompts({
                  type: "select",
                  name: "action",
                  message: `Pilih aksi untuk '${call.name}':`,
                  choices,
                  initial: 0
                });

                if (approval.action === "yes") {
                  execute = true;
                  approved = true;
                } else if (approval.action === "no") {
                  execute = false;
                  result = "Execution rejected by user.";
                  approved = true;
                } else if (approval.action === "preview") {
                  console.log(chalk.bold.green("\n--- PRATINJAU ISI BERKAS ---"));
                  const lines = fileContent.split("\n");
                  const padding = String(lines.length).length;
                  lines.forEach((line: string, index: number) => {
                    console.log(`${chalk.gray(String(index + 1).padStart(padding, " "))} | ${line}`);
                  });
                  console.log(chalk.bold.green("----------------------------\n"));
                  await prompts({
                    type: "text",
                    name: "ok",
                    message: "Tekan Enter untuk kembali ke menu persetujuan..."
                  });
                } else if (approval.action === "edit") {
                  const tempDir = os.tmpdir();
                  const tempFileName = `novara-edit-${Date.now()}-${path.basename(filePath || "temp.txt")}`;
                  const tempFilePath = path.join(tempDir, tempFileName);

                  fs.writeFileSync(tempFilePath, fileContent, "utf-8");

                  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "nano");
                  console.log(chalk.blue(`\nMembuka editor: ${editor} untuk mengedit berkas...`));

                  await new Promise<void>((resolve) => {
                    const child = spawn(editor, [tempFilePath], { stdio: "inherit", shell: true });
                    child.on("exit", () => resolve());
                    child.on("error", (err) => {
                      console.log(chalk.red(`Gagal menjalankan editor '${editor}': ${err.message}`));
                      resolve();
                    });
                  });

                  if (fs.existsSync(tempFilePath)) {
                    const updatedContent = fs.readFileSync(tempFilePath, "utf-8");

                    if (call.args.content !== undefined) call.args.content = updatedContent;
                    else if (call.args.codeContent !== undefined) call.args.codeContent = updatedContent;
                    else if (call.args.replacementContent !== undefined) call.args.replacementContent = updatedContent;

                    fileContent = updatedContent;
                    console.log(chalk.green("✔ Isi berkas berhasil diperbarui!"));
                    try {
                      fs.unlinkSync(tempFilePath);
                    } catch {}
                  }
                } else if (approval.action === "steer") {
                  execute = false;
                  const steerPrompt = await prompts({
                    type: "text",
                    name: "feedback",
                    message: "Masukkan instruksi koreksi/steering Anda:"
                  });
                  result = `Execution steered/rejected by user: "${steerPrompt.feedback || "Tidak ada feedback"}". Please adjust your plan/strategy accordingly.`;
                  approved = true;
                } else if (approval.action === "quit") {
                  execute = false;
                  result = "Execution rejected by user. Task aborted.";
                  loop = false;
                  approved = true;
                } else {
                  execute = false;
                  result = "Execution rejected by user.";
                  approved = true;
                }
              }
            }
            if (execute) {
              const execSpinner = ora(`Mengeksekusi ${call.name}...`).start();
              try {
                if (call.name === "record_fact") {
                  const { key, value } = call.args;
                  this.memorySystem.saveFact(key, value);
                  execSpinner.succeed("Selesai");
                  result = `Success: Fact '${key}' recorded with value '${value}'`;
                } else if (call.name === "record_knowledge") {
                  const { fileName, content } = call.args;
                  const knowDir = this.workspaceManager.getKnowledgeDir();
                  const fullPath = path.join(knowDir, fileName.endsWith(".md") ? fileName : `${fileName}.md`);
                  fs.writeFileSync(fullPath, content, "utf-8");
                  execSpinner.succeed("Selesai");
                  result = `Success: Knowledge document '${fileName}' created in workspace knowledge base`;
                } else if (call.name === "record_skill") {
                  const { name, description, instructions } = call.args;
                  const skillPath = this.workspaceManager.createSkill(name, description);
                  fs.writeFileSync(path.join(skillPath, "SKILL.md"), instructions, "utf-8");
                  execSpinner.succeed("Selesai");
                  result = `Success: Skill '${name}' created at ${skillPath}`;
                } else if (call.name === "node_list") {
                  const nodes = this.config.nodes || [];
                  if (nodes.length === 0) {
                    result = "Tidak ada node server yang terdaftar di konfigurasi workspace.yaml.";
                    execSpinner.succeed("Selesai");
                  } else {
                    const statusList = [];
                    for (const node of nodes) {
                      let status = "Offline / Connection Error";
                      if (node.type === "ssh") {
                        try {
                          const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
                          const cmd = `ssh ${keyArg} -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new ${node.user}@${node.host} "echo 1"`;
                          const out = execSync(cmd, { stdio: "pipe", timeout: 4000 }).toString().trim();
                          if (out === "1") {
                            status = "Online";
                          }
                        } catch (e: any) {
                          status = `Offline (${e.message.split("\n")[0]})`;
                        }
                      } else {
                        status = "Unsupported node type";
                      }
                      statusList.push({
                        name: node.name,
                        type: node.type,
                        host: node.host,
                        user: node.user,
                        status
                      });
                    }
                    execSpinner.succeed("Selesai");
                    result = JSON.stringify(statusList, null, 2);
                  }
                } else if (call.name === "node_execute") {
                  const { nodeName, command } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan di konfigurasi.`);
                  }

                  if (node.type === "ssh") {
                    const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
                    const cmd = `ssh ${keyArg} -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${node.user}@${node.host} ${JSON.stringify(command)}`;
                    const output = execSync(cmd, { stdio: "pipe", timeout: 15000 }).toString();
                    execSpinner.succeed("Selesai");
                    result = output;
                  } else {
                    throw new Error(`Tipe node '${node.type}' tidak didukung.`);
                  }
                } else if (call.name === "node_read_file") {
                  const { nodeName, filePath, lines } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan di konfigurasi.`);
                  }

                  if (node.type === "ssh") {
                    const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
                    const readCmd = lines ? `tail -n ${lines} "${filePath}"` : `cat "${filePath}"`;
                    const cmd = `ssh ${keyArg} -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${node.user}@${node.host} ${JSON.stringify(readCmd)}`;
                    const output = execSync(cmd, { stdio: "pipe", timeout: 10000 }).toString();
                    execSpinner.succeed("Selesai");
                    result = output;
                  } else {
                    throw new Error(`Tipe node '${node.type}' tidak didukung.`);
                  }
                } else if (call.name === "docker_list_containers") {
                  const { nodeName, all } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }
                  
                  const subCmd = all ? "ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}'" : "ps --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}'";
                  const output = this.runDockerCommand(node, subCmd);
                  execSpinner.succeed("Selesai");
                  result = output.trim() || "Tidak ada kontainer Docker ditemukan.";
                } else if (call.name === "docker_container_execute_action") {
                  const { nodeName, containerId, action } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }

                  if (!["start", "stop", "restart", "pause", "unpause"].includes(action)) {
                    throw new Error(`Aksi '${action}' tidak valid.`);
                  }

                  const subCmd = `${action} ${containerId}`;
                  const output = this.runDockerCommand(node, subCmd);
                  execSpinner.succeed("Selesai");
                  result = `Success: Container '${containerId}' ${action}ed. Output: ${output.trim()}`;
                } else if (call.name === "docker_container_logs") {
                  const { nodeName, containerId, lines } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }

                  const limit = lines || 50;
                  const subCmd = `logs --tail ${limit} ${containerId}`;
                  const output = this.runDockerCommand(node, subCmd);
                  execSpinner.succeed("Selesai");
                  result = output;
                } else if (call.name === "docker_inspect_container") {
                  const { nodeName, containerId } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }

                  const subCmd = `inspect ${containerId}`;
                  const output = this.runDockerCommand(node, subCmd);
                  execSpinner.succeed("Selesai");
                  result = output;
                } else if (call.name === "proxmox_list_resources") {
                  const { nodeName, type } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }
                  if (node.type !== "proxmox") {
                    throw new Error(`Node '${nodeName}' bukan merupakan node Proxmox.`);
                  }

                  const apiPath = "/api2/json/cluster/resources";
                  const res = await this.proxmoxRequest(node, "GET", apiPath);
                  let list = res.data || [];
                  if (type) {
                    const lowerType = type.toLowerCase();
                    if (lowerType === "qemu" || lowerType === "lxc") {
                      list = list.filter((r: any) => r.type === lowerType);
                    } else if (lowerType === "vm") {
                      list = list.filter((r: any) => r.type === "qemu" || r.type === "lxc");
                    } else {
                      list = list.filter((r: any) => r.type === lowerType);
                    }
                  }
                  
                  execSpinner.succeed("Selesai");
                  if (list.length === 0) {
                    result = "Tidak ada resource Proxmox ditemukan.";
                  } else {
                    result = list.map((r: any) => {
                      const status = r.status || "unknown";
                      const name = r.name || "N/A";
                      const id = r.vmid ? `VMID: ${r.vmid}` : `ID: ${r.id}`;
                      const pveNode = r.node ? `Node: ${r.node}` : "";
                      const details = r.maxmem ? `Mem: ${(r.mem / (1024*1024)).toFixed(0)}MB/${(r.maxmem / (1024*1024)).toFixed(0)}MB` : "";
                      return `[${r.type.toUpperCase()}] ${name} (${id}) - Status: ${status} ${pveNode ? `[${pveNode}]` : ""} ${details}`;
                    }).join("\n");
                  }
                } else if (call.name === "proxmox_vm_execute_action") {
                  const { nodeName, vmid, action } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }
                  if (node.type !== "proxmox") {
                    throw new Error(`Node '${nodeName}' bukan merupakan node Proxmox.`);
                  }

                  const validActions = ["start", "stop", "shutdown", "reboot", "suspend"];
                  if (!validActions.includes(action)) {
                    throw new Error(`Aksi '${action}' tidak valid. Harus salah satu dari: ${validActions.join(", ")}`);
                  }

                  const resourcesRes = await this.proxmoxRequest(node, "GET", "/api2/json/cluster/resources");
                  const resources = resourcesRes.data || [];
                  const matched = resources.find((r: any) => r.vmid === Number(vmid) && (r.type === "qemu" || r.type === "lxc"));
                  
                  if (!matched) {
                    throw new Error(`Resource dengan VMID ${vmid} tidak ditemukan di cluster Proxmox.`);
                  }

                  const vmType = matched.type;
                  const pveNodeName = matched.node;
                  const apiPath = `/api2/json/nodes/${pveNodeName}/${vmType}/${vmid}/status/${action}`;
                  
                  const res = await this.proxmoxRequest(node, "POST", apiPath);
                  execSpinner.succeed("Selesai");
                  result = `Aksi '${action}' berhasil dikirim ke ${vmType} VMID ${vmid} di node '${pveNodeName}'.`;
                } else if (call.name === "proxmox_inspect_vm") {
                  const { nodeName, vmid, vmType } = call.args;
                  const nodes = this.config.nodes || [];
                  const node = nodes.find(n => n.name === nodeName);
                  if (!node) {
                    throw new Error(`Node dengan nama '${nodeName}' tidak ditemukan.`);
                  }
                  if (node.type !== "proxmox") {
                    throw new Error(`Node '${nodeName}' bukan merupakan node Proxmox.`);
                  }

                  const lowerType = vmType.toLowerCase();
                  if (lowerType !== "qemu" && lowerType !== "lxc") {
                    throw new Error(`Tipe virtualisasi '${vmType}' tidak valid. Harus 'qemu' atau 'lxc'.`);
                  }

                  const resourcesRes = await this.proxmoxRequest(node, "GET", "/api2/json/cluster/resources");
                  const resources = resourcesRes.data || [];
                  const matched = resources.find((r: any) => r.vmid === Number(vmid) && r.type === lowerType);
                  
                  if (!matched) {
                    throw new Error(`Resource '${lowerType}' dengan VMID ${vmid} tidak ditemukan.`);
                  }

                  const pveNodeName = matched.node;
                  const statusPath = `/api2/json/nodes/${pveNodeName}/${lowerType}/${vmid}/status/current`;
                  const configPath = `/api2/json/nodes/${pveNodeName}/${lowerType}/${vmid}/config`;

                  const [statusRes, configRes] = await Promise.all([
                    this.proxmoxRequest(node, "GET", statusPath),
                    this.proxmoxRequest(node, "GET", configPath)
                  ]);

                  execSpinner.succeed("Selesai");
                  result = JSON.stringify({
                    vmid,
                    type: lowerType,
                    node: pveNodeName,
                    status: statusRes.data,
                    config: configRes.data
                  }, null, 2);
                } else if (call.name === "delegate_task") {
                  const { agentType, subTaskQuery } = call.args;
                  execSpinner.text = `Mendelegasikan ke sub-agent [${agentType}]...`;
                  const subResult = await this.runSubAgentTask(subTaskQuery, agentType);
                  execSpinner.succeed(`Sub-agent [${agentType}] selesai`);
                  result = `Laporan hasil dari Sub-Agent [${agentType}]:\n\n${subResult}`;
                } else {
                  // Standard MCP tools execution
                  result = await this.mcpManager.callTool(call.name, call.args);
                  execSpinner.succeed("Selesai");
                }
              } catch (err: any) {
                execSpinner.fail("Gagal");
                result = `Error: ${err.message}`;
              }
            } else {
              if (!result) {
                result = "Execution rejected by user.";
              }
              console.log(chalk.red("Eksekusi dibatalkan atau disetir oleh pengguna."));
            }


            console.log(chalk.hex("#a6adc8")(`   Result » `) + chalk.hex("#9399b2")(`${result.slice(0, 300)}${result.length > 300 ? "..." : ""}`));
            console.log(chalk.hex("#585b70")("   " + "─".repeat(50)));
            
            // Add tool result to context
            sessionMessages.push({
              role: "tool",
              name: call.name,
              content: result
            });
            this.memorySystem.saveMessage({
              role: "tool",
              name: call.name,
              content: result
            });
          }
        } else {
          // No more tool calls, loop ends
          loop = false;
        }

      } catch (err: any) {
        spinner.stop();
        console.error(chalk.red(`\nTerjadi kesalahan: ${err.message}`));
        loop = false;
      }
    }

    if (iterations >= maxIterations) {
      console.log(chalk.yellow("\n[Novara OS] Batas iterasi maksimum tercapai. Tugas dihentikan."));
    }

    // ── Background memory consolidation (non-blocking) ───────────────────────
    if (!agentType && this.consolidator) {
      this.sessionTurnCount++;
      const recentForConsolidation = this.memorySystem.getRecentHistory(16);
      this.consolidator.consolidateInBackground(
        this.memorySystem.getActiveSession(),
        recentForConsolidation,
        this.provider,
        this.sessionTurnCount
      ).catch(() => {}); // Fire and forget, silent failure
    }

    return lastResponseText || "Tugas diselesaikan tanpa output laporan.";
  }

  async runSubAgentTask(subTaskQuery: string, agentType: string): Promise<string> {
    if (agentType === "hermes") {
      const hermesUrl = process.env.HERMES_API_URL || "http://localhost:8316/v1/agent/run";
      try {
        const response = await fetch(hermesUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: subTaskQuery, sender: "novara-os" })
        });
        if (!response.ok) {
          throw new Error(`Hermes API returned status ${response.status}`);
        }
        const data = await response.json() as any;
        return data.result || data.response || data.output || JSON.stringify(data);
      } catch (err: any) {
        throw new Error(`Gagal menghubungi sub-agent Hermes di ${hermesUrl}: ${err.message}`);
      }
    }

    const systemPrompt = this.assembleSystemPrompt(subTaskQuery, agentType);
    
    // Inject parent context to prevent context loss
    const parentSummary = this.getSessionSummary();
    const enrichedQuery = parentSummary?.rollingText
      ? `[KONTEKS DARI AGEN UTAMA]\n${parentSummary.rollingText}\n\n[TUGAS ANDA]\n${subTaskQuery}`
      : subTaskQuery;

    const sessionMessages: ChatMessage[] = [
      { role: "user", content: enrichedQuery }
    ];

    let loop = true;
    let iterations = 0;
    const maxIterations = this.config.settings?.max_iterations ?? 300; // limit sub-agent iterations
    let lastResponseText = "";

    while (loop && iterations < maxIterations) {
      iterations++;
      
      const mcpTools = await this.mcpManager.listAllTools();
      // Remove delegate_task from sub-agent tools to prevent infinite recursion
      const nativeTools = [
        {
          name: "record_fact",
          description: "Menyimpan fakta atau preferensi pengguna ke memori jangka panjang secara otomatis dari percakapan.",
          inputSchema: {
            type: "object",
            properties: {
              key: { type: "string", description: "Kunci fakta/preferensi (misal: editor_pilihan)" },
              value: { type: "string", description: "Nilai dari fakta (misal: vscode)" }
            },
            required: ["key", "value"]
          }
        },
        {
          name: "record_knowledge",
          description: "Menulis catatan pengetahuan baru ke dalam basis pengetahuan workspace agar terekam secara otomatis.",
          inputSchema: {
            type: "object",
            properties: {
              fileName: { type: "string", description: "Nama file markdown (misal: panduan_deploy.md)" },
              content: { type: "string", description: "Isi catatan markdown lengkap" }
            },
            required: ["fileName", "content"]
          }
        },
        {
          name: "record_skill",
          description: "Membuat skill baru berupa kumpulan instruksi/prosedur kerja spesifik ke folder skill workspace.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nama skill (misal: push_ke_git)" },
              description: { type: "string", description: "Deskripsi singkat skill" },
              instructions: { type: "string", description: "Isi instruksi detail markdown yang akan ditulis ke SKILL.md" }
            },
            required: ["name", "description", "instructions"]
          }
        },
        {
          name: "node_list",
          description: "Mendapatkan daftar semua node server/infrastruktur remote (seperti SSH atau Docker) yang terdaftar di konfigurasi workspace beserta status koneksinya.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "node_execute",
          description: "Mengeksekusi perintah shell secara remote pada node Linux/UNIX yang terdaftar di workspace menggunakan SSH.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan eksekusi (contoh: app-server-prod)" },
              command: { type: "string", description: "Perintah shell/bash yang ingin dieksekusi" }
            },
            required: ["nodeName", "command"]
          }
        },
        {
          name: "node_read_file",
          description: "Membaca isi file log atau file konfigurasi secara remote pada node yang terdaftar menggunakan SSH secara aman.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan (contoh: app-server-prod)" },
              filePath: { type: "string", description: "Path mutlak menuju file di server remote" },
              lines: { type: "number", description: "Jumlah baris dari akhir file yang ingin dibaca (opsional, menggunakan tail)" }
            },
            required: ["nodeName", "filePath"]
          }
        },
        {
          name: "docker_list_containers",
          description: "Mendapatkan daftar kontainer Docker pada node tertentu (baik lokal maupun remote) beserta statusnya.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan (contoh: homelab-docker)" },
              all: { type: "boolean", description: "Tampilkan semua kontainer (termasuk yang berhenti), default false hanya yang running" }
            },
            required: ["nodeName"]
          }
        },
        {
          name: "docker_container_execute_action",
          description: "Mengubah status kontainer Docker (start, stop, restart, pause, unpause) pada node tertentu.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" },
              action: { type: "string", description: "Aksi status (pilihan: start, stop, restart, pause, unpause)" }
            },
            required: ["nodeName", "containerId", "action"]
          }
        },
        {
          name: "docker_container_logs",
          description: "Mendapatkan log stdout/stderr dari kontainer Docker tertentu.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" },
              lines: { type: "number", description: "Jumlah baris log dari akhir yang ingin diambil (default 50)" }
            },
            required: ["nodeName", "containerId"]
          }
        },
        {
          name: "docker_inspect_container",
          description: "Mendapatkan konfigurasi detail objek kontainer Docker dalam format JSON.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node server tujuan" },
              containerId: { type: "string", description: "ID atau nama kontainer Docker" }
            },
            required: ["nodeName", "containerId"]
          }
        },
        {
          name: "proxmox_list_resources",
          description: "Dapatkan daftar resource cluster Proxmox VE.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE" },
              type: { type: "string", description: "Filter tipe resource (qemu, lxc, storage, node, pool)" }
            },
            required: ["nodeName"]
          }
        },
        {
          name: "proxmox_vm_execute_action",
          description: "Mengubah status daya VM qemu atau LXC container pada cluster Proxmox.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE terdaftar" },
              vmid: { type: "number", description: "ID virtual machine atau container" },
              action: { type: "string", description: "Aksi status (start, stop, shutdown, reboot, suspend)" }
            },
            required: ["nodeName", "vmid", "action"]
          }
        },
        {
          name: "proxmox_inspect_vm",
          description: "Mendapatkan status terkini dan detail konfigurasi dari VM qemu atau LXC container di Proxmox VE.",
          inputSchema: {
            type: "object",
            properties: {
              nodeName: { type: "string", description: "Nama node Proxmox VE terdaftar" },
              vmid: { type: "number", description: "ID virtual machine atau container" },
              vmType: { type: "string", description: "Tipe virtualisasi (qemu, lxc)" }
            },
            required: ["nodeName", "vmid", "vmType"]
          }
        }
      ];

      const allActiveTools = [...mcpTools, ...nativeTools];

      try {
        const response = await this.provider.generate(sessionMessages, systemPrompt, allActiveTools);

        if (response.text) {
          lastResponseText = response.text;
          sessionMessages.push({ role: "model", content: response.text });
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          const rawCallsStr = JSON.stringify(response.toolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.args }
          })));
          
          sessionMessages.push({
            role: "model",
            content: `Memanggil tool sub-agent: ${response.toolCalls.map(c => c.name).join(", ")}`,
            toolCallId: rawCallsStr
          });

          const toolPromises = response.toolCalls.map(async (call) => {
            let result: string;
            try {
              if (call.name === "record_fact") {
                const { key, value } = call.args;
                this.memorySystem.saveFact(key, value);
                result = `Success: Fact '${key}' recorded with value '${value}'`;
              } else if (call.name === "record_knowledge") {
                const { fileName, content } = call.args;
                const knowDir = this.workspaceManager.getKnowledgeDir();
                const fullPath = path.join(knowDir, fileName.endsWith(".md") ? fileName : `${fileName}.md`);
                fs.writeFileSync(fullPath, content, "utf-8");
                result = `Success: Knowledge document '${fileName}' created`;
              } else if (call.name === "record_skill") {
                const { name, description, instructions } = call.args;
                const skillPath = this.workspaceManager.createSkill(name, description);
                fs.writeFileSync(path.join(skillPath, "SKILL.md"), instructions, "utf-8");
                result = `Success: Skill '${name}' created`;
              } else if (call.name === "node_list") {
                const nodes = this.config.nodes || [];
                if (nodes.length === 0) {
                  result = "Tidak ada node server.";
                } else {
                  result = JSON.stringify(nodes.map(n => ({ name: n.name, type: n.type, host: n.host })), null, 2);
                }
              } else if (call.name === "node_execute") {
                const { nodeName, command } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                if (node.type === "ssh") {
                  const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
                  const cmd = `ssh ${keyArg} -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${node.user}@${node.host} ${JSON.stringify(command)}`;
                  result = execSync(cmd, { stdio: "pipe", timeout: 15000 }).toString();
                } else {
                  throw new Error(`Unsupported node type`);
                }
              } else if (call.name === "node_read_file") {
                const { nodeName, filePath, lines } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                if (node.type === "ssh") {
                  const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
                  const readCmd = lines ? `tail -n ${lines} "${filePath}"` : `cat "${filePath}"`;
                  const cmd = `ssh ${keyArg} -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${node.user}@${node.host} ${JSON.stringify(readCmd)}`;
                  result = execSync(cmd, { stdio: "pipe", timeout: 10000 }).toString();
                } else {
                  throw new Error(`Unsupported node type`);
                }
              } else if (call.name === "docker_list_containers") {
                const { nodeName, all } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                result = this.runDockerCommand(node, all ? "ps -a" : "ps").trim();
              } else if (call.name === "docker_container_execute_action") {
                const { nodeName, containerId, action } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                result = this.runDockerCommand(node, `${action} ${containerId}`).trim();
              } else if (call.name === "docker_container_logs") {
                const { nodeName, containerId, lines } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                result = this.runDockerCommand(node, `logs --tail ${lines || 50} ${containerId}`).trim();
              } else if (call.name === "docker_inspect_container") {
                const { nodeName, containerId } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                result = this.runDockerCommand(node, `inspect ${containerId}`).trim();
              } else if (call.name === "proxmox_list_resources") {
                const { nodeName, type } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                const apiPath = "/api2/json/cluster/resources";
                const res = await this.proxmoxRequest(node, "GET", apiPath);
                result = JSON.stringify(res.data || [], null, 2);
              } else if (call.name === "proxmox_vm_execute_action") {
                const { nodeName, vmid, action } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                const resourcesRes = await this.proxmoxRequest(node, "GET", "/api2/json/cluster/resources");
                const matched = (resourcesRes.data || []).find((r: any) => r.vmid === Number(vmid));
                if (!matched) throw new Error(`VMID ${vmid} not found`);
                const res = await this.proxmoxRequest(node, "POST", `/api2/json/nodes/${matched.node}/${matched.type}/${vmid}/status/${action}`);
                result = `Success: VM ${vmid} action ${action} triggered`;
              } else if (call.name === "proxmox_inspect_vm") {
                const { nodeName, vmid, vmType } = call.args;
                const nodes = this.config.nodes || [];
                const node = nodes.find(n => n.name === nodeName);
                if (!node) throw new Error(`Node '${nodeName}' tidak ditemukan.`);
                const resourcesRes = await this.proxmoxRequest(node, "GET", "/api2/json/cluster/resources");
                const matched = (resourcesRes.data || []).find((r: any) => r.vmid === Number(vmid));
                if (!matched) throw new Error(`VMID ${vmid} not found`);
                const statusRes = await this.proxmoxRequest(node, "GET", `/api2/json/nodes/${matched.node}/${vmType.toLowerCase()}/${vmid}/status/current`);
                result = JSON.stringify(statusRes.data || {}, null, 2);
              } else {
                result = await this.mcpManager.callTool(call.name, call.args);
              }
            } catch (err: any) {
              result = `Error: ${err.message}`;
            }
            return { name: call.name, content: result };
          });

          // Wait for all tool executions to finish concurrently
          const toolResults = await Promise.all(toolPromises);
          
          for (const res of toolResults) {
            sessionMessages.push({
              role: "tool",
              name: res.name,
              content: res.content
            });
          }
        } else {
          loop = false;
        }
      } catch (err: any) {
        loop = false;
      }
    }

    return lastResponseText || "Sub-agent diselesaikan tanpa output teks.";
  }

  async handleSlashCommand(input: string): Promise<boolean> {
    if (!input.startsWith("/")) return false;

    const parts = input.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case "help":
        console.log(chalk.green("\n=== Novara OS Slash Commands ==="));
        console.log(`${chalk.cyan("/session")}                    - Manage, list, create, switch or delete sessions`);
        console.log(`${chalk.cyan("/model [model_name]")}         - Select or search active LLM model (interactive search)`);
        console.log(`${chalk.cyan("/set-key [prov] [key]")}      - Save provider API key (e.g. /set-key gemini AIzaSy...)`);
        console.log(`${chalk.cyan("/setup")}                      - Configure LLM providers and API keys interactively`);
        console.log(`${chalk.cyan("/tools [tool_name]")}         - Display parameter details & list of active tools`);
        console.log(`${chalk.cyan("/mcp")}                       - Manage, reconnect, or register MCP servers`);
        console.log(`${chalk.cyan("/add-mcp [name] [cmd] [args]")} - Register and connect a new MCP server`);
        console.log(`${chalk.cyan("/nodes")}                      - Manage, ping, or register remote server nodes`);
        console.log(`${chalk.cyan("/skills")}                    - List, view instructions, or delete local skills`);
        console.log(`${chalk.cyan("/add-skill [name] [desc]")}    - Create a new skill module interactively`);
        console.log(`${chalk.cyan("/facts")}                     - Manage, edit, or delete stored user preferences`);
        console.log(`${chalk.cyan("/fact [key] [value]")}         - Instantly save a new user preference or fact`);
        console.log(`${chalk.cyan("/scan")}                      - Scan local disk to auto-register MCPs and SSH nodes`);
        console.log(`${chalk.cyan("/queue")}                      - Display background task queue status`);
        console.log(`${chalk.cyan("/queue add <query>")}          - Add a new task to the background API queue`);
        console.log(`${chalk.cyan("/grill-me [topik]")}             - Mulai sesi interview arsitektur interaktif (drill-me)`);
        console.log(`${chalk.cyan("/summary")}                    - Tampilkan rolling summary sesi aktif`);
        console.log(`${chalk.cyan("/summary consolidate")}        - Paksa buat/update summary sesi sekarang`);
        console.log(`${chalk.cyan("/memory-config")}              - Lihat/ubah konfigurasi memory consolidator`);
        console.log(`${chalk.cyan("/clear")}                     - Clear chat conversation history for the active session`);
        console.log(`${chalk.cyan("/cls")} or ${chalk.cyan("/clear-screen")}    - Clear terminal console screen`);
        console.log(`${chalk.cyan("/exit")} or ${chalk.cyan("/quit")}           - Exit the interactive session`);
        console.log("=================================\n");
        break;

      case "summary": {
        const subCmd = args[0];
        if (subCmd === "consolidate") {
          const spinner = ora("Membuat summary sesi...").start();
          try {
            const summary = await this.consolidateSessionNow();
            spinner.stop();
            if (summary) {
              console.log(chalk.green("\n✔ Summary sesi berhasil diperbarui:"));
              console.log(chalk.hex("#cba6f7")("┌" + "─".repeat(60) + "┐"));
              console.log(chalk.hex("#cba6f7")("│") + chalk.bold(" 📋 Rolling Summary") + " ".repeat(40) + chalk.hex("#cba6f7")("│"));
              console.log(chalk.hex("#cba6f7")("├" + "─".repeat(60) + "┤"));
              const lines = summary.rollingText.split("\n");
              for (const line of lines) {
                console.log(chalk.hex("#cba6f7")("│") + " " + chalk.white(line.slice(0, 58).padEnd(58)) + chalk.hex("#cba6f7")("│"));
              }
              if (summary.tags.length > 0) {
                console.log(chalk.hex("#cba6f7")("├" + "─".repeat(60) + "┤"));
                console.log(chalk.hex("#cba6f7")("│") + chalk.gray(` 🏷️  Tags: ${summary.tags.join(", ")} | Domain: ${summary.domain}`) + chalk.hex("#cba6f7")("│"));
              }
              if (summary.keyDecisions.length > 0) {
                console.log(chalk.hex("#cba6f7")("├" + "─".repeat(60) + "┤"));
                console.log(chalk.hex("#cba6f7")("│") + chalk.bold.yellow(" ⚡ Key Changes:") + " ".repeat(44) + chalk.hex("#cba6f7")("│"));
                for (const d of summary.keyDecisions) {
                  console.log(chalk.hex("#cba6f7")("│") + " • " + chalk.cyan(d.slice(0, 56).padEnd(56)) + chalk.hex("#cba6f7")("│"));
                }
              }
              console.log(chalk.hex("#cba6f7")("└" + "─".repeat(60) + "┘\n"));
            } else {
              console.log(chalk.yellow("Belum ada cukup percakapan untuk di-summarize (min 3 giliran)."));
            }
          } catch (e: any) {
            spinner.fail(`Gagal membuat summary: ${e.message}`);
          }
        } else {
          // Display current summary
          const summary = this.getSessionSummary();
          if (!summary || !summary.rollingText) {
            console.log(chalk.yellow("\nBelum ada summary untuk sesi ini. Jalankan '/summary consolidate' untuk membuatnya."));
          } else {
            console.log(chalk.green("\n=== Session Memory Summary ==="));
            console.log(chalk.bold(`Sesi: ${summary.sessionName} | Giliran: ${summary.turnCount} | Update: ${new Date(summary.lastUpdated).toLocaleString("id-ID")}`));
            console.log(chalk.hex("#cba6f7")("─".repeat(60)));
            console.log(chalk.white(summary.rollingText));
            if (summary.tags.length > 0) {
              console.log(chalk.gray(`\n🏷️  Tags: ${summary.tags.join(", ")} | Domain: ${summary.domain}`));
            }
            if (summary.keyDecisions.length > 0) {
              console.log(chalk.yellow("\n⚡ Key decisions/changes:"));
              for (const d of summary.keyDecisions) {
                console.log(chalk.cyan(`  • ${d}`));
              }
            }
            console.log();
          }
        }
        break;
      }

      case "memory-config": {
        if (!this.consolidator) {
          console.log(chalk.red("Consolidator tidak aktif."));
          break;
        }
        const cfg = this.consolidator.getConfig();
        if (args.length === 0) {
          // Display current config
          console.log(chalk.green("\n=== Memory Consolidator Config ==="));
          console.log(`  Auto Summary      : ${cfg.enableAutoSummary ? chalk.green("aktif") : chalk.red("nonaktif")}`);
          console.log(`  Target Tokens     : ${chalk.yellow(cfg.targetSummaryTokens.toString())} (ringkasan maks ~${Math.floor(cfg.targetSummaryTokens * 0.75)} kata)`);
          console.log(`  Min Turns         : ${chalk.yellow(cfg.minTurnsBeforeSummary.toString())} giliran sebelum summarize`);
          console.log(`  Guardrail Domains : ${cfg.guardrailDomains.length > 0 ? chalk.yellow(cfg.guardrailDomains.join(", ")) : chalk.gray("tidak dibatasi (semua domain)")}`); 
          console.log(chalk.gray("\nGunakan '/memory-config set <key> <value>' untuk mengubah"));
          console.log(chalk.gray("Keys: auto-summary, target-tokens, min-turns, domains"));
          console.log();
        } else if (args[0] === "set") {
          const key = args[1];
          const value = args.slice(2).join(" ");
          if (!key || !value) {
            console.log(chalk.red("Penggunaan: /memory-config set <key> <value>"));
            break;
          }
          if (key === "auto-summary") {
            this.consolidator.updateConfig({ enableAutoSummary: value === "true" || value === "aktif" });
            console.log(chalk.green(`✔ auto-summary diset ke: ${value}`));
          } else if (key === "target-tokens") {
            const n = parseInt(value);
            if (!isNaN(n) && n > 50) {
              this.consolidator.updateConfig({ targetSummaryTokens: n });
              console.log(chalk.green(`✔ target-tokens diset ke: ${n}`));
            } else {
              console.log(chalk.red("Nilai harus angka > 50"));
            }
          } else if (key === "min-turns") {
            const n = parseInt(value);
            if (!isNaN(n) && n >= 1) {
              this.consolidator.updateConfig({ minTurnsBeforeSummary: n });
              console.log(chalk.green(`✔ min-turns diset ke: ${n}`));
            } else {
              console.log(chalk.red("Nilai harus angka >= 1"));
            }
          } else if (key === "domains") {
            const domains = value.split(",").map(d => d.trim()).filter(Boolean);
            this.consolidator.updateConfig({ guardrailDomains: domains });
            console.log(chalk.green(`✔ Guardrail domains diset ke: ${domains.join(", ") || "(tidak dibatasi)"}`))
          } else {
            console.log(chalk.red(`Key tidak dikenal: ${key}. Gunakan: auto-summary, target-tokens, min-turns, domains`));
          }
        }
        break;
      }

      case "queue":
        if (args[0] === "add") {
          const queryText = args.slice(1).join(" ");
          if (!queryText) {
            console.log(chalk.red("Penggunaan: /queue add <deskripsi tugas>"));
            break;
          }
          const postData = JSON.stringify({ query: queryText });
          const req = http.request({
            hostname: "localhost",
            port: 8088,
            path: "/v1/agent/run",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData)
            }
          }, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
              try {
                const parsed = JSON.parse(body);
                if (parsed.success) {
                  console.log(chalk.green(`✔ Tugas berhasil ditambahkan ke antrean API Server! ID Tugas: ${chalk.bold(parsed.taskId)}`));
                } else {
                  console.log(chalk.red(`Gagal: ${parsed.error || "Kesalahan tidak dikenal"}`));
                }
              } catch (e: any) {
                console.log(chalk.red(`Gagal mengurai respons API Server: ${e.message}`));
              }
            });
          });
          req.on("error", (e) => {
            console.log(chalk.red(`Tidak dapat terhubung ke API Server pada port 8088. Pastikan server berjalan dengan 'novara serve'.`));
          });
          req.write(postData);
          req.end();
        } else {
          http.get("http://localhost:8088/v1/tasks", (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
              try {
                const parsed = JSON.parse(body);
                console.log(chalk.green("\n=== Status Antrean API Server ==="));
                console.log(`Workspace Aktif: ${chalk.cyan(parsed.workspace)}`);
                console.log(`Ukuran Antrean : ${parsed.queueSize}`);
                console.log("---------------------------------");
                if (parsed.tasks.length === 0) {
                  console.log(chalk.yellow("Antrean kosong."));
                } else {
                  for (const task of parsed.tasks) {
                    let statusStr = task.status;
                    if (task.status === "pending") statusStr = chalk.yellow(task.status);
                    else if (task.status === "running") statusStr = chalk.cyan(task.status);
                    else if (task.status === "completed") statusStr = chalk.green(task.status);
                    else if (task.status === "failed") statusStr = chalk.red(task.status);

                    console.log(`[${statusStr}] ID: ${task.id} | ${task.query.slice(0, 50)}${task.query.length > 50 ? "..." : ""}`);
                    if (task.result) {
                      console.log(`      Output: ${task.result.slice(0, 100)}${task.result.length > 100 ? "..." : ""}`);
                    }
                    if (task.error) {
                      console.log(`      Error : ${chalk.red(task.error)}`);
                    }
                  }
                }
                console.log("=================================\n");
              } catch (e: any) {
                console.log(chalk.red(`Gagal mengurai respons dari API Server: ${e.message}`));
              }
            });
          }).on("error", (e) => {
            console.log(chalk.red(`Tidak dapat terhubung ke API Server pada port 8088. Pastikan server berjalan dengan 'novara serve'.`));
          });
        }
        break;

      case "set-key":
        if (args.length === 0) {
          const providerResponse = await prompts({
            type: "select",
            name: "provider",
            message: "Pilih provider untuk diatur kuncinya:",
            choices: [
              { title: "Google Gemini (GEMINI_API_KEY)", value: "gemini" },
              { title: "OpenAI (OPENAI_API_KEY)", value: "openai" },
              { title: "OpenRouter (OPENROUTER_API_KEY)", value: "openrouter" },
              { title: "Google Client ID (GOOGLE_CLIENT_ID)", value: "google_client_id" },
              { title: "Google Client Secret (GOOGLE_CLIENT_SECRET)", value: "google_client_secret" },
              { title: "Lainnya (Kustom)", value: "custom" }
            ]
          });

          if (!providerResponse.provider) {
            console.log(chalk.yellow("Pengaturan kunci dibatalkan."));
            break;
          }

          let envKey = "";
          if (providerResponse.provider === "gemini") envKey = "GEMINI_API_KEY";
          else if (providerResponse.provider === "openai") envKey = "OPENAI_API_KEY";
          else if (providerResponse.provider === "openrouter") envKey = "OPENROUTER_API_KEY";
          else if (providerResponse.provider === "google_client_id") envKey = "GOOGLE_CLIENT_ID";
          else if (providerResponse.provider === "google_client_secret") envKey = "GOOGLE_CLIENT_SECRET";
          else {
            const customNameResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan nama environment variable (contoh: MY_API_KEY):"
            });
            if (customNameResponse.value) {
              envKey = customNameResponse.value.trim().toUpperCase();
            } else {
              console.log(chalk.yellow("Pengaturan kunci dibatalkan."));
              break;
            }
          }

          const keyResponse = await prompts({
            type: "password",
            name: "value",
            message: `Masukkan API Key / value untuk ${envKey}:`
          });

          if (keyResponse.value) {
            this.workspaceManager.saveSecret(envKey, keyResponse.value);
            console.log(chalk.green(`✔ API Key/Credential untuk ${chalk.cyan(envKey)} berhasil disimpan dan diaktifkan!`));
          } else {
            console.log(chalk.yellow("Pengaturan kunci dibatalkan."));
          }
        } else if (args.length < 2) {
          console.log(chalk.red("Format salah. Gunakan: /set-key <prov> <key> atau panggil /set-key tanpa argumen untuk menu interaktif."));
        } else {
          const providerName = args[0].toLowerCase();
          const apiKeyValue = args.slice(1).join(" ");
          
          let envKey = "";
          if (providerName === "gemini") envKey = "GEMINI_API_KEY";
          else if (providerName === "openai") envKey = "OPENAI_API_KEY";
          else if (providerName === "openrouter") envKey = "OPENROUTER_API_KEY";
          else if (providerName === "google_client_id") envKey = "GOOGLE_CLIENT_ID";
          else if (providerName === "google_client_secret") envKey = "GOOGLE_CLIENT_SECRET";
          else {
            envKey = args[0].toUpperCase();
          }

          this.workspaceManager.saveSecret(envKey, apiKeyValue);
          console.log(chalk.green(`✔ API Key/Credential untuk ${chalk.cyan(envKey)} berhasil disimpan dan diaktifkan!`));
        }
        break;

      case "setup":
        await runInteractiveSetup(this.workspaceManager);
        this.config = this.workspaceManager.loadConfig();
        this.workspaceManager.loadSecrets();
        this.provider.setModel(this.config.provider.default);
        break;

      case "model": {
        if (process.env.OPENROUTER_API_KEY && (!this.openRouterModels || this.openRouterModels.length === 0)) {
          const spinner = ora("Mengambil daftar model OpenRouter...").start();
          try {
            this.openRouterModels = await this.fetchOpenRouterModels();
            if (this.openRouterModels.length > 0) {
              spinner.succeed(`Berhasil memuat ${this.openRouterModels.length} model OpenRouter online!`);
            } else {
              spinner.warn("Tidak ada model OpenRouter online ditemukan.");
            }
          } catch {
            spinner.fail("Gagal memuat model OpenRouter online.");
          }
        }

        const staticChoices = [
          { title: "✦ Masukkan model kustom...", value: "__custom__" },
          // Gemini
          { title: `${chalk.bold("[Google Gemini]")} gemini-2.5-flash (Rekomendasi)`, value: "gemini/gemini-2.5-flash" },
          { title: `${chalk.bold("[Google Gemini]")} gemini-2.5-pro`, value: "gemini/gemini-2.5-pro" },
          { title: `${chalk.bold("[Google Gemini]")} gemini-1.5-flash`, value: "gemini/gemini-1.5-flash" },
          { title: `${chalk.bold("[Google Gemini]")} gemini-1.5-pro`, value: "gemini/gemini-1.5-pro" },
          // OpenAI
          { title: `${chalk.bold("[OpenAI]")} gpt-4o-mini`, value: "openai/gpt-4o-mini" },
          { title: `${chalk.bold("[OpenAI]")} gpt-4o`, value: "openai/gpt-4o" },
          { title: `${chalk.bold("[OpenAI]")} o1-mini`, value: "openai/o1-mini" },
          // Local Gateways & Proxies (9Router / CLIProxy)
          { title: `${chalk.bold("[9Router]")} openai/gpt-4o (Lokal Gateway)`, value: "9router/openai/gpt-4o" },
          { title: `${chalk.bold("[9Router]")} anthropic/claude-3.5-sonnet`, value: "9router/anthropic/claude-3.5-sonnet" },
          { title: `${chalk.bold("[CLIProxy]")} google/gemini-2.5-pro (Proxy)`, value: "cliproxy/google/gemini-2.5-pro" },
          // Ollama
          { title: `${chalk.bold("[Ollama - Lokal]")} llama3`, value: "ollama/llama3" },
          { title: `${chalk.bold("[Ollama - Lokal]")} mistral`, value: "ollama/mistral" },
          { title: `${chalk.bold("[Ollama - Lokal]")} codellama`, value: "ollama/codellama" }
        ];

        const choices = [...staticChoices];

        if (this.openRouterModels && this.openRouterModels.length > 0) {
          for (const m of this.openRouterModels) {
            choices.push({
              title: `${chalk.bold("[OpenRouter]")} ${m.name} (${m.id})`,
              value: `openrouter/${m.id}`
            });
          }
        } else {
          choices.push(
            { title: `${chalk.bold("[OpenRouter]")} anthropic/claude-3.5-sonnet`, value: "openrouter/anthropic/claude-3.5-sonnet" },
            { title: `${chalk.bold("[OpenRouter]")} meta-llama/llama-3.1-8b-instruct`, value: "openrouter/meta-llama/llama-3.1-8b-instruct" },
            { title: `${chalk.bold("[OpenRouter]")} google/gemini-2.5-pro`, value: "openrouter/google/gemini-2.5-pro" }
          );
        }

        const smartFilter = (input: string, list: any[]) => {
          const cleanInput = input.toLowerCase().trim();
          if (!cleanInput) return list;

          const queryWords = cleanInput.split(/\s+/);
          
          const scoredChoices = list.map((choice) => {
            const cleanTitle = (choice.title || "").replace(/\x1b\[[0-9;]*m/g, "").toLowerCase();
            const cleanValue = (choice.value || "").toLowerCase();
            
            let score = 0;
            
            // Contiguous match check
            if (cleanTitle.includes(cleanInput) || cleanValue.includes(cleanInput)) {
              if (cleanTitle.startsWith(cleanInput) || cleanValue.startsWith(cleanInput)) {
                score = 100;
              } else if (
                cleanTitle.includes(" " + cleanInput) || 
                cleanValue.includes(" " + cleanInput) ||
                cleanTitle.includes("/" + cleanInput) ||
                cleanValue.includes("/" + cleanInput)
              ) {
                score = 80;
              } else {
                score = 60;
              }
            } else {
              // Multi-word matches
              let matchesAll = true;
              let matchCount = 0;
              for (const word of queryWords) {
                if (cleanTitle.includes(word) || cleanValue.includes(word)) {
                  matchCount++;
                } else {
                  matchesAll = false;
                }
              }
              
              if (matchesAll) {
                score = 40;
              } else if (matchCount > 0) {
                score = 10 + matchCount * 5;
              }
            }
            
            return { choice, score };
          });

          return scoredChoices
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.choice);
        };

        const suggest = async (input: string, choices: any[]) => {
          return smartFilter(input, choices);
        };

        let selectedModel: string | undefined = undefined;

        if (args.length === 0) {
          console.log(`\nModel aktif saat ini: ${chalk.bold.green(this.provider.getModel())}\n`);
          
          let response = await prompts({
            type: "autocomplete",
            name: "model",
            message: "Cari atau pilih model aktif (gunakan ↑/↓ & ketik untuk menyaring):",
            choices: choices,
            suggest: suggest,
            limit: 10
          });

          selectedModel = response.model;
        } else {
          // User passed arguments, e.g. /model gemini
          const searchInput = args.join(" ");
          const filtered = smartFilter(searchInput, choices);
          
          // Filter out "__custom__" for exact/filtered check
          const filteredNoCustom = filtered.filter(f => f.value !== "__custom__");

          if (filteredNoCustom.length === 1) {
            // Exactly one match
            selectedModel = filteredNoCustom[0].value;
          } else if (filteredNoCustom.length > 1) {
            // Multiple matches, show filtered selection
            console.log(chalk.yellow(`\nMenampilkan model yang cocok dengan pencarian '${searchInput}':`));
            let response = await prompts({
              type: "autocomplete",
              name: "model",
              message: "Pilih model aktif dari hasil pencarian:",
              choices: [...filteredNoCustom, { title: "✦ Masukkan model kustom...", value: "__custom__" }],
              suggest: suggest,
              limit: 10
            });
            selectedModel = response.model;
          } else {
            // No direct matches in static/openrouter choices list, let's treat the arg as custom or resolve it
            const resolvedModel = this.resolveModelWithAutoDetect(searchInput);
            selectedModel = resolvedModel;
          }
        }

        if (selectedModel === "__custom__") {
          const customResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan identifier model kustom (contoh: 9router/openai/gpt-4o):"
          });
          if (customResponse.value) {
            selectedModel = customResponse.value;
          } else {
            console.log(chalk.yellow("Penggantian model dibatalkan."));
            return true;
          }
        }

        if (selectedModel) {
          const resolvedModel = this.resolveModelWithAutoDetect(selectedModel);
          this.provider.setModel(resolvedModel);
          
          try {
            const config = this.workspaceManager.loadConfig();
            config.provider.default = resolvedModel;
            this.workspaceManager.saveConfig(config);
          } catch (e) {}

          console.log(`Model berhasil diubah ke: ${chalk.green(this.provider.getModel())} (disimpan secara permanen)`);
        } else {
          console.log(chalk.yellow("Penggantian model dibatalkan."));
        }
        break;
      }

      case "tools": {
        const mcpTools = await this.mcpManager.listAllTools();
        const nativeTools = [
          {
            name: "record_fact",
            description: "Menyimpan fakta atau preferensi pengguna ke memori jangka panjang secara otomatis dari percakapan. GUARDRAIL: HANYA catat preferensi/fakta permanen (misal: OS, arsitektur, standar kode). DILARANG KERAS merekam status debugging, error sementara, atau log eksekusi.",
            serverName: "Native System",
            inputSchema: {
              type: "object",
              properties: {
                key: { type: "string", description: "Kunci fakta/preferensi (misal: editor_pilihan)" },
                value: { type: "string", description: "Nilai dari fakta (misal: vscode)" }
              },
              required: ["key", "value"]
            }
          },
          {
            name: "record_knowledge",
            description: "Menulis catatan pengetahuan baru ke dalam basis pengetahuan workspace agar terekam secara otomatis.",
            serverName: "Native System",
            inputSchema: {
              type: "object",
              properties: {
                fileName: { type: "string", description: "Nama file markdown (misal: panduan_deploy.md)" },
                content: { type: "string", description: "Isi catatan markdown lengkap" }
              },
              required: ["fileName", "content"]
            }
          },
          {
            name: "record_skill",
            description: "Membuat skill baru berupa kumpulan instruksi/prosedur kerja spesifik ke folder skill workspace.",
            serverName: "Native System",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Nama skill (misal: push_ke_git)" },
                description: { type: "string", description: "Deskripsi singkat skill" },
                instructions: { type: "string", description: "Isi instruksi detail markdown yang akan ditulis ke SKILL.md" }
              },
              required: ["name", "description", "instructions"]
            }
          }
        ];

        const allTools = [...nativeTools, ...mcpTools.map(t => ({ ...t, serverName: t.serverName || "MCP Server" }))];

        if (args.length > 0) {
          const targetName = args[0].toLowerCase();
          const tool = allTools.find(t => t.name.toLowerCase() === targetName);
          if (tool) {
            this.displayToolDetails(tool);
          } else {
            console.log(chalk.red(`Tool '${args[0]}' tidak ditemukan.`));
          }
          break;
        }

        let viewingTools = true;
        while (viewingTools) {
          const choices = [
            { title: chalk.red("↩ Kembali / Keluar"), value: "__exit__" },
            ...allTools.map(t => ({
              title: `${chalk.cyan(t.name)} ${chalk.gray(`(${t.serverName})`)} - ${t.description.slice(0, 50)}${t.description.length > 50 ? "..." : ""}`,
              value: t.name
            }))
          ];

          const response = await prompts({
            type: "select",
            name: "tool",
            message: "Pilih tool untuk melihat detail skema input:",
            choices
          });

          if (!response.tool || response.tool === "__exit__") {
            viewingTools = false;
            break;
          }

          const selectedTool = allTools.find(t => t.name === response.tool);
          if (selectedTool) {
            this.displayToolDetails(selectedTool);
            await prompts({
              type: "text",
              name: "continue",
              message: "Tekan Enter untuk kembali ke daftar tool..."
            });
          }
        }
        break;
      }

      case "mcp":
      case "servers": {
        let viewingMcp = true;
        while (viewingMcp) {
          const servers = this.config.mcp_servers || [];
          const choices = [
            { title: chalk.red("↩ Kembali / Keluar"), value: "__exit__" },
            { title: chalk.bold.green("✦ Daftarkan Server MCP Baru..."), value: "__add__" }
          ];

          for (const s of servers) {
            choices.push({
              title: `${chalk.cyan(s.name)}: ${s.command} ${s.args?.join(" ") || ""}`,
              value: s.name
            });
          }

          const response = await prompts({
            type: "select",
            name: "mcp",
            message: "Pilih server MCP untuk mengelola / melihat detail:",
            choices
          });

          if (!response.mcp || response.mcp === "__exit__") {
            viewingMcp = false;
            break;
          }

          if (response.mcp === "__add__") {
            await this.handleSlashCommand("/add-mcp");
            continue;
          }

          const selectedMcp = servers.find(s => s.name === response.mcp);
          if (selectedMcp) {
            console.log(chalk.green("\n┌" + "─".repeat(58) + "┐"));
            console.log(`${chalk.green("│")} ${chalk.bold.cyan("Server Name:")} ${selectedMcp.name}`);
            console.log(`${chalk.green("│")} ${chalk.bold.yellow("Command    :")} ${selectedMcp.command}`);
            console.log(`${chalk.green("│")} ${chalk.bold.magenta("Arguments  :")} ${selectedMcp.args?.join(" ") || "(Tidak ada)"}`);
            console.log(chalk.green("└" + "─".repeat(58) + "┘\n"));

            const actionResponse = await prompts({
              type: "select",
              name: "action",
              message: `Aksi untuk server MCP '${selectedMcp.name}':`,
              choices: [
                { title: "↩ Kembali ke Daftar", value: "back" },
                { title: chalk.yellow("⚡ Hubungkan Ulang (Reconnect)"), value: "reconnect" },
                { title: chalk.red("🗑 Hapus Server MCP ini"), value: "delete" }
              ]
            });

            if (actionResponse.action === "reconnect") {
              const spinner = ora(`Menghubungkan kembali ke ${selectedMcp.name}...`).start();
              try {
                await this.mcpManager.connectServer(selectedMcp);
                spinner.succeed(`Berhasil terhubung ke MCP server '${selectedMcp.name}'!`);
              } catch (err: any) {
                spinner.fail(`Gagal menghubungkan: ${err.message}`);
              }
              await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
            } else if (actionResponse.action === "delete") {
              const confirm = await prompts({
                type: "confirm",
                name: "value",
                message: `Apakah Anda yakin ingin menghapus server MCP '${selectedMcp.name}' dari konfigurasi?`,
                initial: false
              });

              if (confirm.value) {
                try {
                  this.workspaceManager.removeMcpServer(selectedMcp.name);
                  this.config = this.workspaceManager.loadConfig();
                  console.log(chalk.green(`✔ Server MCP '${selectedMcp.name}' berhasil dihapus.`));
                } catch (err: any) {
                  console.log(chalk.red(`Gagal menghapus server MCP: ${err.message}`));
                }
                await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
              }
            }
          }
        }
        break;
      }

      case "nodes":
      case "node": {
        let viewingNodes = true;
        while (viewingNodes) {
          const nodes = this.config.nodes || [];
          const choices = [
            { title: chalk.red("↩ Kembali / Keluar"), value: "__exit__" },
            { title: chalk.bold.green("✦ Daftarkan Node Server Baru..."), value: "__add__" }
          ];

          for (const n of nodes) {
            let detail = "";
            if (n.type === "ssh") {
              detail = `${n.user}@${n.host}`;
            } else if (n.type === "docker") {
              detail = `${n.host}`;
            } else if (n.type === "proxmox") {
              detail = `${n.host} (Token: ${n.token_id || n.user})`;
            } else {
              detail = `${n.host}`;
            }
            choices.push({
              title: `${chalk.cyan(n.name)} (${n.type}) - ${detail}`,
              value: n.name
            });
          }

          const response = await prompts({
            type: "select",
            name: "node",
            message: "Pilih node server untuk mengelola / melihat detail:",
            choices
          });

          if (!response.node || response.node === "__exit__") {
            viewingNodes = false;
            break;
          }

          if (response.node === "__add__") {
            console.log(chalk.green("\n=== Tambah Node Baru Secara Interaktif ==="));
            const nameResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan nama node (contoh: prod-server):",
              validate: (val) => val.trim().length > 0 ? true : "Nama tidak boleh kosong."
            });

            if (!nameResponse.value) continue;

            const typeResponse = await prompts({
              type: "select",
              name: "value",
              message: "Pilih tipe node:",
              choices: [
                { title: "SSH Node (Remote Server via SSH)", value: "ssh" },
                { title: "Docker Node (Container/Docker Daemon)", value: "docker" },
                { title: "Proxmox Node (Proxmox VE Cluster API)", value: "proxmox" }
              ]
            });

            if (!typeResponse.value) continue;

            let host = "";
            let user = "";
            let keyPath = "";
            let tokenId = "";

            if (typeResponse.value === "docker") {
              const dockerPreset = await prompts({
                type: "select",
                name: "value",
                message: "Pilih konfigurasi koneksi Docker Daemon:",
                choices: [
                  { title: "Local Docker socket (default UNIX socket lokal)", value: "local" },
                  { title: "Remote Docker via SSH (contoh: ssh://user@host)", value: "ssh" },
                  { title: "Custom Docker host (TCP port/kustom)", value: "custom" }
                ]
              });

              if (!dockerPreset.value) continue;

              if (dockerPreset.value === "local") {
                host = "unix:///var/run/docker.sock";
              } else if (dockerPreset.value === "ssh") {
                const sshHostRes = await prompts({
                  type: "text",
                  name: "value",
                  message: "Masukkan endpoint SSH Docker (contoh: ssh://deployer@192.168.1.10):",
                  validate: (val) => val.trim().startsWith("ssh://") ? true : "Harus berawalan 'ssh://'"
                });
                if (!sshHostRes.value) continue;
                host = sshHostRes.value.trim();
              } else {
                const customHostRes = await prompts({
                  type: "text",
                  name: "value",
                  message: "Masukkan Docker Host endpoint (contoh: tcp://10.0.0.15:2375):",
                  validate: (val) => val.trim().length > 0 ? true : "Endpoint tidak boleh kosong."
                });
                if (!customHostRes.value) continue;
                host = customHostRes.value.trim();
              }
            } else if (typeResponse.value === "proxmox") {
              const hostResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan URL Endpoint Proxmox VE (contoh: https://10.0.0.10:8006):",
                validate: (val) => val.trim().startsWith("http") ? true : "Harus berawalan 'http://' atau 'https://'"
              });
              if (!hostResponse.value) continue;
              host = hostResponse.value.trim();

              const userResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan User / Realm Proxmox (contoh: root@pam atau api-user@pve):",
                validate: (val) => val.trim().length > 0 ? true : "User/realm tidak boleh kosong."
              });
              if (!userResponse.value) continue;
              user = userResponse.value.trim();

              const tokenIdResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan API Token ID Proxmox (contoh: root@pam!novara-token):",
                validate: (val) => val.trim().length > 0 ? true : "Token ID tidak boleh kosong."
              });
              if (!tokenIdResponse.value) continue;
              tokenId = tokenIdResponse.value.trim();

              const tokenSecretResponse = await prompts({
                type: "password",
                name: "value",
                message: "Masukkan API Token Secret Proxmox (disimpan aman di secrets.env):",
                validate: (val) => val.trim().length > 0 ? true : "Token secret tidak boleh kosong."
              });
              if (!tokenSecretResponse.value) continue;
              
              const nodeNameUpper = nameResponse.value.trim().toUpperCase().replace(/[-\s]+/g, "_");
              this.workspaceManager.saveSecret(`PROXMOX_TOKEN_SECRET_${nodeNameUpper}`, tokenSecretResponse.value.trim());
            } else {
              const hostResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan host / IP Address (contoh: 127.0.0.1 atau domain):",
                validate: (val) => val.trim().length > 0 ? true : "Host tidak boleh kosong."
              });

              if (!hostResponse.value) continue;
              host = hostResponse.value.trim();

              const userResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan SSH user (contoh: ubuntu):",
                validate: (val) => val.trim().length > 0 ? true : "User tidak boleh kosong."
              });

              if (!userResponse.value) continue;
              user = userResponse.value.trim();

              const keyResponse = await prompts({
                type: "text",
                name: "value",
                message: "Masukkan path file SSH Key (contoh: ~/.ssh/id_rsa, opsional):",
                initial: "~/.ssh/id_rsa"
              });
              keyPath = keyResponse.value ? keyResponse.value.trim() : "";
            }

            const newNode = {
              name: nameResponse.value.trim(),
              type: typeResponse.value,
              host,
              user: user ? user : undefined,
              key_path: keyPath ? keyPath : undefined,
              token_id: tokenId ? tokenId : undefined
            };

            const config = this.workspaceManager.loadConfig();
            if (!config.nodes) config.nodes = [];
            config.nodes.push(newNode);
            this.workspaceManager.saveConfig(config);
            this.config = this.workspaceManager.loadConfig();

            console.log(chalk.green(`✔ Node '${newNode.name}' berhasil ditambahkan ke workspace!`));
            await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
            continue;
          }

          const selectedNode = nodes.find(n => n.name === response.node);
          if (selectedNode) {
            console.log(chalk.green("\n┌" + "─".repeat(58) + "┐"));
            console.log(`${chalk.green("│")} ${chalk.bold.cyan("Node Name:")} ${selectedNode.name}`);
            console.log(`${chalk.green("│")} ${chalk.bold.yellow("Type     :")} ${selectedNode.type}`);
            console.log(`${chalk.green("│")} ${chalk.bold.magenta("Endpoint :")} ${selectedNode.user}@${selectedNode.host}`);
            console.log(`${chalk.green("│")} ${chalk.bold.white("SSH Key  :")} ${selectedNode.key_path || "(Tanpa kunci / default)"}`);
            console.log(chalk.green("└" + "─".repeat(58) + "┘\n"));

            const actionResponse = await prompts({
              type: "select",
              name: "action",
              message: `Aksi untuk node '${selectedNode.name}':`,
              choices: [
                { title: "↩ Kembali ke Daftar", value: "back" },
                { title: chalk.yellow("⚡ Cek Koneksi (Ping/SSH Test)"), value: "ping" },
                { title: chalk.red("🗑 Hapus Node ini"), value: "delete" }
              ]
            });

            if (actionResponse.action === "ping") {
              const spinner = ora(`Menghubungkan ke ${selectedNode.name}...`).start();
              try {
                const keyArg = selectedNode.key_path ? `-i "${this.resolveHome(selectedNode.key_path)}"` : "";
                const cmd = `ssh ${keyArg} -o ConnectTimeout=4 -o StrictHostKeyChecking=accept-new ${selectedNode.user}@${selectedNode.host} "echo 1"`;
                const out = execSync(cmd, { stdio: "pipe", timeout: 5000 }).toString().trim();
                if (out === "1") {
                  spinner.succeed(`Koneksi sukses! Node '${selectedNode.name}' online.`);
                } else {
                  spinner.fail(`Gagal menyambung ke '${selectedNode.name}'.`);
                }
              } catch (e: any) {
                spinner.fail(`Gagal menghubungkan: ${e.message.split("\n")[0]}`);
              }
              await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
            } else if (actionResponse.action === "delete") {
              const confirm = await prompts({
                type: "confirm",
                name: "value",
                message: `Apakah Anda yakin ingin menghapus node '${selectedNode.name}' dari konfigurasi?`,
                initial: false
              });

              if (confirm.value) {
                const config = this.workspaceManager.loadConfig();
                if (config.nodes) {
                  config.nodes = config.nodes.filter(n => n.name !== selectedNode.name);
                  this.workspaceManager.saveConfig(config);
                  this.config = this.workspaceManager.loadConfig();
                  console.log(chalk.green(`✔ Node '${selectedNode.name}' berhasil dihapus.`));
                }
                await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
              }
            }
          }
        }
        break;
      }

      case "add-mcp":
        if (args.length === 0) {
          console.log(chalk.green("\n=== Tambah Server MCP Secara Interaktif ==="));
          
          const presetChoices = [
            { title: "📁 Filesystem (Akses file/folder di sistem lokal)", value: "filesystem" },
            { title: "🐙 Git (Akses repositori Git lokal untuk status/commit/diff)", value: "git" },
            { title: "🌐 Puppeteer (Automasi & pengambilan data browser headless)", value: "puppeteer" },
            { title: "🗄 SQLite Database (Akses & manipulasi database SQLite lokal)", value: "sqlite" },
            { title: "🐘 PostgreSQL Database (Hubungkan ke database Postgres)", value: "postgres" },
            { title: "💾 Microsoft SQL Server (Hubungkan ke database MSSQL)", value: "mssql" },
            { title: "🌐 Web Fetch (Unduh & baca halaman web untuk konteks)", value: "fetch" },
            { title: "🔍 Brave Search (Pencarian web via Brave Search API)", value: "brave-search" },
            { title: "💻 Custom Command (Tulis command sendiri secara manual)", value: "custom" }
          ];

          const presetResponse = await prompts({
            type: "select",
            name: "preset",
            message: "Pilih jenis server MCP / preset yang ingin ditambahkan:",
            choices: presetChoices
          });

          if (!presetResponse.preset) {
            console.log(chalk.yellow("Batal menambahkan server MCP."));
            break;
          }

          let name = "";
          let command = "";
          let mcpArgs: string[] = [];

          if (presetResponse.preset === "filesystem") {
            name = "filesystem";
            command = "npx";
            const pathResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan absolute path direktori lokal yang ingin diakses:",
              initial: process.cwd()
            });
            if (!pathResponse.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }
            mcpArgs = ["-y", "@modelcontextprotocol/server-filesystem", pathResponse.value.trim()];
          } 
          else if (presetResponse.preset === "git") {
            name = "git";
            command = "npx";
            const repoPathResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan absolute path repositori Git (opsional, default: current folder):",
              initial: process.cwd()
            });
            if (!repoPathResponse.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }
            mcpArgs = ["-y", "@modelcontextprotocol/server-git"];
            if (repoPathResponse.value.trim()) {
              mcpArgs.push(repoPathResponse.value.trim());
            }
          }
          else if (presetResponse.preset === "puppeteer") {
            name = "puppeteer";
            command = "npx";
            mcpArgs = ["-y", "@modelcontextprotocol/server-puppeteer"];
          }
          else if (presetResponse.preset === "sqlite") {
            name = "sqlite";
            command = "npx";
            const dbResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan path menuju file database SQLite (contoh: ./database.db):",
              initial: "./database.db"
            });
            if (!dbResponse.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }
            mcpArgs = ["-y", "@modelcontextprotocol/server-sqlite", dbResponse.value.trim()];
          }
          else if (presetResponse.preset === "postgres") {
            name = "postgres";
            command = "npx";

            console.log(chalk.cyan("\n--- Konfigurasi PostgreSQL ---"));
            const hostRes = await prompts({ type: "text", name: "value", message: "Host:", initial: "localhost" });
            const portRes = await prompts({ type: "number", name: "value", message: "Port:", initial: 5432 });
            const dbRes = await prompts({ type: "text", name: "value", message: "Database Name:", validate: (v) => v.trim() ? true : "Database name is required." });
            const userRes = await prompts({ type: "text", name: "value", message: "Username:", validate: (v) => v.trim() ? true : "Username is required." });
            const passRes = await prompts({ type: "password", name: "value", message: "Password:" });

            if (!dbRes.value || !userRes.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }

            const encodedPass = encodeURIComponent(passRes.value || "");
            const connStr = `postgresql://${userRes.value}:${encodedPass}@${hostRes.value || "localhost"}:${portRes.value || 5432}/${dbRes.value}`;
            this.workspaceManager.saveSecret("POSTGRES_CONNECTION_STRING", connStr);
            
            mcpArgs = ["-y", "@modelcontextprotocol/server-postgres", connStr];
          }
          else if (presetResponse.preset === "mssql") {
            name = "mssql";
            command = "npx";

            console.log(chalk.cyan("\n--- Konfigurasi Microsoft SQL Server ---"));
            const hostRes = await prompts({ type: "text", name: "value", message: "Host / Server Address:", initial: "localhost" });
            const portRes = await prompts({ type: "number", name: "value", message: "Port:", initial: 1433 });
            const dbRes = await prompts({ type: "text", name: "value", message: "Database Name:", validate: (v) => v.trim() ? true : "Database name is required." });
            const userRes = await prompts({ type: "text", name: "value", message: "Username:", validate: (v) => v.trim() ? true : "Username is required." });
            const passRes = await prompts({ type: "password", name: "value", message: "Password:" });

            if (!dbRes.value || !userRes.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }

            const connStr = `Server=${hostRes.value || "localhost"},${portRes.value || 1433};Database=${dbRes.value};User Id=${userRes.value};Password=${passRes.value || ""};Encrypt=true;TrustServerCertificate=true;`;
            this.workspaceManager.saveSecret("MSSQL_CONNECTION_STRING", connStr);
            
            mcpArgs = ["-y", "mcp-mssql-server"];
          }
          else if (presetResponse.preset === "fetch") {
            name = "fetch";
            command = "npx";
            mcpArgs = ["-y", "@modelcontextprotocol/server-fetch"];
          }
          else if (presetResponse.preset === "brave-search") {
            name = "brave-search";
            command = "npx";
            const apiKeyResponse = await prompts({
              type: "password",
              name: "value",
              message: "Masukkan BRAVE_API_KEY Anda (opsional, jika belum diset di environment):"
            });
            mcpArgs = ["-y", "@modelcontextprotocol/server-brave-search"];
            if (apiKeyResponse.value) {
              this.workspaceManager.saveSecret("BRAVE_API_KEY", apiKeyResponse.value);
            }
          }
          else {
            const nameResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan nama server MCP (contoh: sqlite):",
              validate: (val) => val.trim().length > 0 ? true : "Nama tidak boleh kosong."
            });

            if (!nameResponse.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }

            const commandResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan command eksekusi (contoh: npx, node, python):",
              validate: (val) => val.trim().length > 0 ? true : "Command tidak boleh kosong."
            });

            if (!commandResponse.value) {
              console.log(chalk.yellow("Batal menambahkan server MCP."));
              break;
            }

            const argsResponse = await prompts({
              type: "text",
              name: "value",
              message: "Masukkan argumen (pisahkan dengan spasi, opsional):"
            });

            name = nameResponse.value.trim();
            command = commandResponse.value.trim();
            mcpArgs = argsResponse.value ? argsResponse.value.trim().split(/\s+/) : [];
          }

          this.workspaceManager.addMcpServer(name, command, mcpArgs);
          
          this.config = this.workspaceManager.loadConfig();
          
          console.log(chalk.yellow(`\nMenghubungkan ke MCP server baru: ${name}...`));
          const spinner = ora(`Menghubungkan ke ${name}...`).start();
          try {
            await this.mcpManager.connectServer({ name, command, args: mcpArgs });
            spinner.succeed(`Server MCP '${name}' berhasil didaftarkan dan dihubungkan!`);
          } catch (err: any) {
            spinner.fail(`Server terdaftar tapi gagal terhubung: ${err.message}`);
          }
        } else if (args.length < 2) {
          console.log(chalk.red("Format salah. Gunakan: /add-mcp <name> <command> [args...] atau panggil /add-mcp tanpa argumen untuk menu interaktif."));
        } else {
          const name = args[0];
          const command = args[1];
          const mcpArgs = args.slice(2);
          
          this.workspaceManager.addMcpServer(name, command, mcpArgs);
          
          this.config = this.workspaceManager.loadConfig();
          
          console.log(chalk.yellow(`Menghubungkan ke MCP server baru: ${name}...`));
          const spinner = ora(`Menghubungkan ke ${name}...`).start();
          try {
            await this.mcpManager.connectServer({ name, command, args: mcpArgs });
            spinner.succeed(`Server MCP '${name}' berhasil didaftarkan dan dihubungkan!`);
          } catch (err: any) {
            spinner.fail(`Server terdaftar tapi gagal terhubung: ${err.message}`);
          }
        }
        break;

      case "skills": {
        let viewingSkills = true;
        while (viewingSkills) {
          const skillsList = this.workspaceManager.listSkills();
          const choices = [
            { title: chalk.red("↩ Kembali / Keluar"), value: "__exit__" },
            { title: chalk.bold.green("✦ Buat Skill Baru..."), value: "__add__" },
            { title: chalk.bold.cyan("✦ Install Skill Eksternal..."), value: "__install__" }
          ];

          for (const s of skillsList) {
            choices.push({
              title: `${chalk.cyan(s.name)}: ${s.description || "(Tidak ada deskripsi)"}`,
              value: s.name
            });
          }

          const response = await prompts({
            type: "select",
            name: "skill",
            message: "Daftar Skill Workspace (Pilih untuk detail / aksi):",
            choices
          });

          if (!response.skill || response.skill === "__exit__") {
            viewingSkills = false;
            break;
          }

          if (response.skill === "__add__") {
            await this.handleSlashCommand("/add-skill");
            continue;
          }

          if (response.skill === "__install__") {
            const installResponse = await prompts({
              type: "text",
              name: "source",
              message: "Masukkan URL Git atau path folder lokal skill:"
            });
            if (installResponse.source) {
              const spinner = ora("Menginstal skill...").start();
              try {
                const res = this.workspaceManager.installSkill(installResponse.source);
                spinner.succeed(`Skill '${res.name}' berhasil diinstal di: ${res.path}`);
              } catch (err: any) {
                spinner.fail(`Gagal menginstal skill: ${err.message}`);
              }
            }
            continue;
          }

          const selectedSkill = skillsList.find(s => s.name === response.skill);
          if (selectedSkill) {
            const skillDir = path.join(this.workspaceManager.getSkillsDir(), selectedSkill.name);
            const skillMdPath = path.join(skillDir, "SKILL.md");
            let skillInstructions = "(Tidak ada file SKILL.md)";
            if (fs.existsSync(skillMdPath)) {
              skillInstructions = fs.readFileSync(skillMdPath, "utf-8");
            }

            console.log(chalk.green("\n┌" + "─".repeat(58) + "┐"));
            console.log(`${chalk.green("│")} ${chalk.bold.cyan("Skill Name:")} ${selectedSkill.name}`);
            console.log(`${chalk.green("│")} ${chalk.bold.yellow("Description:")} ${selectedSkill.description || "(Tidak ada)"}`);
            console.log(`${chalk.green("│")} ${chalk.bold.magenta("Path       :")} ${skillDir}`);
            console.log(chalk.green("├" + "─".repeat(58) + "┤"));
            console.log(`${chalk.green("│")} ${chalk.bold.white("Instruksi (SKILL.md):")}`);
            const lines = skillInstructions.split("\n");
            for (const line of lines) {
              console.log(`${chalk.green("│")}   ${chalk.gray(line)}`);
            }
            console.log(chalk.green("└" + "─".repeat(58) + "┘\n"));

            const actionResponse = await prompts({
              type: "select",
              name: "action",
              message: `Aksi untuk skill '${selectedSkill.name}':`,
              choices: [
                { title: "↩ Kembali ke Daftar", value: "back" },
                { title: chalk.red("🗑 Hapus Skill ini"), value: "delete" }
              ]
            });

            if (actionResponse.action === "delete") {
              const confirm = await prompts({
                type: "confirm",
                name: "value",
                message: `Apakah Anda yakin ingin menghapus skill '${selectedSkill.name}'?`,
                initial: false
              });

              if (confirm.value) {
                this.workspaceManager.deleteSkill(selectedSkill.name);
                console.log(chalk.green(`✔ Skill '${selectedSkill.name}' berhasil dihapus.`));
                await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
              }
            }
          }
        }
        break;
      }

      case "add-skill":
        if (args[0] === "install") {
          const source = args[1];
          const customName = args[2];
          if (!source) {
            console.log(chalk.red("Format salah. Gunakan: /add-skill install <git-url/folder-path> [nama_kustom]"));
            break;
          }
          const spinner = ora(`Menginstal skill...`).start();
          try {
            const res = this.workspaceManager.installSkill(source, customName);
            spinner.succeed(`Skill '${res.name}' berhasil diinstal di: ${res.path}`);
          } catch (err: any) {
            spinner.fail(`Gagal menginstal skill: ${err.message}`);
          }
          break;
        }

        if (args.length === 0) {
          console.log(chalk.green("\n=== Buat Skill Baru Secara Interaktif ==="));
          const nameResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan nama skill (contoh: push_ke_git):",
            validate: (val) => /^[a-z0-9_-]+$/.test(val.trim()) ? true : "Nama hanya boleh huruf kecil, angka, dash (-), dan underscore (_)."
          });

          if (!nameResponse.value) {
            console.log(chalk.yellow("Batal membuat skill."));
            break;
          }

          const descResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan deskripsi singkat skill:",
            validate: (val) => val.trim().length > 0 ? true : "Deskripsi tidak boleh kosong."
          });

          if (!descResponse.value) {
            console.log(chalk.yellow("Batal membuat skill."));
            break;
          }

          const name = nameResponse.value.trim();
          const desc = descResponse.value.trim();
          const path = this.workspaceManager.createSkill(name, desc);
          console.log(chalk.green(`✔ Skill '${name}' berhasil dibuat di: ${chalk.cyan(path)}`));
        } else if (args.length < 2) {
          console.log(chalk.red("Format salah. Gunakan: /add-skill <name> <description> atau panggil /add-skill tanpa argumen untuk menu interaktif."));
        } else {
          const name = args[0];
          const desc = args.slice(1).join(" ");
          const path = this.workspaceManager.createSkill(name, desc);
          console.log(chalk.green(`✔ Skill '${name}' berhasil dibuat di: ${chalk.cyan(path)}`));
        }
        break;

      case "facts": {
        let viewingFacts = true;
        while (viewingFacts) {
          const factsMap = this.memorySystem.getFacts();
          const factEntries = Object.entries(factsMap);
          
          const choices = [
            { title: chalk.red("↩ Kembali / Keluar"), value: "__exit__" },
            { title: chalk.bold.green("✦ Tambah Fakta Baru..."), value: "__add__" }
          ];

          for (const [k, v] of factEntries) {
            choices.push({
              title: `${chalk.cyan(k)}: ${v}`,
              value: k
            });
          }

          const response = await prompts({
            type: "select",
            name: "fact",
            message: "Daftar Fakta & Preferensi Tersimpan (Pilih untuk detail / aksi):",
            choices
          });

          if (!response.fact || response.fact === "__exit__") {
            viewingFacts = false;
            break;
          }

          if (response.fact === "__add__") {
            await this.handleSlashCommand("/fact");
            continue;
          }

          const selectedKey = response.fact;
          const selectedValue = factsMap[selectedKey];

          console.log(chalk.green("\n┌" + "─".repeat(58) + "┐"));
          console.log(`${chalk.green("│")} ${chalk.bold.cyan("Fact Key  :")} ${selectedKey}`);
          console.log(`${chalk.green("│")} ${chalk.bold.yellow("Fact Value:")} ${selectedValue}`);
          console.log(chalk.green("└" + "─".repeat(58) + "┘\n"));

          const actionResponse = await prompts({
            type: "select",
            name: "action",
            message: `Aksi untuk fakta '${selectedKey}':`,
            choices: [
              { title: "↩ Kembali ke Daftar", value: "back" },
              { title: chalk.yellow("✏ Edit Nilai Fakta"), value: "edit" },
              { title: chalk.red("🗑 Hapus Fakta ini"), value: "delete" }
            ]
          });

          if (actionResponse.action === "edit") {
            const editResponse = await prompts({
              type: "text",
              name: "value",
              message: `Masukkan nilai baru untuk '${selectedKey}':`,
              initial: selectedValue
            });
            if (editResponse.value !== undefined) {
              this.memorySystem.saveFact(selectedKey, editResponse.value);
              console.log(chalk.green(`✔ Nilai fakta untuk '${selectedKey}' berhasil diperbarui.`));
              await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
            }
          } else if (actionResponse.action === "delete") {
            const confirm = await prompts({
              type: "confirm",
              name: "value",
              message: `Apakah Anda yakin ingin menghapus fakta '${selectedKey}'?`,
              initial: false
            });

            if (confirm.value) {
              this.memorySystem.deleteFact(selectedKey);
              console.log(chalk.green(`✔ Fakta '${selectedKey}' berhasil dihapus.`));
              await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
            }
          }
        }
        break;
      }

      case "fact":
        if (args.length === 0) {
          console.log(chalk.green("\n=== Simpan Fakta Baru Secara Interaktif ==="));
          const keyResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan kunci fakta (contoh: editor_pilihan):",
            validate: (val) => val.trim().length > 0 ? true : "Kunci tidak boleh kosong."
          });

          if (!keyResponse.value) {
            console.log(chalk.yellow("Batal menyimpan fakta."));
            break;
          }

          const valResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan nilai fakta (contoh: vscode):",
            validate: (val) => val.trim().length > 0 ? true : "Nilai tidak boleh kosong."
          });

          if (!valResponse.value) {
            console.log(chalk.yellow("Batal menyimpan fakta."));
            break;
          }

          const key = keyResponse.value.trim();
          const val = valResponse.value.trim();
          this.memorySystem.saveFact(key, val);
          console.log(chalk.green(`Fakta berhasil disimpan: ${chalk.cyan(key)} = ${val}`));
        } else if (args.length < 2) {
          console.log(chalk.red("Format salah. Gunakan: /fact <key> <value> atau panggil /fact tanpa argumen untuk menu interaktif."));
        } else {
          const key = args[0];
          const val = args.slice(1).join(" ");
          this.memorySystem.saveFact(key, val);
          console.log(chalk.green(`Fakta berhasil disimpan: ${chalk.cyan(key)} = ${val}`));
        }
        break;

      case "scan": {
        console.log(chalk.green("\n=== Scan MCP & Node Lokal ==="));
        const spinner = ora("Memindai konfigurasi lokal...").start();

        const scannedMcps = this.scanClaudeMcpServers();
        const scannedHosts = this.scanSshConfigHosts();
        const scannedDockers = this.scanLocalDockerDaemon();

        spinner.succeed(`Pemindaian selesai! Ditemukan ${scannedMcps.length} MCP server, ${scannedHosts.length} host SSH, dan ${scannedDockers.length} Docker daemon.`);

        const existingMcps = new Set((this.config.mcp_servers || []).map(s => s.name.toLowerCase()));
        const existingNodes = new Set((this.config.nodes || []).map(n => n.name.toLowerCase()));

        const newMcps = scannedMcps.filter(s => !existingMcps.has(s.name.toLowerCase()));
        const newHosts = scannedHosts.filter(h => !existingNodes.has(h.name.toLowerCase()));
        const newDockers = scannedDockers.filter(d => !existingNodes.has(d.name.toLowerCase()));

        if (newMcps.length === 0 && newHosts.length === 0 && newDockers.length === 0) {
          console.log(chalk.yellow("\nTidak ditemukan MCP server, host SSH, atau Docker daemon baru yang belum terdaftar di workspace ini."));
          break;
        }

        let dockerDetail = "";
        if (newDockers.length > 0) {
          const containers = this.getLocalDockerContainers();
          dockerDetail = containers.length > 0
            ? ` (Kontainer aktif: ${containers.slice(0, 3).join(", ")}${containers.length > 3 ? '...' : ''})`
            : " (Aktif)";
        }

        const choices = [
          ...newMcps.map(s => ({
            title: `[MCP] ${chalk.cyan(s.name)} - ${s.command} ${s.args.join(" ")}`,
            value: { type: "mcp", data: s },
            selected: true
          })),
          ...newHosts.map(h => ({
            title: `[SSH Node] ${chalk.yellow(h.name)} - ${h.user ? h.user + '@' : ''}${h.host}`,
            value: { type: "node_ssh", data: h },
            selected: true
          })),
          ...newDockers.map(d => ({
            title: `[Docker Node] ${chalk.blue(d.name)} - ${d.host}${dockerDetail}`,
            value: { type: "node_docker", data: d },
            selected: true
          }))
        ];

        const response = await prompts({
          type: "multiselect",
          name: "selectedItems",
          message: "Pilih item yang ingin diimport:",
          choices,
          hint: "- Spasi untuk memilih, Enter untuk konfirmasi"
        });

        if (!response.selectedItems || response.selectedItems.length === 0) {
          console.log(chalk.yellow("Import dibatalkan. Tidak ada item yang dipilih."));
          break;
        }

        const targetRes = await prompts({
          type: "select",
          name: "value",
          message: "Di mana Anda ingin menyimpan/mengimpor item-item terpilih ini?",
          choices: [
            { title: `[Workspace Saat Ini] ${this.config.name}`, value: "current" },
            { title: "✦ Buat Workspace/Tenant/Perusahaan Baru...", value: "new" }
          ]
        });

        if (!targetRes.value) {
          console.log(chalk.yellow("Import dibatalkan."));
          break;
        }

        let targetManager = this.workspaceManager;
        let isNewWorkspace = false;
        let newWorkspaceDir = "";

        if (targetRes.value === "new") {
          const nameResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan nama workspace/tenant/perusahaan baru:",
            validate: (val) => val.trim().length > 0 ? true : "Nama tidak boleh kosong."
          });

          if (!nameResponse.value) {
            console.log(chalk.yellow("Import dibatalkan."));
            break;
          }

          const workspaceName = nameResponse.value.trim();
          const defaultPath = path.join(os.homedir(), "novara-workspaces", workspaceName.toLowerCase().replace(/\s+/g, "-"));
          
          const pathResponse = await prompts({
            type: "text",
            name: "value",
            message: "Masukkan absolute path lokasi folder workspace baru:",
            initial: defaultPath
          });

          if (!pathResponse.value) {
            console.log(chalk.yellow("Import dibatalkan."));
            break;
          }

          newWorkspaceDir = this.resolveHome(pathResponse.value.trim());
          
          try {
            if (!fs.existsSync(newWorkspaceDir)) {
              fs.mkdirSync(newWorkspaceDir, { recursive: true });
            }
            targetManager = new WorkspaceManager(newWorkspaceDir);
            targetManager.initWorkspace(workspaceName);
            isNewWorkspace = true;
            console.log(chalk.green(`✔ Workspace/Tenant baru '${workspaceName}' berhasil diinisialisasi di: ${newWorkspaceDir}`));

            const copyRes = await prompts({
              type: "confirm",
              name: "value",
              message: "(Rekomendasi) Apakah Anda ingin menyalin konfigurasi provider LLM & API Keys dari workspace saat ini?",
              initial: true
            });

            if (copyRes.value) {
              const currentConfig = this.workspaceManager.loadConfig();
              const newConfig = targetManager.loadConfig();
              newConfig.provider = { ...currentConfig.provider };
              targetManager.saveConfig(newConfig);

              const currentSecrets = this.workspaceManager.loadSecrets();
              for (const [k, v] of Object.entries(currentSecrets)) {
                if (v) {
                  targetManager.saveSecret(k, v);
                }
              }
              console.log(chalk.green("✔ Konfigurasi provider LLM & API Keys berhasil disalin!"));
            } else {
              console.log(chalk.yellow("Setup provider dilewati. Anda dapat melakukan setup baru nanti dengan perintah 'nos setup'."));
            }

          } catch (err: any) {
            console.error(chalk.red(`Gagal menginisialisasi workspace baru: ${err.message}`));
            break;
          }
        }

        console.log(chalk.cyan("\nMengimpor item terpilih..."));

        let mcpCount = 0;
        let nodeCount = 0;

        for (const item of response.selectedItems) {
          if (item.type === "mcp") {
            const server = item.data;
            targetManager.addMcpServer(server.name, server.command, server.args);
            
            if (server.env) {
              for (const [key, value] of Object.entries(server.env)) {
                targetManager.saveSecret(key, String(value));
                console.log(chalk.gray(`  └─ Menyimpan environment credential: ${chalk.bold(key)}`));
              }
            }
            mcpCount++;
          } else if (item.type === "node_ssh") {
            const host = item.data;
            const config = targetManager.loadConfig();
            if (!config.nodes) config.nodes = [];
            config.nodes.push({
              name: host.name,
              type: "ssh",
              host: host.host,
              user: host.user,
              key_path: host.key_path
            });
            targetManager.saveConfig(config);
            nodeCount++;
          } else if (item.type === "node_docker") {
            const daemon = item.data;
            const config = targetManager.loadConfig();
            if (!config.nodes) config.nodes = [];
            config.nodes.push({
              name: daemon.name,
              type: "docker",
              host: daemon.host
            });
            targetManager.saveConfig(config);
            nodeCount++;
          }
        }

        if (!isNewWorkspace) {
          this.config = this.workspaceManager.loadConfig();
          console.log(chalk.green(`\n✔ Berhasil mengimpor ${mcpCount} MCP server dan ${nodeCount} Node ke workspace saat ini!`));
          
          if (mcpCount > 0) {
            console.log(chalk.yellow("\nMenghubungkan ke MCP server yang baru diimpor..."));
            for (const item of response.selectedItems) {
              if (item.type === "mcp") {
                const server = item.data;
                const connSpinner = ora(`Menghubungkan ke ${server.name}...`).start();
                try {
                  await this.mcpManager.connectServer({ name: server.name, command: server.command, args: server.args });
                  connSpinner.succeed(`Server MCP '${server.name}' berhasil terhubung!`);
                } catch (err: any) {
                  connSpinner.fail(`Server terdaftar tapi gagal terhubung: ${err.message}`);
                }
              }
            }
          }
        } else {
          console.log(chalk.green(`\n✔ Berhasil mengimpor ${mcpCount} MCP server dan ${nodeCount} Node ke workspace baru!`));
          console.log(chalk.cyan(`\nUntuk beralih ke workspace baru ini, silakan masuk ke foldernya di terminal:`));
          console.log(chalk.yellow(`cd "${newWorkspaceDir}"`));
          console.log(chalk.cyan(`Kemudian jalankan perintah Novara OS (seperti 'nos chat' atau 'nos run').`));
        }
        
        await prompts({ type: "text", name: "ok", message: "Tekan Enter untuk melanjutkan..." });
        break;
      }

      case "session":
      case "sessions": {
        const subCmd = args[0]?.toLowerCase();
        const sessionArg = args[1];

        if (!subCmd) {
          const sessions = this.memorySystem.listSessions();
          const active = this.memorySystem.getActiveSession();
          console.log(chalk.green("\n=== Novara OS Chat Sessions ==="));
          console.log(`Active Session: ${chalk.bold.magenta(active)}`);
          console.log("--------------------------------");
          for (const s of sessions) {
            if (s === active) {
              console.log(`* ${chalk.bold.magenta(s)} (active)`);
            } else {
              console.log(`  ${s}`);
            }
          }
          console.log("\nCommands:");
          console.log(`  ${chalk.cyan("/session new <name>")}    - Create and switch to a new session`);
          console.log(`  ${chalk.cyan("/session load <name>")}   - Switch to an existing session`);
          console.log(`  ${chalk.cyan("/session delete <name>")} - Delete a session`);
          console.log("=================================\n");
          break;
        }

        if (subCmd === "new" || subCmd === "create") {
          if (!sessionArg) {
            console.log(chalk.red("Error: Nama sesi baru harus disertakan. Contoh: /session new debug-api"));
            break;
          }
          this.memorySystem.setSession(sessionArg);
          console.log(chalk.green(`✔ Berhasil membuat dan beralih ke sesi baru: ${chalk.bold.magenta(this.memorySystem.getActiveSession())}`));
          break;
        }

        if (subCmd === "load" || subCmd === "switch") {
          if (!sessionArg) {
            console.log(chalk.red("Error: Nama sesi harus disertakan. Contoh: /session load default"));
            break;
          }
          const sessions = this.memorySystem.listSessions();
          if (!sessions.includes(sessionArg)) {
            console.log(chalk.red(`Error: Sesi '${sessionArg}' tidak ditemukan. Buat dengan '/session new ${sessionArg}'.`));
            break;
          }
          this.memorySystem.setSession(sessionArg);
          console.log(chalk.green(`✔ Berhasil beralih ke sesi: ${chalk.bold.magenta(this.memorySystem.getActiveSession())}`));
          break;
        }

        if (subCmd === "delete" || subCmd === "remove") {
          if (!sessionArg) {
            console.log(chalk.red("Error: Nama sesi yang ingin dihapus harus disertakan."));
            break;
          }
          if (sessionArg === "default") {
            console.log(chalk.red("Error: Sesi 'default' tidak dapat dihapus."));
            break;
          }
          const confirmDel = await prompts({
            type: "confirm",
            name: "value",
            message: `Apakah Anda yakin ingin menghapus sesi '${sessionArg}' beserta seluruh riwayatnya?`,
            initial: false
          });
          if (confirmDel.value) {
            this.memorySystem.deleteSession(sessionArg);
            console.log(chalk.green(`✔ Sesi '${sessionArg}' berhasil dihapus.`));
          } else {
            console.log(chalk.yellow("Penghapusan dibatalkan."));
          }
          break;
        }

        console.log(chalk.red(`Perintah sesi tidak dikenal: ${subCmd}. Gunakan '/session' untuk bantuan.`));
        break;
      }

      case "clear": {
        const confirmClear = await prompts({
          type: "confirm",
          name: "value",
          message: "Apakah Anda yakin ingin menghapus seluruh riwayat percakapan sesi ini?",
          initial: false
        });
        if (confirmClear.value) {
          this.memorySystem.clearHistory();
          console.log(chalk.green("Riwayat percakapan dibersihkan."));
        } else {
          console.log(chalk.yellow("Pembersihan riwayat dibatalkan."));
        }
        break;
      }

      case "cls":
      case "clear-screen": {
        console.clear();
        console.log(chalk.green("Layar dibersihkan (konteks percakapan tetap dipertahankan)."));
        break;
      }

      case "grill-me":
      case "drill-me": {
        const topic = args.join(" ");
        if (!topic) {
          console.log(chalk.red("Penggunaan: /grill-me <topik atau tujuan yang ingin dibahas>"));
          break;
        }
        console.log(chalk.blue(`\n🕵️ Memulai sesi interview (grill-me) untuk topik: ${chalk.bold(topic)}`));
        const grillPrompt = `I want to align on a plan and resolve design decisions for the following topic: "${topic}". 
Please act as an expert interviewer and architect. Your goal is to "grill" me by asking one multiple-choice or open-ended question at a time to clarify my requirements, edge cases, and design choices. 
Wait for my answer before asking the next question. Do not start any implementation until you have a complete picture. When you feel you have enough information, output a final comprehensive technical specification.`;
        
        // Disable guardrail temporarily for this prompt if needed, or let runTask handle it natively.
        await this.runTask(grillPrompt, true);
        break;
      }

      default:
        console.log(chalk.red(`Perintah slash tidak dikenali: /${command}. Ketik /help untuk melihat bantuan.`));
        break;
    }

    return true;
  }

  private displayToolDetails(tool: any) {
    console.log(chalk.green("\n┌" + "─".repeat(58) + "┐"));
    console.log(`${chalk.green("│")} ${chalk.bold.cyan("Tool Name:")} ${tool.name}`);
    console.log(`${chalk.green("│")} ${chalk.bold.yellow("Source   :")} ${tool.serverName || "MCP Server"}`);
    console.log(`${chalk.green("│")} ${chalk.bold.magenta("Desc     :")} ${tool.description}`);
    console.log(chalk.green("├" + "─".repeat(58) + "┤"));
    console.log(`${chalk.green("│")} ${chalk.bold.white("Input Schema (Parameters):")}`);
    if (tool.inputSchema) {
      const schema = tool.inputSchema;
      if (schema.properties) {
        for (const [propName, propDetails] of Object.entries(schema.properties as Record<string, any>)) {
          const req = schema.required?.includes(propName) ? chalk.red(" (wajib)") : chalk.gray(" (opsional)");
          console.log(`${chalk.green("│")}   • ${chalk.cyan(propName)}${req} - ${chalk.yellow(propDetails.type)}`);
          if (propDetails.description) {
            console.log(`${chalk.green("│")}     ${chalk.gray(propDetails.description)}`);
          }
        }
      } else {
        console.log(`${chalk.green("│")}   (Tidak ada parameter)`);
      }
    } else {
      console.log(`${chalk.green("│")}   (Tidak ada skema input)`);
    }
    console.log(chalk.green("└" + "─".repeat(58) + "┘\n"));
  }

  getModel(): string {
    return this.provider ? this.provider.getModel() : this.config.provider.default;
  }

  private resolveModelWithAutoDetect(inputModel: string): string {
    // If it already contains provider prefix, return it
    if (inputModel.includes("/")) {
      return inputModel;
    }

    const lower = inputModel.toLowerCase();

    // 1. Google Gemini
    if (lower.startsWith("gemini-") || lower === "gemini") {
      return `gemini/${inputModel}`;
    }

    // 2. OpenAI
    if (lower.startsWith("gpt-") || lower.startsWith("o1-")) {
      return `openai/${inputModel}`;
    }

    // 3. Claude (via OpenRouter)
    if (lower.startsWith("claude-")) {
      if (lower.includes("3-haiku")) {
        return `openrouter/anthropic/claude-3-haiku`;
      }
      if (lower.includes("3.5-sonnet") || lower.includes("3-5-sonnet")) {
        return `openrouter/anthropic/claude-3.5-sonnet`;
      }
      return `openrouter/anthropic/${inputModel}`;
    }

    // 4. LLaMA & Mistral (via Ollama)
    if (lower.startsWith("llama-") || lower === "llama3" || lower.startsWith("llama3")) {
      return `ollama/${inputModel}`;
    }
    if (lower.startsWith("mistral-") || lower === "mistral") {
      return `ollama/${inputModel}`;
    }

    return inputModel;
  }

  private async fetchOpenRouterModels(): Promise<Array<{ id: string; name: string }>> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return [];

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools", {
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      });
      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.data) {
          return data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id
          }));
        }
      }
    } catch {
      // Ignore
    }
    return [];
  }

  getModelCompletions(): string[] {
    const staticCompletions = [
      "gemini/gemini-1.5-flash",
      "gemini/gemini-1.5-pro",
      "gemini/gemini-2.5-flash",
      "gemini/gemini-2.5-pro",
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "openrouter/anthropic/claude-3.5-sonnet",
      "ollama/llama3",
      "ollama/mistral",
      "ollama/codellama",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gpt-4o-mini",
      "gpt-4o",
      "claude-3.5-sonnet",
      "llama3",
      "mistral",
      "codellama"
    ];

    if (this.openRouterModels && this.openRouterModels.length > 0) {
      const dynamicCompletions: string[] = [];
      for (const m of this.openRouterModels) {
        dynamicCompletions.push(`openrouter/${m.id}`);
        dynamicCompletions.push(m.id);
      }
      return [...staticCompletions, ...dynamicCompletions];
    }

    return staticCompletions;
  }

  async shutdown(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.shutdown();
    }
  }

  private scanClaudeMcpServers(): Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }> {
    const servers: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }> = [];
    let configPath = "";
    
    if (process.platform === "darwin") {
      configPath = path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    } else if (process.platform === "win32") {
      const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      configPath = path.join(appData, "Claude", "claude_desktop_config.json");
    } else {
      configPath = path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
    }

    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && parsed.mcpServers && typeof parsed.mcpServers === "object") {
          for (const [name, serverConf] of Object.entries(parsed.mcpServers)) {
            if (serverConf && typeof serverConf === "object") {
              const cmd = (serverConf as any).command;
              const args = (serverConf as any).args || [];
              const env = (serverConf as any).env;
              if (cmd && typeof cmd === "string") {
                servers.push({
                  name,
                  command: cmd,
                  args: Array.isArray(args) ? args.map(String) : [],
                  env: env && typeof env === "object" ? env : undefined
                });
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(chalk.yellow(`[Scan] Gagal membaca Claude Desktop config: ${err.message}`));
      }
    }
    return servers;
  }

  private scanSshConfigHosts(): Array<{ name: string; host: string; user?: string; key_path?: string }> {
    const hosts: Array<{ name: string; host: string; user?: string; key_path?: string }> = [];
    const configPath = path.join(os.homedir(), ".ssh", "config");
    
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const lines = content.split("\n");
        
        let currentHost: { name: string; host?: string; user?: string; key_path?: string } | null = null;
        
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          
          const hostMatch = line.match(/^Host\s+(.+)$/i);
          if (hostMatch) {
            if (currentHost && currentHost.name && currentHost.host && !currentHost.name.includes("*") && !currentHost.name.includes("?")) {
              hosts.push({
                name: currentHost.name,
                host: currentHost.host,
                user: currentHost.user,
                key_path: currentHost.key_path
              });
            }
            
            const hostNamePattern = hostMatch[1].trim().replace(/^["']|["']$/g, "");
            if (hostNamePattern.includes("*") || hostNamePattern.includes("?")) {
              currentHost = null;
            } else {
              currentHost = { name: hostNamePattern };
            }
            continue;
          }
          
          if (!currentHost) continue;
          
          const hostNameMatch = line.match(/^HostName\s+(.+)$/i);
          if (hostNameMatch) {
            currentHost.host = hostNameMatch[1].trim().replace(/^["']|["']$/g, "");
            continue;
          }
          
          const userMatch = line.match(/^User\s+(.+)$/i);
          if (userMatch) {
            currentHost.user = userMatch[1].trim().replace(/^["']|["']$/g, "");
            continue;
          }
          
          const identityFileMatch = line.match(/^IdentityFile\s+(.+)$/i);
          if (identityFileMatch) {
            currentHost.key_path = identityFileMatch[1].trim().replace(/^["']|["']$/g, "");
            continue;
          }
        }
        
        if (currentHost && currentHost.name && currentHost.host && !currentHost.name.includes("*") && !currentHost.name.includes("?")) {
          hosts.push({
            name: currentHost.name,
            host: currentHost.host,
            user: currentHost.user,
            key_path: currentHost.key_path
          });
        }
      } catch (err: any) {
        console.warn(chalk.yellow(`[Scan] Gagal membaca SSH config: ${err.message}`));
      }
    }
    return hosts;
  }

  private scanLocalDockerDaemon(): Array<{ name: string; type: string; host: string }> {
    const daemons: Array<{ name: string; type: string; host: string }> = [];
    
    if (process.platform !== "win32") {
      if (fs.existsSync("/var/run/docker.sock")) {
        daemons.push({
          name: "local-docker",
          type: "docker",
          host: "unix:///var/run/docker.sock"
        });
      }
    } else {
      try {
        execSync("docker info", { stdio: "ignore" });
        daemons.push({
          name: "local-docker",
          type: "docker",
          host: "npipe:////./pipe/docker_engine"
        });
      } catch {}
    }

    if (daemons.length === 0) {
      try {
        execSync("docker info", { stdio: "ignore" });
        const host = process.platform === "win32" ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
        daemons.push({
          name: "local-docker",
          type: "docker",
          host
        });
      } catch {}
    }

    return daemons;
  }

  private getLocalDockerContainers(): string[] {
    try {
      const output = execSync("docker ps --format '{{.Names}} ({{.Image}})'", { stdio: "pipe", timeout: 2000 }).toString();
      return output.split("\n").map(l => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  private getProxmoxSecret(node: any): string {
    const cleanName = node.name.toUpperCase().replace(/[-\s]+/g, "_");
    const secret = process.env[`PROXMOX_TOKEN_SECRET_${cleanName}`] || process.env.PROXMOX_TOKEN_SECRET;
    if (!secret) {
      throw new Error(`Proxmox Token Secret tidak ditemukan di environment. Set PROXMOX_TOKEN_SECRET_${cleanName} di secrets.env.`);
    }
    return secret;
  }

  private async proxmoxRequest(node: any, method: string, pathUrl: string, body?: any): Promise<any> {
    const tokenSecret = this.getProxmoxSecret(node);
    const url = new URL(pathUrl, node.host);
    
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port || 8006,
        path: url.pathname + url.search,
        headers: {
          "Authorization": `PVEAPIToken=${node.token_id}=${tokenSecret}`,
          "Accept": "application/json",
        },
        rejectUnauthorized: false
      };

      if (body) {
        options.headers = {
          ...options.headers,
          "Content-Type": "application/x-www-form-urlencoded"
        };
      }

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
            reject(new Error(`Proxmox API Error (${res.statusCode}): ${data}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (body) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) {
          params.append(k, String(v));
        }
        req.write(params.toString());
      }
      req.end();
    });
  }

  private resolveHome(filePath: string): string {
    if (filePath.startsWith("~/") || filePath === "~") {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  private runDockerCommand(node: any, subCmd: string): string {
    if (node.host.startsWith("unix://")) {
      const socketPath = node.host.replace("unix://", "");
      const cmd = `docker -H unix://${socketPath} ${subCmd}`;
      return execSync(cmd, { stdio: "pipe", timeout: 15000 }).toString();
    } else if (node.host.startsWith("ssh://")) {
      const cleanHost = node.host.replace("ssh://", "");
      const parts = cleanHost.split("@");
      let user = "root";
      let ip = cleanHost;
      if (parts.length > 1) {
        user = parts[0];
        ip = parts[1];
      }
      const keyArg = node.key_path ? `-i "${this.resolveHome(node.key_path)}"` : "";
      const cmd = `ssh ${keyArg} -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ${user}@${ip} "docker ${subCmd}"`;
      return execSync(cmd, { stdio: "pipe", timeout: 20000 }).toString();
    } else {
      const cmd = `docker -H ${node.host} ${subCmd}`;
      return execSync(cmd, { stdio: "pipe", timeout: 15000 }).toString();
    }
  }

  private formatMarkdownResponse(text: string): string {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    
    return text.replace(codeBlockRegex, (match, lang, code) => {
      const borderChar = "─";
      const topBorder = chalk.hex("#cba6f7")("┌" + borderChar.repeat(60));
      const bottomBorder = chalk.hex("#cba6f7")("└" + borderChar.repeat(60));
      const langHeader = lang ? chalk.bold.hex("#f9e2af")(` [${lang.toUpperCase()}] `) : "";
      
      const styledCode = code
        .split("\n")
        .map((line: string) => chalk.hex("#cba6f7")("│") + chalk.hex("#b4befe")(`  ${line}`))
        .join("\n");
        
      return `\n${topBorder}${langHeader}\n${styledCode}\n${bottomBorder}\n`;
    });
  }
}
