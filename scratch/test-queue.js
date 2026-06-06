import http from "http";

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log("=== Memulai Uji Coba E2E Task Queue ===");

  try {
    // 1. Cek antrean awal
    console.log("\n1. Mengambil status antrean tugas awal...");
    const initial = await request("http://localhost:8088/v1/tasks");
    console.log("Status awal:", JSON.stringify(initial.body, null, 2));

    // 2. Tambah tugas ke antrean
    console.log("\n2. Mengirim tugas baru ke antrean...");
    const postRes = await request("http://localhost:8088/v1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, {
      query: "Tulis fakta singkat tentang Novara OS ke dalam memori dengan record_fact"
    });
    console.log("Respons tambah tugas:", JSON.stringify(postRes.body, null, 2));
    const taskId = postRes.body.taskId;

    // 3. Polling status tugas sampai selesai
    console.log(`\n3. Memantau status tugas [ID: ${taskId}]...`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await request("http://localhost:8088/v1/tasks");
      const task = statusRes.body.tasks.find(t => t.id === taskId);
      console.log(`[Detik ${(i+1)*3}] Status: ${task.status}`);
      if (task.status === "completed" || task.status === "failed") {
        console.log("\nTugas selesai!");
        console.log("Detail Tugas:", JSON.stringify(task, null, 2));
        break;
      }
    }

  } catch (err) {
    console.error("Gagal uji coba E2E:", err);
  }
}

run();
