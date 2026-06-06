import fs from "fs";
import path from "path";
import yaml from "yaml";
import dotenv from "dotenv";
import { encrypt, decrypt, getOrGenerateMasterKey } from "./security.js";

export interface WorkspaceConfig {
  version: string;
  name: string;
  description?: string;
  provider: {
    default: string;
    fallback?: string;
  };
  mcp_servers?: Array<{
    name: string;
    command: string;
    args?: string[];
  }>;
  nodes?: Array<{
    name: string;
    type: string;
    endpoint?: string;
    host?: string;
    user?: string;
    key_path?: string;
    token_id?: string;
  }>;
  settings?: {
    localization?: {
      primary_language?: string;
      fallback_language?: string;
    };
  };
}

export class WorkspaceManager {
  private currentDir: string;
  private novaraDir: string;
  private configPath: string;
  private encryptedSecretsPath: string;

  constructor(targetDir: string = process.cwd()) {
    let dir = path.resolve(targetDir);
    let found = false;
    
    // Walk up search for .novara directory
    while (true) {
      const novaraDir = path.join(dir, ".novara");
      if (fs.existsSync(novaraDir)) {
        this.currentDir = dir;
        this.novaraDir = novaraDir;
        found = true;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (!found) {
      this.currentDir = path.resolve(targetDir);
      this.novaraDir = path.join(this.currentDir, ".novara");
    }

    this.configPath = path.join(this.novaraDir, "workspace.yaml");
    this.encryptedSecretsPath = path.join(this.novaraDir, "secrets.enc");
  }


  isWorkspace(): boolean {
    return fs.existsSync(this.novaraDir) && fs.existsSync(this.configPath);
  }

  initWorkspace(name: string): WorkspaceConfig {
    if (!fs.existsSync(this.novaraDir)) {
      fs.mkdirSync(this.novaraDir, { recursive: true });
    }

    // Create subdirs
    fs.mkdirSync(path.join(this.novaraDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(this.novaraDir, "knowledge"), { recursive: true });

    const defaultConfig: WorkspaceConfig = {
      version: "1",
      name: name,
      description: `Novara OS Workspace for ${name}`,
      provider: {
        default: "gemini/gemini-2.5-flash",
        fallback: "ollama/llama3"
      },
      mcp_servers: [
        {
          name: "filesystem",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", this.currentDir]
        }
      ],
      settings: {
        localization: {
          primary_language: "id",
          fallback_language: "en"
        }
      }
    };

    fs.writeFileSync(this.configPath, yaml.stringify(defaultConfig), "utf-8");

    if (!fs.existsSync(this.encryptedSecretsPath)) {
      const secretsTemplate = `# Novara Secrets (API Keys & Credentials)
# JANGAN commit file ini ke Git!

# Google Gemini API
GEMINI_API_KEY=

# OpenAI API
OPENAI_API_KEY=

# OpenRouter API (Access Claude, Llama, dll. secara global)
OPENROUTER_API_KEY=

# Local Ollama (default: http://localhost:11434/v1)
OLLAMA_BASE_URL=

# Custom Google OAuth App (Untuk perintah 'novara login')
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
`;
      const masterKey = getOrGenerateMasterKey();
      const encrypted = encrypt(secretsTemplate, masterKey);
      fs.writeFileSync(this.encryptedSecretsPath, encrypted, "utf-8");
    }

    return defaultConfig;
  }

  loadConfig(): WorkspaceConfig {
    if (!this.isWorkspace()) {
      throw new Error(`Directory is not a Novara OS workspace. Run 'novara init' first.`);
    }
    const content = fs.readFileSync(this.configPath, "utf-8");
    return yaml.parse(content) as WorkspaceConfig;
  }

  loadSecrets(): Record<string, string> {
    const secrets: Record<string, string> = {};
    const masterKey = getOrGenerateMasterKey();

    const singularSecrets = path.join(this.novaraDir, "secret.env");
    const pluralSecrets = path.join(this.novaraDir, "secrets.env");
    
    let plainContent = "";
    let plainFileToCleanup = "";

    if (fs.existsSync(singularSecrets)) {
      plainContent = fs.readFileSync(singularSecrets, "utf-8");
      plainFileToCleanup = singularSecrets;
    } else if (fs.existsSync(pluralSecrets)) {
      plainContent = fs.readFileSync(pluralSecrets, "utf-8");
      plainFileToCleanup = pluralSecrets;
    }

    if (plainContent) {
      const encrypted = encrypt(plainContent, masterKey);
      fs.writeFileSync(this.encryptedSecretsPath, encrypted, "utf-8");
      
      try {
        fs.unlinkSync(plainFileToCleanup);
      } catch {
        fs.writeFileSync(plainFileToCleanup, "# Rahasia dipindahkan ke secrets.enc", "utf-8");
      }
    }

    if (fs.existsSync(this.encryptedSecretsPath)) {
      try {
        const encryptedContent = fs.readFileSync(this.encryptedSecretsPath, "utf-8").trim();
        if (encryptedContent) {
          const decrypted = decrypt(encryptedContent, masterKey);
          const parsed = dotenv.parse(decrypted);
          for (const [k, v] of Object.entries(parsed)) {
            process.env[k] = v;
            secrets[k] = v;
          }
        }
      } catch (err: any) {
        console.error(`\nGagal mendekripsi secrets.enc: ${err.message}. Pastikan master key OS Keychain valid.`);
      }
    }

    return secrets;
  }

  saveSecret(key: string, value: string): void {
    const masterKey = getOrGenerateMasterKey();
    let plainContent = "";

    if (fs.existsSync(this.encryptedSecretsPath)) {
      try {
        const encryptedContent = fs.readFileSync(this.encryptedSecretsPath, "utf-8").trim();
        if (encryptedContent) {
          plainContent = decrypt(encryptedContent, masterKey);
        }
      } catch {
        // Ignore and overwrite if decryption fails
      }
    }

    const parsed = dotenv.parse(plainContent);
    parsed[key] = value;

    const newContent = Object.entries(parsed)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const encrypted = encrypt(newContent, masterKey);
    fs.writeFileSync(this.encryptedSecretsPath, encrypted, "utf-8");

    process.env[key] = value;
  }

  getNovaraDir(): string {
    return this.novaraDir;
  }

  getMemoryDir(): string {
    return path.join(this.novaraDir, "memory");
  }

  getKnowledgeDir(): string {
    return path.join(this.novaraDir, "knowledge");
  }

  getWorkspaceDir(): string {
    return this.currentDir;
  }

  saveConfig(config: WorkspaceConfig): void {
    fs.writeFileSync(this.configPath, yaml.stringify(config), "utf-8");
  }

  addMcpServer(name: string, command: string, args: string[]): void {
    const config = this.loadConfig();
    if (!config.mcp_servers) config.mcp_servers = [];
    
    // Check if it already exists, replace it, otherwise push
    const index = config.mcp_servers.findIndex((s) => s.name === name);
    if (index !== -1) {
      config.mcp_servers[index] = { name, command, args };
    } else {
      config.mcp_servers.push({ name, command, args });
    }
    this.saveConfig(config);
  }

  getSkillsDir(): string {
    const dir = path.join(this.novaraDir, "skills");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  createSkill(name: string, description: string): string {
    const skillsDir = this.getSkillsDir();
    const skillPath = path.join(skillsDir, name);
    if (!fs.existsSync(skillPath)) {
      fs.mkdirSync(skillPath, { recursive: true });
    }

    const readmeContent = `# Skill: ${name}\n\nDescription: ${description}\n\n## Instructions\n- Describe the instructions for this skill here.\n`;
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), readmeContent, "utf-8");

    const manifestContent = {
      name,
      description,
      version: "0.1.0",
      permissions: ["filesystem"]
    };
    fs.writeFileSync(path.join(skillPath, "manifest.yaml"), yaml.stringify(manifestContent), "utf-8");

    return skillPath;
  }

  listSkills(): Array<{ name: string; description: string }> {
    const skillsDir = this.getSkillsDir();
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: Array<{ name: string; description: string }> = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const manifestPath = path.join(skillsDir, entry.name, "manifest.yaml");
          if (fs.existsSync(manifestPath)) {
            const content = fs.readFileSync(manifestPath, "utf-8");
            const parsed = yaml.parse(content);
            skills.push({ name: parsed.name, description: parsed.description || "" });
          } else {
            skills.push({ name: entry.name, description: "" });
          }
        } catch {
          skills.push({ name: entry.name, description: "" });
        }
      }
    }
    return skills;
  }

  removeMcpServer(name: string): void {
    const config = this.loadConfig();
    if (config.mcp_servers) {
      config.mcp_servers = config.mcp_servers.filter((s) => s.name !== name);
      this.saveConfig(config);
    }
  }

  deleteSkill(name: string): void {
    const skillsDir = this.getSkillsDir();
    const skillPath = path.join(skillsDir, name);
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true, force: true });
    }
  }
}

