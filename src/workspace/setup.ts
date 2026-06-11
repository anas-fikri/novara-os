import prompts from "prompts";
import chalk from "chalk";
import ora from "ora";
import { WorkspaceManager } from "./workspace.js";

export async function runInteractiveSetup(manager: WorkspaceManager): Promise<void> {
  console.log(chalk.green("\n=== Setup Provider Novara OS ==="));
  
  const providerResponse = await prompts({
    type: "select",
    name: "provider",
    message: "Pilih provider LLM yang ingin dikonfigurasi:",
    choices: [
      { title: "Google Gemini", value: "gemini" },
      { title: "OpenAI", value: "openai" },
      { title: "OpenRouter (Global Gateway)", value: "openrouter" },
      { title: "GitHub Copilot (OAuth)", value: "copilot" },
      { title: "Ollama (Lokal)", value: "ollama" },
      { title: "9Router (Lokal Gateway)", value: "9router" },
      { title: "CLIProxy (Proxy)", value: "cliproxy" }
    ]
  });

  if (!providerResponse.provider) {
    console.log(chalk.yellow("Setup dibatalkan."));
    return;
  }

  const provider = providerResponse.provider;

  if (provider === "gemini") {
    const keyResponse = await prompts({
      type: "password",
      name: "value",
      message: "Masukkan GEMINI_API_KEY Anda:"
    });
    if (keyResponse.value) {
      manager.saveSecret("GEMINI_API_KEY", keyResponse.value);
      console.log(chalk.green(`✔ GEMINI_API_KEY berhasil disimpan!`));
    } else {
      console.log(chalk.yellow("Pengaturan kunci dilewati."));
    }
  } else if (provider === "openai") {
    const keyResponse = await prompts({
      type: "password",
      name: "value",
      message: "Masukkan OPENAI_API_KEY Anda:"
    });
    if (keyResponse.value) {
      manager.saveSecret("OPENAI_API_KEY", keyResponse.value);
      console.log(chalk.green(`✔ OPENAI_API_KEY berhasil disimpan!`));
    } else {
      console.log(chalk.yellow("Pengaturan kunci dilewati."));
    }
  } else if (provider === "openrouter") {
    const keyResponse = await prompts({
      type: "password",
      name: "value",
      message: "Masukkan OPENROUTER_API_KEY Anda:"
    });
    if (keyResponse.value) {
      manager.saveSecret("OPENROUTER_API_KEY", keyResponse.value);
      console.log(chalk.green(`✔ OPENROUTER_API_KEY berhasil disimpan!`));
    } else {
      console.log(chalk.yellow("Pengaturan kunci dilewati."));
    }
  } else if (provider === "ollama") {
    const urlResponse = await prompts({
      type: "text",
      name: "value",
      message: "Masukkan OLLAMA_BASE_URL (opsional):",
      initial: "http://localhost:11434/v1"
    });
    if (urlResponse.value) {
      manager.saveSecret("OLLAMA_BASE_URL", urlResponse.value);
      console.log(chalk.green(`✔ OLLAMA_BASE_URL berhasil disimpan!`));
    }
  } else if (provider === "9router") {
    const urlResponse = await prompts({
      type: "text",
      name: "value",
      message: "Masukkan NINEROUTER_BASE_URL:",
      initial: "http://localhost:20128/v1"
    });
    if (urlResponse.value) {
      manager.saveSecret("NINEROUTER_BASE_URL", urlResponse.value);
    }
    const keyResponse = await prompts({
      type: "password",
      name: "value",
      message: "Masukkan NINEROUTER_API_KEY (opsional):",
      initial: "9router"
    });
    if (keyResponse.value) {
      manager.saveSecret("NINEROUTER_API_KEY", keyResponse.value);
    }
    console.log(chalk.green(`✔ 9Router configuration berhasil disimpan!`));
  } else if (provider === "cliproxy") {
    const urlResponse = await prompts({
      type: "text",
      name: "value",
      message: "Masukkan CLIPROXY_BASE_URL:",
      initial: "http://127.0.0.1:8317/v1"
    });
    if (urlResponse.value) {
      manager.saveSecret("CLIPROXY_BASE_URL", urlResponse.value);
    }
    const keyResponse = await prompts({
      type: "password",
      name: "value",
      message: "Masukkan CLIPROXY_API_KEY (opsional):",
      initial: "cliproxy"
    });
    if (keyResponse.value) {
      manager.saveSecret("CLIPROXY_API_KEY", keyResponse.value);
    }
    console.log(chalk.green(`✔ CLIProxy configuration berhasil disimpan!`));
  } else if (provider === "copilot") {
    const { startDeviceFlow } = await import("./oauth.js");
    await startDeviceFlow(manager, provider);
  }

  // Ask to set as default
  const defaultResponse = await prompts({
    type: "confirm",
    name: "value",
    message: "Apakah Anda ingin mengatur provider ini sebagai default untuk workspace?",
    initial: true
  });

  let defaultModel = "";
  if (defaultResponse.value) {
    if (provider === "gemini") {
      const modelResponse = await prompts({
        type: "select",
        name: "value",
        message: "Pilih model Gemini default:",
        choices: [
          { title: "gemini-2.5-flash (Rekomendasi - Cepat & Murah)", value: "gemini/gemini-2.5-flash" },
          { title: "gemini-2.5-pro (Kemampuan Tinggi)", value: "gemini/gemini-2.5-pro" },
          { title: "gemini-1.5-flash", value: "gemini/gemini-1.5-flash" },
          { title: "gemini-1.5-pro", value: "gemini/gemini-1.5-pro" }
        ]
      });
      defaultModel = modelResponse.value || "gemini/gemini-2.5-flash";
    } else if (provider === "openai") {
      const modelResponse = await prompts({
        type: "select",
        name: "value",
        message: "Pilih model OpenAI default:",
        choices: [
          { title: "gpt-4o-mini (Rekomendasi - Ringan & Cepat)", value: "openai/gpt-4o-mini" },
          { title: "gpt-4o (Kemampuan Tinggi)", value: "openai/gpt-4o" },
          { title: "o1-mini (Penalaran Kompleks)", value: "openai/o1-mini" }
        ]
      });
      defaultModel = modelResponse.value || "openai/gpt-4o-mini";
    } else if (provider === "openrouter") {
      let openRouterChoices = [
        { title: "google/gemini-2.5-flash:free (Rekomendasi - Gratis & Cepat)", value: "openrouter/google/gemini-2.5-flash:free" },
        { title: "google/gemini-2.5-flash (Berbayar - Cepat)", value: "openrouter/google/gemini-2.5-flash" },
        { title: "google/gemini-2.5-pro (Kemampuan Tinggi)", value: "openrouter/google/gemini-2.5-pro" },
        { title: "meta-llama/llama-3.3-70b-instruct (Model Open Source Terbaik)", value: "openrouter/meta-llama/llama-3.3-70b-instruct" },
        { title: "anthropic/claude-3.5-sonnet (Penulisan Kode Terbaik)", value: "openrouter/anthropic/claude-3.5-sonnet" },
        { title: "✦ Ketik nama model kustom...", value: "__custom__" }
      ];

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (apiKey) {
        const spinner = ora("Mengambil daftar model OpenRouter aktif...").start();
        try {
          const res = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=tools", {
            headers: { "Authorization": `Bearer ${apiKey}` }
          });
          if (res.ok) {
            const data = await res.json() as any;
            if (data && data.data) {
              const fetchedList = data.data.map((m: any) => ({
                title: `${m.name || m.id} (${m.id})`,
                value: `openrouter/${m.id}`
              }));
              if (fetchedList.length > 0) {
                openRouterChoices = [
                  { title: "google/gemini-2.5-flash:free (Rekomendasi - Gratis & Cepat)", value: "openrouter/google/gemini-2.5-flash:free" },
                  { title: "✦ Ketik nama model kustom...", value: "__custom__" },
                  ...fetchedList
                ];
                spinner.succeed("Berhasil memuat model OpenRouter online!");
              } else {
                spinner.warn("Tidak ada model tool-enabled ditemukan online.");
              }
            } else {
              spinner.fail("Gagal parsing daftar model online.");
            }
          } else {
            spinner.fail("Gagal memanggil API OpenRouter.");
          }
        } catch {
          spinner.fail("Koneksi gagal saat mengambil daftar model.");
        }
      }

      const modelResponse = await prompts({
        type: "autocomplete",
        name: "value",
        message: "Pilih atau cari model OpenRouter default (ketik untuk menyaring):",
        choices: openRouterChoices,
        limit: 10
      });

      if (modelResponse.value === "__custom__") {
        const customResponse = await prompts({
          type: "text",
          name: "value",
          message: "Masukkan ID model OpenRouter kustom (contoh: meta-llama/llama-3-8b-instruct):"
        });
        defaultModel = customResponse.value ? `openrouter/${customResponse.value.trim()}` : "openrouter/google/gemini-2.5-flash:free";
      } else {
        defaultModel = modelResponse.value || "openrouter/google/gemini-2.5-flash:free";
      }
    } else if (provider === "ollama") {
      const modelResponse = await prompts({
        type: "text",
        name: "value",
        message: "Masukkan nama model Ollama (contoh: llama3):",
        initial: "llama3"
      });
      defaultModel = `ollama/${modelResponse.value ? modelResponse.value.trim() : "llama3"}`;
    } else if (provider === "9router") {
      const modelResponse = await prompts({
        type: "text",
        name: "value",
        message: "Masukkan nama model 9Router (contoh: openai/gpt-4o):",
        initial: "openai/gpt-4o"
      });
      defaultModel = `9router/${modelResponse.value ? modelResponse.value.trim() : "openai/gpt-4o"}`;
    } else if (provider === "cliproxy") {
      const modelResponse = await prompts({
        type: "text",
        name: "value",
        message: "Masukkan nama model CLIProxy (contoh: google/gemini-2.5-pro):",
        initial: "google/gemini-2.5-pro"
      });
      defaultModel = `cliproxy/${modelResponse.value ? modelResponse.value.trim() : "google/gemini-2.5-pro"}`;
    } else if (provider === "copilot") {
      const modelResponse = await prompts({
        type: "select",
        name: "value",
        message: "Pilih model GitHub Copilot default:",
        choices: [
          { title: "Copilot GPT-4o", value: "copilot/gpt-4o" },
          { title: "Copilot Claude 3.5 Sonnet", value: "copilot/claude-3.5-sonnet" }
        ]
      });
      defaultModel = modelResponse.value || "copilot/gpt-4o";
    }

    try {
      const config = manager.loadConfig();
      config.provider.default = defaultModel;
      manager.saveConfig(config);
      console.log(chalk.green(`✔ Provider default workspace diubah ke: ${chalk.cyan(defaultModel)}`));
    } catch (e: any) {
      console.log(chalk.red(`Gagal mengubah default model di config: ${e.message}`));
    }
  }

  console.log(chalk.green("✔ Setup provider selesai!\n"));
}
