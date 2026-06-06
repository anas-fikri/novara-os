import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import prompts from "prompts";
import { WorkspaceManager } from "./workspace/workspace.js";
import { CoreOrchestrator } from "./core/orchestrator.js";
import { MemorySystem } from "./memory/memory.js";
import { startOauthFlow } from "./workspace/oauth.js";
import { runInteractiveSetup } from "./workspace/setup.js";
import readline from "readline";
import { ApiServer } from "./core/server.js";

const program = new Command();

program
  .name("novara")
  .description("Workspace-Oriented Intelligence Operating System CLI")
  .version("0.1.0");

// Command: Login
program
  .command("login")
  .description("Login ke akun Google menggunakan OAuth untuk integrasi provider")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    try {
      await startOauthFlow(manager);
    } catch (err: any) {
      console.error(chalk.red(`Gagal melakukan OAuth: ${err.message}`));
    }
  });

// Command: Set Key
program
  .command("set-key")
  .description("Simpan API Key secara interaktif")
  .argument("<provider>", "Nama provider (gemini, openai, openrouter, dll.)")
  .argument("<key>", "API Key atau nilai credential")
  .action((provider, key) => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    const providerName = provider.toLowerCase();
    let envKey = "";
    if (providerName === "gemini") envKey = "GEMINI_API_KEY";
    else if (providerName === "openai") envKey = "OPENAI_API_KEY";
    else if (providerName === "openrouter") envKey = "OPENROUTER_API_KEY";
    else if (providerName === "google_client_id") envKey = "GOOGLE_CLIENT_ID";
    else if (providerName === "google_client_secret") envKey = "GOOGLE_CLIENT_SECRET";
    else {
      envKey = provider.toUpperCase();
    }

    try {
      manager.saveSecret(envKey, key);
      console.log(chalk.green(`✔ API Key untuk ${chalk.cyan(envKey)} berhasil disimpan dan diaktifkan!`));
    } catch (err: any) {
      console.error(chalk.red(`Gagal menyimpan API Key: ${err.message}`));
    }
  });

// Command: Completion
program
  .command("completion")
  .description("Setup shell autocomplete (tab completion) untuk zsh/bash")
  .action(async () => {
    const shell = process.env.SHELL || "";
    if (shell.includes("zsh")) {
      const zshScript = `
# Autocomplete untuk Novara OS CLI
# Muat modul autocomplete zsh jika belum dimuat
if ! type compdef >/dev/null 2>&1; then
  autoload -Uz compinit && compinit
fi

_novara() {
  local -a commands
  commands=(
    'init:Inisialisasi workspace Novara OS baru'
    'login:Login ke akun Google menggunakan OAuth'
    'set-key:Simpan API Key secara interaktif'
    'setup:Setup provider LLM dan API Key secara interaktif'
    'model:Lihat atau ganti model default workspace'
    'mcp:Kelola server MCP secara interaktif'
    'nodes:Kelola remote node server secara interaktif'
    'skills:Kelola workspace skills secara interaktif'
    'facts:Kelola preferensi & fakta memori secara interaktif'
    'scan:Scan local disk untuk mendeteksi MCP server & host SSH'
    'workspace:Tampilkan konfigurasi workspace'
    'run:Jalankan satu tugas spesifik'
    'chat:Sesi percakapan interaktif'
    'logs:Tampilkan log riwayat percakapan'
    'serve:Mulai REST API server untuk memproses antrean tugas (task queue)'
    'completion:Setup autocomplete untuk zsh/bash'
  )

  _arguments \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      _describe -t commands 'novara commands' commands
      ;;
    args)
      case $line[1] in
        set-key)
          local -a providers
          providers=(gemini openai openrouter google_client_id google_client_secret)
          _describe -t providers 'providers' providers
          ;;
      esac
      ;;
  esac
}

compdef _novara novara nos
`;
      const zshrcPath = path.join(process.env.HOME || "", ".zshrc");
      
      console.log(chalk.green("\n=== Setup Autocomplete (zsh) ==="));
      console.log(`Menambahkan script autocomplete ke: ${chalk.cyan(zshrcPath)}...`);
      
      const confirm = await prompts({
        type: "confirm",
        name: "value",
        message: "Apakah Anda ingin menulis script ini ke ~/.zshrc secara otomatis?",
        initial: true
      });

      if (confirm.value) {
        fs.appendFileSync(zshrcPath, `\n# Novara OS Autocomplete\n${zshScript}\n`, "utf-8");
        console.log(chalk.green("✔ Script autocomplete berhasil ditambahkan!"));
        console.log(`Silakan muat ulang terminal Anda atau jalankan: ${chalk.yellow("source ~/.zshrc")}`);
      } else {
        console.log("\nSetup dibatalkan. Anda dapat menambahkan script berikut secara manual ke ~/.zshrc Anda:");
        console.log(chalk.yellow(zshScript));
      }
    } else {
      console.log(chalk.yellow("\nAutocomplete saat ini baru didukung penuh untuk shell zsh."));
    }
  });

