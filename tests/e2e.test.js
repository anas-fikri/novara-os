import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import os from "os";

const TEMP_DIR = path.join(process.cwd(), "temp-workspace-e2e");
const PORT = 8089;
let serverProcess = null;

function cleanup() {
  console.log("\n🧹 Membersihkan sisa workspace uji coba...");
  if (serverProcess) {
    try {
      serverProcess.kill();
      console.log("✔ Server API latar belakang dihentikan.");
    } catch {}
  }
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log("✔ Folder temp-workspace-e2e berhasil dihapus.");
  }
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log("==================================================");
  console.log("🧪 MENJALANKAN UJI COBA END-TO-END (E2E) NOVARA OS");
  console.log("==================================================\n");

  try {
    // 0. Bersihkan jika ada folder sisa sebelumnya
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    // Gunakan environment master key kustom agar tidak memicu prompt keychain OS
    process.env.NOVARA_MASTER_KEY = "testmasterkey_1234567890_testmasterkey";

    const cliPath = path.join(process.cwd(), "dist/index.js");

    // 1. Uji Coba: Inisialisasi Workspace Non-Interaktif
    console.log("1. Menguji 'novara init --yes'...");
    execSync(`node ${cliPath} init --name test-e2e-ws --yes`, {
      cwd: TEMP_DIR,
      env: { ...process.env },
      stdio: "inherit"
    });

    // Verifikasi struktur folder
    const novaraDir = path.join(TEMP_DIR, ".novara");
    const yamlPath = path.join(novaraDir, "workspace.yaml");
    const encPath = path.join(novaraDir, "secrets.enc");

    if (!fs.existsSync(novaraDir)) throw new Error("Folder .novara tidak terbuat!");
    if (!fs.existsSync(yamlPath)) throw new Error("workspace.yaml tidak terbuat!");
    if (!fs.existsSync(encPath)) throw new Error("secrets.enc tidak terbuat!");
    console.log("✔ Struktur workspace valid.");

    // 2. Uji Coba: Info Workspace
    console.log("\n2. Menguji 'novara workspace'...");
    const workspaceInfo = execSync(`node ${cliPath} workspace`, {
      cwd: TEMP_DIR,
      env: { ...process.env },
      encoding: "utf-8"
    });
    console.log(workspaceInfo.trim());
    if (!workspaceInfo.includes("test-e2e-ws")) {
      throw new Error("Info workspace tidak mengembalikan nama yang tepat!");
    }
    console.log("✔ Info workspace valid.");

    // 3. Uji Coba: Set API Key secara terenkripsi
    console.log("\n3. Menguji 'novara set-key'...");
    execSync(`node ${cliPath} set-key gemini dummy_gemini_key_999`, {
      cwd: TEMP_DIR,
      env: { ...process.env },
      stdio: "inherit"
    });
    console.log("✔ Pengesetan kunci berhasil.");

    // 4. Uji Coba: Menjalankan API Server
    console.log(`\n4. Menjalankan REST API Server di port ${PORT}...`);
    serverProcess = spawn("node", [cliPath, "serve", "-p", PORT.toString()], {
      cwd: TEMP_DIR,
      env: { ...process.env },
      stdio: "pipe"
    });

    // Tunggu server melakukan binding port (maksimal 5 detik)
    let serverReady = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const check = await request(`http://localhost:${PORT}/v1/tasks`);
        if (check.status === 200) {
          serverReady = true;
          break;
        }
      } catch {
        // Abaikan error saat port belum siap
      }
    }

    if (!serverReady) {
      throw new Error(`REST API Server gagal menyala di port ${PORT}`);
    }
    console.log("✔ REST API Server aktif.");

    // 5. Uji Coba: Query List Tasks
    console.log("\n5. Membaca antrean tugas awal via GET /v1/tasks...");
    const tasksRes = await request(`http://localhost:${PORT}/v1/tasks`);
    console.log("Status Antrean:", JSON.stringify(tasksRes.body, null, 2));
    if (tasksRes.body.queueSize !== 0) {
      throw new Error("Antrean awal harusnya berukuran 0.");
    }
    console.log("✔ Response antrean awal valid.");

    // 6. Uji Coba: Tambah tugas ke antrean via POST /v1/agent/run
    console.log("\n6. Mengirim tugas baru via POST /v1/agent/run...");
    const taskData = { query: "Tulis ringkasan tentang Novara OS." };
    const postRes = await request(`http://localhost:${PORT}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, taskData);

    console.log("Response Post:", JSON.stringify(postRes.body, null, 2));
    if (postRes.status !== 202 || !postRes.body.taskId) {
      throw new Error("Gagal mendaftarkan tugas ke antrean.");
    }
    const taskId = postRes.body.taskId;
    console.log(`✔ Tugas terdaftar dengan ID: ${taskId}`);

    // 7. Polling status tugas sampai dieksekusi (atau gagal karena API key dummy)
    console.log("\n7. Memantau transisi status tugas...");
    let taskCompletedOrFailed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const checkRes = await request(`http://localhost:${PORT}/v1/tasks`);
      const task = checkRes.body.tasks.find(t => t.id === taskId);
      console.log(`[Detik ${i + 1}] Status: ${task.status}`);
      
      if (task.status === "completed" || task.status === "failed") {
        taskCompletedOrFailed = true;
        console.log(`✔ Tugas selesai dengan status akhir: ${task.status}`);
        if (task.status === "failed") {
          console.log(`Informasi Kegagalan (Sesuai dugaan karena API Key dummy): ${task.error}`);
        } else {
          console.log(`Hasil: ${task.result}`);
        }
        break;
      }
    }

    if (!taskCompletedOrFailed) {
      throw new Error("Tugas menggantung dan tidak merubah status dalam 20 detik.");
    }

    console.log("\n==================================================");
    console.log("🎉 SEMUA UJI COBA E2E SELESAI & BERHASIL DILALUI!");
    console.log("==================================================");
    cleanup();
    process.exit(0);

  } catch (err) {
    console.error("\n❌ UJI COBA E2E GAGAL!");
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

// Daftarkan handler cleanup untuk interupsi proses
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

run();
