import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 10000;

/**
 * Enkripsi teks dengan master key menggunakan AES-256-GCM.
 */
export function encrypt(text: string, masterKey: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  // Derivasi kunci kuat menggunakan PBKDF2
  const key = crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, "sha512");
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  // Format: salt:iv:authTag:encrypted
  return `${salt.toString("hex")}:${iv.toString("hex")}:${authTag.toString()}:${encrypted}`;
}

/**
 * Dekripsi ciphertext dengan master key menggunakan AES-256-GCM.
 */
export function decrypt(encryptedData: string, masterKey: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 4) {
    throw new Error("Format data enkripsi tidak valid.");
  }
  
  const salt = Buffer.from(parts[0], "hex");
  const iv = Buffer.from(parts[1], "hex");
  const authTag = Buffer.from(parts[2], "hex");
  const encrypted = parts[3];
  
  const key = crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, "sha512");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Mengambil master key dari OS Keychain, atau membuatnya baru jika belum ada.
 */
export function getOrGenerateMasterKey(): string {
  if (process.env.NOVARA_MASTER_KEY) {
    return process.env.NOVARA_MASTER_KEY.trim();
  }
  let key = "";
  
  try {
    if (process.platform === "darwin") {
      key = execSync("security find-generic-password -a 'master-key' -s 'NovaraOS' -w", { stdio: "pipe" }).toString().trim();
    } else if (process.platform === "win32") {
      const homeDir = os.homedir();
      const keyFile = path.join(homeDir, ".novara", "master.key");
      if (fs.existsSync(keyFile)) {
        const cmd = `powershell -Command "$enc = Get-Content '${keyFile}'; $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $enc)); [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)"`;
        key = execSync(cmd, { stdio: "pipe" }).toString().trim();
      }
    } else {
      // Linux
      try {
        key = execSync("secret-tool lookup application NovaraOS account master-key", { stdio: "pipe" }).toString().trim();
      } catch {
        // Fallback if secret-tool not available
      }
    }
  } catch {
    // Key not found or keychain failed
  }
  
  if (key) {
    return key;
  }
  
  // Generate random master key jika tidak ditemukan
  const newKey = crypto.randomBytes(32).toString("hex");
  
  try {
    if (process.platform === "darwin") {
      execSync(`security add-generic-password -a 'master-key' -s 'NovaraOS' -w '${newKey}' -U`, { stdio: "pipe" });
    } else if (process.platform === "win32") {
      const novaraDir = path.join(os.homedir(), ".novara");
      if (!fs.existsSync(novaraDir)) {
        fs.mkdirSync(novaraDir, { recursive: true });
      }
      const keyFile = path.join(novaraDir, "master.key");
      const cmd = `powershell -Command "'${newKey}' | ConvertTo-SecureString | ConvertFrom-SecureString | Out-File '${keyFile}'"`;
      execSync(cmd, { stdio: "pipe" });
    } else {
      // Linux: Coba secret-tool, jika gagal simpan di file lokal ~/.novara/master.key (mode 600)
      try {
        execSync(`echo -n '${newKey}' | secret-tool store --label='Novara OS Master Key' application NovaraOS account master-key`, { stdio: "pipe" });
      } catch {
        const novaraDir = path.join(os.homedir(), ".novara");
        if (!fs.existsSync(novaraDir)) {
          fs.mkdirSync(novaraDir, { recursive: true });
        }
        const keyFile = path.join(novaraDir, "master.key");
        fs.writeFileSync(keyFile, newKey, { encoding: "utf8", mode: 0o600 });
      }
    }
    return newKey;
  } catch {
    // Jika semua penyimpanan gagal, kembalikan key baru di RAM agar runtime tetap berfungsi
    return newKey;
  }
}
