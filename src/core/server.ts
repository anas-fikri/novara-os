import http from "http";
import { CoreOrchestrator } from "./orchestrator.js";
import { WorkspaceManager } from "../workspace/workspace.js";
import chalk from "chalk";

interface QueuedTask {
  id: string;
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  createdAt: Date;
}

export class ApiServer {
  private port: number;
  private queue: QueuedTask[] = [];
  private activeWorkspaceDir: string;
  private isProcessing = false;

  constructor(port = 8088, initialWorkspaceDir = process.cwd()) {
    this.port = port;
    this.activeWorkspaceDir = initialWorkspaceDir;
  }

  public start(): void {
    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "", `http://localhost:${this.port}`);
      
      try {
        // 1. GET /v1/tasks - List task queue
        if (url.pathname === "/v1/tasks" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            workspace: this.activeWorkspaceDir,
            queueSize: this.queue.length,
            tasks: this.queue
          }, null, 2));
          return;
        }

        // 2. POST /v1/workspace/select - Select active workspace
        if (url.pathname === "/v1/workspace/select" && req.method === "POST") {
          const body = await this.readBody(req);
          const { path: targetPath } = JSON.parse(body);
          if (!targetPath) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Parameter 'path' diperlukan." }));
            return;
          }

          const manager = new WorkspaceManager(targetPath);
          if (!manager.isWorkspace()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Direktori '${targetPath}' bukan merupakan workspace Novara OS.` }));
            return;
          }

          this.activeWorkspaceDir = manager.getWorkspaceDir();
          console.log(chalk.green(`\n[Server] Workspace dialihkan ke: ${this.activeWorkspaceDir}`));
          
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, workspace: this.activeWorkspaceDir }));
          return;
        }

        // 3. POST /v1/agent/run - Add task/message to queue
        if (url.pathname === "/v1/agent/run" && req.method === "POST") {
          const body = await this.readBody(req);
          const { query } = JSON.parse(body);
          if (!query) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Parameter 'query' diperlukan." }));
            return;
          }

          const taskId = Math.random().toString(36).substring(2, 9);
          const newTask: QueuedTask = {
            id: taskId,
            query,
            status: "pending",
            createdAt: new Date()
          };

          this.queue.push(newTask);
          console.log(chalk.cyan(`\n[Server] Menerima tugas baru di antrean [ID: ${taskId}]: "${query}"`));

          // Trigger queue processing asynchronously
          this.processQueue();

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            message: "Tugas telah ditambahkan ke dalam antrean (task queue).",
            taskId,
            status: "pending"
          }));
          return;
        }

        // 4. Default 404
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Endpoint tidak ditemukan." }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    server.listen(this.port, () => {
      console.log(chalk.bold.green(`\n🚀 Novara OS API Server berjalan di http://localhost:${this.port}`));
      console.log(chalk.gray("--------------------------------------------------"));
      console.log(`${chalk.bold("Active Workspace:")} ${this.activeWorkspaceDir}`);
      console.log(`${chalk.bold("Endpoints:")}`);
      console.log(`  • ${chalk.yellow("GET  /v1/tasks")}            - Monitor status & antrean tugas`);
      console.log(`  • ${chalk.yellow("POST /v1/workspace/select")} - Ganti workspace aktif`);
      console.log(`  • ${chalk.yellow("POST /v1/agent/run")}        - Kirim tugas/query ke antrean agent`);
      console.log(chalk.gray("--------------------------------------------------\n"));
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (true) {
      const task = this.queue.find(t => t.status === "pending");
      if (!task) break;

      task.status = "running";
      console.log(chalk.yellow(`\n[Queue] Memulai eksekusi tugas [ID: ${task.id}]: "${task.query}"`));

      const orchestrator = new CoreOrchestrator(this.activeWorkspaceDir);
      try {
        await orchestrator.init();
        
        // Capture final model output
        let lastReport = "";
        const originalSave = orchestrator["memorySystem"].saveMessage;
        
        // Intercept saveMessage to catch agent replies
        orchestrator["memorySystem"].saveMessage = (msg) => {
          if (msg.role === "model") {
            lastReport = msg.content;
          }
          originalSave.call(orchestrator["memorySystem"], msg);
        };

        await orchestrator.runTask(task.query, false);
        
        task.status = "completed";
        task.result = lastReport || "Tugas diselesaikan tanpa output laporan.";
        console.log(chalk.green(`\n✔ [Queue] Tugas [ID: ${task.id}] sukses diselesaikan!`));
      } catch (err: any) {
        task.status = "failed";
        task.error = err.message;
        console.error(chalk.red(`\n❌ [Queue] Tugas [ID: ${task.id}] gagal: ${err.message}`));
      } finally {
        await orchestrator.shutdown();
      }
    }

    this.isProcessing = false;
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => resolve(body));
      req.on("error", err => reject(err));
    });
  }
}
