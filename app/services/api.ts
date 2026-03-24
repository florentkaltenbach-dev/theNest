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
  type: string;
  cores: number;
  memory: number;
  disk: number;
  location: string;
  image: string;
  created: string;
}

export async function getServers(): Promise<Server[]> {
  const data = await fetchAPI<{ servers: Server[] }>("/servers");
  return data.servers;
}

export async function getHealth() {
  return fetchAPI<{ status: string; version: string; uptime: number }>("/health");
}
