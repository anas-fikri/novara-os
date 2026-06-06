# E2E Testing & Production Deployment Guide

This document explains how to run end-to-end (E2E) testing, package the application for production, distribute it to other machines, and run it in headless or daemonized mode using process managers in production environments.

---

## 1. End-to-End (E2E) Testing

Novara OS comes with an automated testing script that runs a full validation of the core workflows without requiring any user interaction or active external API keys.

The E2E test script validates:
- Non-interactive workspace initialization (`novara init --yes`).
- Encrypted secret storage and retrieval (`novara set-key`).
- Retrieval and rendering of active workspace configurations (`novara workspace`).
- API Server startup and port binding (`novara serve`).
- Task queueing and task lifecycle transitions (`GET /v1/tasks` & `POST /v1/agent/run`).
- Automated cleanup of test directories and background server processes.

### How to Run the Tests:
1. Ensure you are at the project root directory.
2. Run the command:
   ```bash
   npm run test
   ```
3. The script will output the pass/fail status of each step.

---

## 2. Creating a Production Distribution Package (.tgz)

To distribute Novara OS to other machines without copying the development source code, test files, and development dependencies, you can compile and compress it into an npm tarball.

Run the following command on your development machine:
```bash
npm run package
```

This will automatically:
1. Compile the TypeScript files into pure, executable ESM JavaScript under the `dist/` directory.
2. Prepend the executable shebang `#!/usr/bin/env node` to the CLI entry point.
3. Package the artifacts into a compressed npm tarball named `novara-os-X.Y.Z.tgz` (e.g., `novara-os-0.1.0.tgz`).

---

## 3. Installing on Other Machines

Once the tarball `novara-os-0.1.0.tgz` is built, you can copy this file to any target server or machine using `scp`, a USB drive, or any other transfer method.

### Global Installation from Tarball:
Run the following command on the destination machine (ensure Node.js v20+ is installed):
```bash
npm install -g ./novara-os-0.1.0.tgz
```

Once installed, the `novara` and `nos` commands will be available globally in your system path.

To verify the installation:
```bash
novara --version
# or
nos --version
```

---

## 4. Headless & Automated Configurations (CI/CD / Docker)

In headless environments (such as Docker, Kubernetes, CI/CD runners, or minimal Linux VMs), the OS keychain is often unavailable or prompts for interactive permissions, which can break automated scripts.

Novara OS supports bypassing the keyring using the **`NOVARA_MASTER_KEY`** environment variable.

### Setup Instructions:
1. Define your master encryption key:
   ```bash
   export NOVARA_MASTER_KEY="your_secure_master_key_min_32_characters"
   ```
2. Run workspace initialization non-interactively:
   ```bash
   mkdir prod-workspace
   cd prod-workspace
   novara init --name "ProdWorkspace" --yes
   ```
3. Set your required LLM API keys without interactive prompts:
   ```bash
   novara set-key gemini "YOUR_GEMINI_API_KEY"
   ```

---

## 5. Running REST API Server in the Background (PM2)

In production, the REST API Server should run continuously as a daemon to receive and process tasks from the queue. We recommend using **PM2** to manage the background daemon.

### PM2 Setup Steps:
1. Install PM2 globally:
   ```bash
   npm install -g pm2
   ```
2. Start the Novara OS API server inside your workspace:
   ```bash
   pm2 start novara --name "novara-api" -- serve -p 8088
   ```
3. Save the process config so it restarts on system boot:
   ```bash
   pm2 save
   pm2 startup
   ```
4. View the server logs:
   ```bash
   pm2 logs novara-api
   ```
5. Queue new tasks from local cron scripts or other internal services:
   ```bash
   curl -X POST http://localhost:8088/v1/agent/run \
     -H "Content-Type: application/json" \
     -d '{"query": "Run resource scan on the current node"}'
   ```
