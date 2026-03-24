const API_BASE = typeof window !== "undefined" ? `${window.location.origin}/api` : "/api";

export async function fetchAPI<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
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