// Command: Init



program
  .command("init")
  .description("Inisialisasi workspace Novara OS baru")
  .option("-n, --name <name>", "Nama workspace")
  .option("-y, --yes", "Setup otomatis menggunakan default tanpa konfirmasi interaktif")
  .action(async (options) => {
    const manager = new WorkspaceManager();
    if (manager.isWorkspace()) {
      console.log(chalk.yellow("Folder ini sudah merupakan workspace Novara OS!"));
      return;
    }

    let workspaceName = options.name;
    if (!workspaceName) {
      if (options.yes) {
        workspaceName = path.basename(process.cwd());
      } else {
        const response = await prompts({
          type: "text",
          name: "name",
          message: "Masukkan nama untuk workspace ini:",
          initial: path.basename(process.cwd())
        });
        workspaceName = response.name;
      }
    }

    if (!workspaceName) {
      console.log(chalk.red("Inisialisasi dibatalkan. Nama workspace diperlukan."));
      return;
    }

    try {
      const config = manager.initWorkspace(workspaceName);
      console.log(chalk.green(`\nSuccess! Workspace '${config.name}' berhasil diinisialisasi.`));
      console.log(`Folder konfigurasi dibuat di: ${chalk.cyan(manager.getNovaraDir())}`);
      
      if (options.yes) {
        console.log(chalk.yellow("\nSetup interaktif dilewati karena opsi --yes. Silakan jalankan 'novara setup' atau isi API key secara manual."));
      } else {
        const setupConfirm = await prompts({
          type: "confirm",
          name: "value",
          message: "Apakah Anda ingin melakukan setup provider (API Key & model default) sekarang?",
          initial: true
        });

        if (setupConfirm.value) {
          await runInteractiveSetup(manager);
        } else {
          console.log(chalk.yellow(`\nSilakan isi API key Anda di: ${chalk.cyan(path.join(manager.getNovaraDir(), "secrets.env"))}`));
        }
      }
    } catch (err: any) {
      console.error(chalk.red(`Gagal menginisialisasi workspace: ${err.message}`));
    }
  });

// Command: Setup Provider
program
  .command("setup")
  .description("Setup provider LLM dan API Key secara interaktif")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    try {
      await runInteractiveSetup(manager);
    } catch (err: any) {
      console.error(chalk.red(`Gagal melakukan setup provider: ${err.message}`));
    }
  });

