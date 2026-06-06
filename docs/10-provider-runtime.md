# Provider Runtime

The Provider Runtime wraps communication with external Large Language Models (LLM APIs) using a unified format.

## Supported Providers

Novara OS supports multiple model providers dynamically by parsing the provider identifier prefix in the model name (e.g. `provider_prefix/model_name`):

1.  **Google Gemini (`gemini/`)**: Uses the official Google GenAI SDK. Requires `GEMINI_API_KEY` in `secrets.env`.
2.  **OpenRouter (`openrouter/`)**: Connects to the OpenRouter API endpoint (`https://openrouter.ai/api/v1`) using standard OpenAI schemas. Allows access to Claude, GPT-4, DeepSeek, Llama, etc. Requires `OPENROUTER_API_KEY`.
3.  **OpenAI (`openai/`)**: Connects to the official OpenAI API endpoint. Requires `OPENAI_API_KEY`.
4.  **Ollama (`ollama/`)**: Connects to local Ollama API instances. Defaults to `http://localhost:11434/v1` or respects `OLLAMA_BASE_URL` in `secrets.env`.

## Dynamic Provider Resolution

The `LLMProvider` class resolves the provider prefix dynamically at runtime, allowing users to switch models on-the-fly (e.g. via the `/model` slash command) without restarting active MCP servers:

```typescript
// Example configuration in workspace.yaml
provider:
  default: "gemini/gemini-1.5-flash"  # Switches dynamically based on prefix
```

All non-Gemini providers map tool calls and chat histories to standard CJS/OpenAI schema formats automatically, maintaining full compatibility with MCP tools.

