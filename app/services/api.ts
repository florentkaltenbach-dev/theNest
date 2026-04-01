const API_BASE = typeof window !== "undefined" ? `${window.location.origin}/api` : "/api";

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    if (token) localStorage.setItem("nest_token", token);
    else localStorage.removeItem("nest_token");
  }
}

export function getToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") {
    authToken = localStorage.getItem("nest_token");
  }
  return authToken;
}

export function clearToken() {
  setToken(null);
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.detail === "string") return data.detail;
  } catch {}
  return `API error: ${res.status}`;
}

export async function fetchAPI<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts?.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const data = await res.json() as { token: string };
  setToken(data.token);
  return true;
}

export async function getPublicHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json() as Promise<{ status: string; version: string; uptime: number }>;
}

export async function checkAuth(): Promise<boolean> {
  try {
    await fetchAPI("/auth/me");
    return true;
  } catch {
    return false;
  }
}

export interface Server {
  id: number;
  name: string;
  status: string;
  ip: string;
  ipv6: string;
  type: string;
  typeDescription: string;
  cores: number;
  memory: number;
  disk: number;
  location: string;
  datacenter: string;
  image: string;
  created: string;
  inTraffic: number | null;
  outTraffic: number | null;
  includedTraffic: number;
  rescue: boolean;
  backups: boolean;
  labels: Record<string, string>;
}

export async function getServers(): Promise<Server[]> {
  const data = await fetchAPI<{ servers: Server[] }>("/servers");
  return data.servers;
}

export async function getServer(id: number): Promise<{ server: Server; metrics: any }> {
  return fetchAPI(`/servers/${id}`);
}

export async function getHealth() {
  return fetchAPI<{ status: string; version: string; uptime: number }>("/health");
}

export interface Script {
  path: string;
  name: string;
  description: string | null;
  author: string | null;
  target: "remote" | "local" | "any";
  args: string | null;
  dangerous: boolean;
  lines: number;
  modified: string;
  sources: string[];
  hasArgs: boolean;
  repo: string | null;
}

export async function getScripts(): Promise<Script[]> {
  const data = await fetchAPI<{ scripts: Script[] }>("/scripts");
  return data.scripts;
}

export async function getScriptContent(path: string, repo?: string | null) {
  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  return fetchAPI<{ path: string; content: string; repo: string | null }>(`/scripts/view/${path}${qs}`);
}

export async function runScript(script: string, serverIp: string, repo?: string | null): Promise<{ id: string }> {
  return fetchAPI("/scripts/run", {
    method: "POST",
    body: JSON.stringify({ script, serverIp, repo: repo || undefined }),
  });
}

