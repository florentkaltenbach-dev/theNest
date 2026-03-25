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
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function login(password: string): Promise<boolean> {
  const data = await fetchAPI<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  setToken(data.token);
  return true;
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
}

export async function getScripts(): Promise<Script[]> {
  const data = await fetchAPI<{ scripts: Script[] }>("/scripts");
  return data.scripts;
}

export async function runScript(script: string, serverIp: string): Promise<{ id: string }> {
  return fetchAPI("/scripts/run", {
    method: "POST",
    body: JSON.stringify({ script, serverIp }),
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

export async function completeSetup(hetznerToken: string, adminPassword: string) {
  return fetchAPI<{ success: boolean }>("/setup/complete", {
    method: "POST",
    body: JSON.stringify({ hetznerToken, adminPassword }),
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

// Accept invite
export async function acceptInvite(token: string, password: string) {
  return fetchAPI<{ token: string; role: string; name: string }>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}
