import http from "http";
import url from "url";
import { spawn } from "child_process";
import fs from "fs";
import chalk from "chalk";
import { WorkspaceManager } from "./workspace.js";

export async function startOauthFlow(manager: WorkspaceManager): Promise<void> {
  const port = 8085;
  const redirectUri = `http://localhost:${port}/callback`;
  
  // Load credentials from environment
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log(chalk.red("\n❌ Error: Google OAuth credentials tidak ditemukan!"));
    console.log(`Untuk menggunakan fitur ini, silakan buat 'OAuth Web Application client' di Google Cloud Console.`);
    console.log(`Lalu tambahkan variabel Google Client ID dan Client Secret ke berkas rahasia workspace Anda.`);
    console.log(`Setel Authorized Redirect URI ke: ${chalk.cyan(redirectUri)}`);
    console.log(`\n${chalk.green("Tips Alternatif:")} Anda tidak wajib menggunakan OAuth!`);
    console.log(`Cara termudah adalah dengan mengisi API Key seperti ${chalk.cyan("GEMINI_API_KEY")}, ${chalk.cyan("OPENROUTER_API_KEY")}, atau ${chalk.cyan("OPENAI_API_KEY")} pada workspace Anda.`);
    throw new Error("Missing Google OAuth credentials.");
  }

  const scope = "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;

  console.log(chalk.green("\n=== Google Authentication ==="));
  console.log("Membuka browser untuk melakukan login akun Google...");
  console.log(`Atau buka link berikut di browser Anda:\n${chalk.cyan(authUrl)}\n`);


  // Open browser automatically based on platform
  try {
    if (process.platform === "darwin") {
      spawn("open", [authUrl]);
    } else if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", '""', authUrl]);
    } else {
      spawn("xdg-open", [authUrl]);
    }
  } catch {
    // Ignore if spawn fails, user can copy/paste link
  }


  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || "", true);
      
      if (parsedUrl.pathname === "/callback") {
        const code = parsedUrl.query.code;
        
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #121212; color: #ffffff;">
                <h1 style="color: #4CAF50;">Login Berhasil!</h1>
                <p>Otorisasi Novara OS diterima. Silakan kembali ke terminal Anda.</p>
              </body>
            </html>
          `);
          
          // Store token/code securely
          manager.saveSecret("GOOGLE_OAUTH_CODE", String(code));
          manager.saveSecret("GOOGLE_AUTH_DATE", new Date().toISOString());
          
          console.log(chalk.green("\n✔ Otorisasi berhasil diterima dan disimpan secara terenkripsi!"));
          server.close();
          resolve();
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Otorisasi Gagal</h1>");
          server.close();
          reject(new Error("Otorisasi dibatalkan atau tidak ada code yang diterima."));
        }
      }
    });

    server.listen(port, () => {
      // Server listening
    });
  });
}

// ============================================
// DEVICE CODE FLOW FOR COPILOT & ANTIGRAVITY
// ============================================

export async function startDeviceFlow(manager: WorkspaceManager, provider: "copilot"): Promise<void> {
  if (provider === "copilot") {
    const CLIENT_ID = "01ab8ac9400c4e429b23";
    try {
      console.log(chalk.blue("\n🔄 Memulai autentikasi GitHub Copilot (Device Flow)..."));
      
      const deviceRes = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ client_id: CLIENT_ID, scope: "user:email" })
      });
      
      const deviceData: any = await deviceRes.json();
      if (!deviceData.device_code) {
        throw new Error("Gagal mendapatkan device code dari GitHub.");
      }

      console.log(chalk.bold.yellow(`\n--------------------------------------------------`));
      console.log(chalk.white(`1. Buka URL ini di browser Anda: `) + chalk.cyan.underline(deviceData.verification_uri));
      console.log(chalk.white(`2. Masukkan kode otorisasi berikut: `) + chalk.bold.green(deviceData.user_code));
      console.log(chalk.bold.yellow(`--------------------------------------------------`));
      
      // Salin ke clipboard
      try {
        if (process.platform === "darwin") {
          spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] }).stdin.end(deviceData.user_code);
        } else if (process.platform === "win32") {
          spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"] }).stdin.end(deviceData.user_code);
        } else {
          spawn("xclip", ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"] }).stdin.end(deviceData.user_code);
        }
        console.log(chalk.green("✔ Kode otorisasi otomatis tersalin ke clipboard!"));
      } catch (e) {}

      // Buka browser otomatis
      try {
        if (process.platform === "darwin") {
          spawn("open", [deviceData.verification_uri]);
        } else if (process.platform === "win32") {
          spawn("cmd.exe", ["/c", "start", '""', deviceData.verification_uri]);
        } else {
          spawn("xdg-open", [deviceData.verification_uri]);
        }
      } catch (e) {}

      console.log(chalk.gray(`Menunggu Anda menyelesaikan login di browser... (Timeout: ${deviceData.expires_in} detik)`));

      let tokenData = null;
      let interval = deviceData.interval || 5;
      let timeWaited = 0;
      
      while (timeWaited < deviceData.expires_in) {
        await new Promise(r => setTimeout(r, interval * 1000));
        timeWaited += interval;
        
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceData.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code"
          })
        });

        const data: any = await tokenRes.json();
        if (data.access_token) {
          tokenData = data;
          break;
        } else if (data.error === "authorization_pending") {
          // keep polling
        } else if (data.error === "slow_down") {
          interval += 5;
        } else if (data.error === "expired_token") {
          throw new Error("Sesi login telah kedaluwarsa, silakan ulangi proses login.");
        } else {
          throw new Error(`OAuth error: ${data.error_description || data.error}`);
        }
      }

      if (!tokenData) throw new Error("Timeout saat menunggu otorisasi dari GitHub Copilot.");

      manager.saveSecret("COPILOT_OAUTH_TOKEN", tokenData.access_token);
      console.log(chalk.green("✔ Berhasil login! Access Token GitHub Copilot telah disimpan di Keychain secara aman."));
      
    } catch (err: any) {
      console.error(chalk.red(`\n✖ Gagal login GitHub Copilot: ${err.message}`));
    }
  }
}