export interface ScriptRun {
  id: string;
  script: string;
  server: string;
  status: "running" | "completed" | "failed";
  output: string[];
  outputOffset: number;
  totalLines: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export async function getScriptRun(id: string, since = 0): Promise<ScriptRun> {
  return fetchAPI(`/scripts/runs/${id}?since=${since}`);
}

export async function getScriptRuns(): Promise<any[]> {
  const data = await fetchAPI<{ runs: any[] }>("/scripts/runs");
  return data.runs;
}

// Chat
export async function sendChat(message: string) {
  return fetchAPI<{ userMessage: any; assistantMessage: any }>("/chat/send", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function getChatHistory() {
  return fetchAPI<{ messages: any[] }>("/chat/history");
}

// Secrets
export async function getSecrets() {
  return fetchAPI<{ secrets: any[] }>("/secrets");
}

export async function setSecret(key: string, value: string) {
  return fetchAPI("/secrets", { method: "POST", body: JSON.stringify({ key, value }) });
}

export async function deleteSecret(key: string) {
  return fetchAPI(`/secrets/${key}`, { method: "DELETE" });
}

// Appendages
export async function getAppendages() {
  return fetchAPI<{ appendages: any[] }>("/appendages");
}

export async function installAppendage(appendageId: string, hostname: string) {
  return fetchAPI<any>("/appendages/install", {
    method: "POST",
    body: JSON.stringify({ appendageId, hostname }),
  });
}

// Users
export async function getUsers() {
  return fetchAPI<{ users: any[] }>("/auth/users");
}

export async function inviteUser(name: string, password: string) {
  return fetchAPI<any>("/auth/invite", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });
}

export async function deleteUser(id: string) {
  return fetchAPI(`/auth/users/${id}`, { method: "DELETE" });
}

// Setup / Onboarding
export async function getSetupStatus() {
  return fetchAPI<{ needsSetup: boolean }>("/setup/status");
}

export async function completeSetup(hetznerToken: string, adminPassword: string, gitName?: string, gitEmail?: string) {
  return fetchAPI<{ success: boolean }>("/setup/complete", {
    method: "POST",
    body: JSON.stringify({ hetznerToken, adminPassword, gitName: gitName || undefined, gitEmail: gitEmail || undefined }),
  });
}

// Server actions
export async function serverAction(serverId: number, action: string) {
  return fetchAPI<any>(`/servers/${serverId}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

// Roadmap
export async function getRoadmap() {
  return fetchAPI<{ content: string }>('/roadmap');
}

export interface ArtifactEntry {
  path: string;
  name: string;
  ext: string;
  kind: "text" | "image";
  size: number;
  modified: string;
}

export interface ArtifactView {
  path: string;
  kind: "text" | "image";
  ext: string;
  size: number;
  modified: string;
  content?: string;
  mime?: string;
  contentBase64?: string;
}

export async function getArtifacts() {
  return fetchAPI<{ root: string; artifacts: ArtifactEntry[] }>("/artifacts");
}

export async function getArtifactContent(path: string) {
  return fetchAPI<ArtifactView>(`/artifacts/view/${path}`);
}

// Accept invite
export async function acceptInvite(token: string, password: string) {
  return fetchAPI<{ token: string; role: string; name: string }>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

// API Tokens
export async function getTokens() {
  return fetchAPI<{ tokens: any[] }>("/auth/tokens");
}

export async function createToken(name: string) {
  return fetchAPI<{ id: string; name: string; token: string }>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteToken(id: string) {
  return fetchAPI<{ success: boolean }>(`/auth/tokens/${id}`, {
    method: "DELETE",
  });
}

// Token Limits
export async function getTokenLimits() {
  return fetchAPI<any>("/tokens/limits");
}

export async function getTokenWaste() {
  return fetchAPI<any>("/tokens/waste");
}

export async function getCodexStatus() {
  return fetchAPI<any>("/tokens/codex/status");
}

// Projects
export async function getProjects() {
  return fetchAPI<{ projects: any[] }>("/projects");
}

export async function discoverProjects() {
  return fetchAPI<{ status: string; agentsSent: number }>("/projects/discover", {
    method: "POST",
  });
}

export async function cloneRepo(url: string, name: string, hostname?: string) {
  return fetchAPI<{ status: string; requestId: string; hostname: string }>("/projects/clone", {
    method: "POST",
    body: JSON.stringify({ url, name, hostname }),
  });
}

export async function registerProject(host: string, path: string, branch?: string, commit?: string) {
  return fetchAPI<{ success: boolean }>("/projects/register", {
    method: "POST",
    body: JSON.stringify({ host, path, branch, commit }),
  });
}

// Sessions
export async function getSessions() {
  return fetchAPI<{ sessions: any[] }>("/sessions");
}

export async function createSession(name: string, cmd?: string) {
  return fetchAPI<{ name: string; status: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ name, cmd }),
  });
}

export async function deleteSession(name: string) {
  return fetchAPI<{ success: boolean }>(`/sessions/${name}`, {
    method: "DELETE",
  });
}

// Tasks
export async function getTasks() {
  return fetchAPI<{ tasks: any[] }>("/tasks");
}

export async function dispatchTask(prompt: string, project?: string) {
  return fetchAPI<{ id: string; status: string }>("/tasks", {
    method: "POST",
    body: JSON.stringify({ prompt, project }),
  });
}

// Server metrics with period
export async function getServerMetrics(id: number, type = "cpu,disk,network", period = "1h") {
  return fetchAPI<any>(`/servers/${id}/metrics?type=${type}&period=${period}`);
}

// Console (VNC)
export async function requestConsole(id: number) {
  return fetchAPI<{ wss_url: string; password: string }>(`/servers/${id}/console`, { method: "POST" });
}

// Rescue mode
export async function enableRescue(id: number) {
  return fetchAPI<{ root_password: string }>(`/servers/${id}/rescue`, { method: "POST" });
}

export async function disableRescue(id: number) {
  return fetchAPI<any>(`/servers/${id}/rescue`, { method: "DELETE" });
}

// Rebuild
export async function rebuildServer(id: number, image: string) {
  return fetchAPI<{ root_password: string }>(`/servers/${id}/rebuild`, {
    method: "POST",
    body: JSON.stringify({ image }),
  });
}

// Resize
export async function resizeServer(id: number, serverType: string, upgradeDisk = true) {
  return fetchAPI<any>(`/servers/${id}/resize`, {
    method: "PUT",
    body: JSON.stringify({ server_type: serverType, upgrade_disk: upgradeDisk }),
  });
}

// Reverse DNS
export async function setReverseDNS(id: number, ip: string, dnsPtr: string) {
  return fetchAPI<any>(`/servers/${id}/rdns`, {
    method: "PUT",
    body: JSON.stringify({ ip, dns_ptr: dnsPtr }),
  });
}

// Backups
export async function enableBackups(id: number) {
  return fetchAPI<any>(`/servers/${id}/backups`, { method: "POST" });
}

export async function disableBackups(id: number) {
  return fetchAPI<any>(`/servers/${id}/backups`, { method: "DELETE" });
}

// ISO
export async function attachISO(id: number, iso: string) {
  return fetchAPI<any>(`/servers/${id}/iso`, { method: "POST", body: JSON.stringify({ iso }) });
}

export async function detachISO(id: number) {
  return fetchAPI<any>(`/servers/${id}/iso`, { method: "DELETE" });
}

// Snapshots
export async function getServerSnapshots(id: number) {
  return fetchAPI<{ snapshots: any[] }>(`/servers/${id}/snapshots`);
}

export async function createSnapshot(id: number, description: string) {
  return fetchAPI<any>(`/servers/${id}/snapshot`, {
    method: "POST",
    body: JSON.stringify({ description }),
  });
}

export async function deleteSnapshot(id: number) {
  return fetchAPI<any>(`/snapshots/${id}`, { method: "DELETE" });
}

// Firewalls
export async function getFirewalls() {
  return fetchAPI<{ firewalls: any[] }>("/firewalls");
}

export async function applyFirewall(serverId: number, firewallId: number) {
  return fetchAPI<any>(`/servers/${serverId}/firewall`, {
    method: "POST",
    body: JSON.stringify({ firewall_id: firewallId }),
  });
}

export async function removeFirewall(serverId: number, firewallId: number) {
  return fetchAPI<any>(`/servers/${serverId}/firewall/${firewallId}`, { method: "DELETE" });
}

// Volumes
export async function getVolumes() {
  return fetchAPI<{ volumes: any[] }>("/volumes");
}

export async function attachVolume(serverId: number, volumeId: number) {
  return fetchAPI<any>(`/servers/${serverId}/volume/attach`, {
    method: "POST",
    body: JSON.stringify({ volume_id: volumeId }),
  });
}

export async function detachVolume(volumeId: number) {
  return fetchAPI<any>(`/volumes/${volumeId}/detach`, { method: "POST" });
}

export async function resizeVolume(volumeId: number, size: number) {
  return fetchAPI<any>(`/volumes/${volumeId}/resize`, {
    method: "POST",
    body: JSON.stringify({ size }),
  });
}

// Server types (for resize)
export async function getServerTypes() {
  return fetchAPI<{ server_types: any[] }>("/server-types");
}

// Images (for rebuild)
export async function getImages() {
  return fetchAPI<{ images: any[] }>("/images");
}

// ISOs
export async function getISOs() {
  return fetchAPI<{ isos: any[] }>("/isos");
}

// Update server (name, labels)
export async function updateServer(id: number, data: { name?: string; labels?: Record<string, string> }) {
  return fetchAPI<any>(`/servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Delete server
export async function deleteServer(id: number) {
  return fetchAPI<any>(`/servers/${id}`, { method: "DELETE" });
}

// Create server
export async function createServer(data: {
  name: string;
  server_type: string;
  image: string;
  location?: string;
  ssh_keys?: number[];
  user_data?: string;
  labels?: Record<string, string>;
}) {
  return fetchAPI<any>("/servers", { method: "POST", body: JSON.stringify(data) });
}

// Protection
export async function setProtection(id: number, deleteProtect: boolean, rebuildProtect: boolean) {
  return fetchAPI<any>(`/servers/${id}/protection`, {
    method: "PUT",
    body: JSON.stringify({ delete: deleteProtect, rebuild: rebuildProtect }),
  });
}
