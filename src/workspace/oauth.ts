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
