# Node Management

Novara OS connects workspaces to physical servers, virtual machines, and cloud containers (Nodes).

## Supported Node Types

*   **SSH Node**: Direct command execution on Linux/Windows machines over standard SSH with public-key auth.
*   **Docker Node**: Interaction with container daemons to list, build, start, stop, or inspect containers.
*   **Proxmox Node**: Orchestration of virtual machines and LXC containers via Proxmox REST API.
*   **Kubernetes Node**: Pod and deployment scaling/monitoring via `kubectl` wrapper or API client.

## Node Definition Example (`workspace.yaml`)

```yaml
nodes:
  - name: "app-server-prod"
    type: "ssh"
    host: "10.0.0.50"
    user: "deployer"
    key_path: "~/.ssh/id_rsa_novara"
  - name: "homelab-docker"
    type: "docker"
    host: "ssh://user@192.168.1.200"
```

## Inventory Sync

The agent fetches the node's resource status on-demand (e.g. CPU, RAM, disk space, active docker instances) and uses it as temporary context during node debugging sessions.

## Auto-Discovery & Scan

Novara OS can scan your local machine's disk to automatically discover existing infrastructure nodes:
*   **SSH Hosts Discovery**: Parses `~/.ssh/config` to discover configured SSH hosts, users, and identity keys. Wildcard hosts are automatically filtered out.
*   **Docker Daemon Discovery**: Scans for active Docker Unix sockets or named pipes, runs a check to fetch active containers list, and registers them as Docker Nodes.

These discovered items can be selectively imported either to your current workspace, or partitioned into a new workspace/tenant to preserve context isolation.