// Command: Model Selection
program
  .command("model")
  .description("Lihat atau ganti model default workspace secara interaktif")
  .argument("[model]", "Nama model kustom (opsional)")
  .action(async (modelArg) => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand(`/model${modelArg ? " " + modelArg : ""}`);
    } catch (err: any) {
      console.error(chalk.red(`Gagal mengubah model: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });
// Command: MCP Management
program
  .command("mcp")
  .description("Kelola server MCP secara interaktif")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand("/mcp");
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Node Management
program
  .command("nodes")
  .alias("node")
  .description("Kelola remote node server secara interaktif")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand("/nodes");
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Skills Management
program
  .command("skills")
  .alias("skill")
  .description("Kelola workspace skills secara interaktif")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand("/skills");
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Facts Management
program
  .command("facts")
  .alias("fact")
  .description("Kelola preferensi & fakta memori secara interaktif")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand("/facts");
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Scan Disk
program
  .command("scan")
  .description("Scan local disk untuk mendeteksi MCP server dan host SSH secara otomatis")
  .action(async () => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.handleSlashCommand("/scan");
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Serve API Server
program
  .command("serve")
  .description("Mulai REST API server untuk memproses antrean tugas (task queue)")
  .option("-p, --port <number>", "Port server API (default: 8088)", "8088")
  .action((options) => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    const port = parseInt(options.port, 10) || 8088;
    const server = new ApiServer(port, manager.getWorkspaceDir());
    server.start();
  });

// Command: Workspace Info
program
  .command("workspace")
  .description("Tampilkan informasi konfigurasi workspace saat ini")
  .action(() => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS. Jalankan 'novara init' terlebih dahulu."));
      return;
    }

    try {
      const config = manager.loadConfig();
      console.log(chalk.green("\n=== Novara OS Workspace ==="));
      console.log(`Nama        : ${chalk.cyan(config.name)}`);
      console.log(`Deskripsi   : ${config.description || "N/A"}`);
      console.log(`Provider    : ${chalk.yellow(config.provider.default)}`);
      console.log(`MCP Servers : ${config.mcp_servers?.map((s) => s.name).join(", ") || "N/A"}`);
      console.log(`Nodes       : ${config.nodes?.map((n) => n.name).join(", ") || "N/A"}`);
      console.log(`Localization: Primary=${config.settings?.localization?.primary_language}, Fallback=${config.settings?.localization?.fallback_language}`);
      console.log("===========================");
    } catch (err: any) {
      console.error(chalk.red(`Gagal membaca konfigurasi: ${err.message}`));
    }
  });

// Command: Run a single task
program
  .command("run")
  .description("Jalankan satu tugas spesifik dalam workspace")
  .argument("<query>", "Deskripsi tugas yang ingin dijalankan")
  .action(async (query) => {
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      await orchestrator.runTask(query);
    } catch (err: any) {
      console.error(chalk.red(`\nGagal menjalankan tugas: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: Chat session
program
  .command("chat")
  .description("Masuk ke sesi percakapan interaktif dengan Novara OS")
  .action(async () => {
    const orchestrator = new CoreOrchestrator();
    try {
      await orchestrator.init();
      const manager = new WorkspaceManager();
      const config = manager.loadConfig();

      console.log(chalk.cyan(`
   _  _                     _    ___  ___ 
  | \\| |___ _  _ __ _ _ _ __ _   / _ \\/ __|
  | .\` / _ \\ || / _\` | '_/ _\` | | (_) \\__ \\
  |_|\\_\\___/\\_,_\\__,_|_| \\__,_|  \\___/|___/
  
  ${chalk.bold("Workspace-Oriented Intelligence OS")} (v0.1.0)
      `));
      console.log(chalk.gray("--------------------------------------------------"));
      console.log(`${chalk.bold("Workspace:")} ${chalk.green(config.name)}`);
      console.log(`${chalk.bold("Model    :")} ${chalk.yellow(config.provider.default)}`);
      console.log(`${chalk.bold("MCPs     :")} ${chalk.cyan(config.mcp_servers?.map(s => s.name).join(", ") || "None")}`);
      console.log(chalk.gray("--------------------------------------------------"));
      console.log(chalk.gray("Ketik '/help' untuk melihat daftar perintah slash."));
      console.log(chalk.gray("Tekan [Tab] untuk autocomplete perintah slash."));
      console.log(chalk.gray("Ketik 'exit' atau '/exit' untuk keluar."));
      console.log(chalk.gray("--------------------------------------------------\n"));

      let activeTip = "Tekan [Tab] saat mengetik '/' atau '\\' untuk memicu autocomplete.";

      // Beautiful status box rendered inline above the prompt line
      const drawStatusBox = () => {
        const cols = Math.min(process.stdout.columns || 80, 80);
        const activeModel = orchestrator.getModel();
        const activeSession = orchestrator.getActiveSession();
        // Title headers
        const titleLeft = ` Workspace: ${chalk.green(activeWorkspace)} | Session: ${chalk.magenta(activeSession)} `;
        const titleRight = ` Model: ${chalk.yellow(activeModel)} `;
        
        // Calculate borders
        const borderChar = "─";
        const topMidLen = cols - titleLeft.length - titleRight.length - 4;
        const topBorder = chalk.hex("#cba6f7")("┌" + titleLeft + borderChar.repeat(Math.max(0, topMidLen)) + titleRight + "┐");
        
        // Tip details
        const tipText = ` 💡 Tips: ${activeTip}`;
        const padSize = Math.max(0, cols - tipText.length - 3);
        const insideLine = chalk.hex("#cba6f7")("│") + chalk.hex("#a6adc8")(tipText) + " ".repeat(padSize) + chalk.hex("#cba6f7")("│");
        
        // Bottom border
        const bottomBorder = chalk.hex("#cba6f7")("└" + borderChar.repeat(cols - 2) + "┘");

        // Print status box directly
        console.log(topBorder);
        console.log(insideLine);
        console.log(bottomBorder);
      };
      
      let chatActive = true;
      const promptStr = `${chalk.bold.hex("#89b4fa")("👤 You")} ${chalk.bold.hex("#f5c2e7")("›")} `;

      while (chatActive) {
        // Draw the status box above the prompt
        drawStatusBox();

        // Create a fresh Readline interface for this turn to avoid stdin contention
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          completer: (line: string) => {
            const cleanLine = line.trimStart();
            const prefix = cleanLine.startsWith("\\") ? "\\" : "/";

            if (!cleanLine.startsWith("/") && !cleanLine.startsWith("\\")) {
              return [[], line];
            }

            const normalizedLine = cleanLine.replace(/\\/g, "/");
            const parts = normalizedLine.split(/\s+/);
            const command = parts[0];

            // 1. Completing the main command itself
            if (parts.length === 1 && !normalizedLine.endsWith(" ")) {
              const completions = [
                "/help",
                "/session ",
                "/session new ",
                "/session load ",
                "/session delete ",
                "/model ",
                "/set-key ",
                "/setup",
                "/tools",
                "/mcp",
                "/add-mcp ",
                "/nodes",
                "/node",
                "/skills",
                "/add-skill ",
                "/facts",
                "/fact ",
                "/scan",
                "/queue",
                "/queue add ",
                "/clear",
                "/cls",
                "/clear-screen",
                "/exit",
                "/quit"
              ];
              
              const hits = completions.filter((c) => {
                const cleanCompName = c.trim();
                if (cleanCompName.startsWith(command)) return true;
                
                const cleanInput = command.slice(1).toLowerCase();
                const cleanComp = cleanCompName.slice(1).toLowerCase();
                
                const compParts = cleanComp.split("-");
                if (compParts.length > 1) {
                  const initials = compParts.map(p => p[0]).join("");
                  if (initials.startsWith(cleanInput)) return true;
                }
                return false;
              });

              const mappedHits = hits.map((h) => h.replace(/^\//, prefix));
              return [mappedHits.length ? mappedHits : completions.map(c => c.replace(/^\//, prefix)), line];
            }

            // 2. Completing sub-arguments for '/model'
            if (command === "/model") {
              const modelCompletions = orchestrator.getModelCompletions();
              const typedArg = parts.slice(1).join(" ");
              const cleanTyped = typedArg.toLowerCase().trim();
              
              let hits = modelCompletions;
              if (cleanTyped) {
                const queryWords = cleanTyped.split(/\s+/);
                hits = modelCompletions.filter((m) => {
                  const lowerM = m.toLowerCase();
                  return queryWords.every(word => lowerM.includes(word));
                });
              }
              
              return [hits, typedArg];
            }

            // 3. Completing sub-arguments for '/set-key'
            if (command === "/set-key") {
              const providerCompletions = [
                "gemini",
                "openai",
                "openrouter",
                "google_client_id",
                "google_client_secret"
              ];

              if (parts.length === 2 && !normalizedLine.endsWith(" ")) {
                const typedArg = parts[1];
                const hits = providerCompletions.filter((p) => p.startsWith(typedArg));
                return [hits, typedArg];
              } else if (parts.length === 1 || (parts.length === 2 && normalizedLine.endsWith(" "))) {
                return [providerCompletions, ""];
              }
            }

            return [[], line];
          }
        });

        const askQuestion = (query: string) => new Promise<string>((resolve) => {
          rl.question(query, (answer) => {
            resolve(answer);
          });
        });

        const answer = await askQuestion(promptStr);
        rl.close(); // Close immediately to release process.stdin for potential prompts

        const msg = answer.trim();

        if (!msg) {
          continue;
        }

        if (msg.toLowerCase() === "exit" || msg.toLowerCase() === "quit" || msg === "/exit" || msg === "/quit" || msg === "\\exit" || msg === "\\quit") {
          chatActive = false;
          console.log(chalk.green("Keluar dari sesi chat. Sampai jumpa!"));
          break;
        }

        if (msg.startsWith("/") || msg.startsWith("\\")) {
          // Normalize backslash to slash for orchestrator execution
          const normalizedMsg = msg.startsWith("\\") ? "/" + msg.slice(1) : msg;
          await orchestrator.handleSlashCommand(normalizedMsg);
        } else {
          // Run the agent loop for this message
          await orchestrator.runTask(msg, true);
        }

        // Display a helpful, random footer tip before the next turn
        const tips = [
          "Jalankan '/tools' untuk melihat daftar alat aktif.",
          "Ketik '/set-key gemini <key>' untuk mengubah API key Gemini secara instan.",
          "Jalankan '/skills' untuk melihat skill kustom yang terdaftar.",
          "Ketik '/model <nama>' untuk mengganti model aktif.",
          "Tekan [Tab] saat mengetik '/' atau '\\' untuk memicu autocomplete."
        ];
        activeTip = tips[Math.floor(Math.random() * tips.length)];
      }
    } catch (err: any) {
      console.error(chalk.red(`\nGagal memulai sesi chat: ${err.message}`));
    } finally {
      await orchestrator.shutdown();
    }
  });

// Command: View Memory Logs
program
  .command("logs")
  .description("Tampilkan log riwayat percakapan")
  .option("-c, --clear", "Hapus riwayat chat")
  .action((options) => {
    const manager = new WorkspaceManager();
    if (!manager.isWorkspace()) {
      console.log(chalk.red("Folder ini bukan workspace Novara OS."));
      return;
    }

    const memory = new MemorySystem(manager.getMemoryDir());
    if (options.clear) {
      memory.clearHistory();
      console.log(chalk.green("Riwayat percakapan berhasil dihapus."));
      return;
    }

    const history = memory.getRecentHistory(50);
    if (history.length === 0) {
      console.log(chalk.yellow("Belum ada riwayat percakapan dalam workspace ini."));
      return;
    }

    console.log(chalk.green("\n=== Riwayat Percakapan (Terbaru) ==="));
    for (const msg of history) {
      const roleColor = msg.role === "user" ? chalk.blue : msg.role === "model" ? chalk.green : chalk.yellow;
      console.log(`[${roleColor(msg.role.toUpperCase())}]: ${msg.content}`);
    }
    console.log("====================================\n");
  });

// If called with no arguments (e.g. just 'nos' or 'novara'), default to 'chat'
if (process.argv.length <= 2) {
  process.argv.push("chat");
}

// Parse commands
program.parse(process.argv);
export { program };
