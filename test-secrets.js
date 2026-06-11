import { WorkspaceManager } from "./dist/workspace/workspace.js";
const mgr = new WorkspaceManager("/Users/anasfikri");
const secrets = mgr.loadSecrets();
console.log(secrets);
