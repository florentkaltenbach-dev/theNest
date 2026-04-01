import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import {
  getServer,
  Server,
  serverAction,
  getServerSnapshots,
  createSnapshot,
  deleteSnapshot,
  getFirewalls,
  applyFirewall,
  removeFirewall,
  getVolumes,
  attachVolume,
  detachVolume,
  enableRescue,
  disableRescue,
  enableBackups,
  disableBackups,
  rebuildServer,
  resizeServer,
  setReverseDNS,
  requestConsole,
  attachISO,
  detachISO,
  getServerTypes,
  getImages,
  getISOs,
  updateServer,
  deleteServer,
  setProtection,
  getServerMetrics,
} from "../../services/api";
import { connectWs, onWsMessage, sendWsCommand } from "../../services/ws";

// ── Helpers ────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let b = bytes;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function barColor(p: number): string {
  if (p > 80) return "#ef4444";
  if (p > 60) return "#eab308";
  return "#22c55e";
}

// ── Reusable UI components ────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = status === "running" ? "#22c55e" : status === "off" ? "#ef4444" : "#eab308";
  return (
    <View style={[styles.badge, { backgroundColor: color + "20", borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Btn({ label, color, onPress, loading, small, disabled }: {
  label: string; color?: string; onPress: () => void; loading?: boolean; small?: boolean; disabled?: boolean;
}) {
  const c = color || "#1a1a2e";
  return (
    <Pressable
      style={[styles.btn, { borderColor: c, opacity: disabled ? 0.4 : 1 }, small && styles.btnSmall]}
      onPress={disabled ? undefined : onPress}
    >
      <Text style={[styles.btnText, { color: c }, small && { fontSize: 11 }]}>
        {loading ? "..." : label}
      </Text>
    </Pressable>
  );
}

function ConfirmBtn({ label, color, onPress, confirmLabel }: {
  label: string; color?: string; onPress: () => void; confirmLabel?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  return confirming ? (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Btn label={confirmLabel || "Confirm"} color={color || "#ef4444"} onPress={async () => {
        setLoading(true);
        await onPress();
        setLoading(false);
        setConfirming(false);
      }} loading={loading} small />
      <Btn label="Cancel" color="#999" onPress={() => setConfirming(false)} small />
    </View>
  ) : (
    <Btn label={label} color={color} onPress={() => setConfirming(true)} />
  );
}

// ── Panel: collapsible nested control window ──────────

function Panel({ title, icon, children, badge, defaultOpen }: {
  title: string; icon: string; children: React.ReactNode; badge?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <View style={styles.panel}>
      <Pressable style={styles.panelHeader} onPress={() => setOpen(!open)}>
        <Text style={styles.panelIcon}>{icon}</Text>
        <Text style={styles.panelTitle}>{title}</Text>
        {badge && (
          <View style={styles.panelBadge}>
            <Text style={styles.panelBadgeText}>{badge}</Text>
          </View>
        )}
        <Text style={styles.panelChevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && <View style={styles.panelBody}>{children}</View>}
    </View>
  );
}

// ── Inline picker ─────────────────────────────────────

function InlinePicker({ items, selected, onSelect, labelKey, valueKey }: {
  items: any[]; selected: string; onSelect: (v: string) => void; labelKey: string; valueKey: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
      {items.map((item) => {
        const val = item[valueKey]?.toString() ?? item[valueKey];
        const active = val === selected;
        return (
          <Pressable
            key={val}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(val)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {item[labelKey]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Sub-panels (each loads its own data on mount) ─────

function SnapshotsPanel({ serverId }: { serverId: number }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [desc, setDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await getServerSnapshots(serverId); setSnapshots(d.snapshots); } catch {}
    setLoading(false);
  }, [serverId]);

  useEffect(() => { load(); }, [load]);

  return (
    <View>
      <View style={styles.panelRow}>
        <TextInput
          style={styles.input}
          placeholder="Snapshot description..."
          placeholderTextColor="#999"
          value={desc}
          onChangeText={setDesc}
        />
        <Btn label="Create" color="#3b82f6" loading={creating} onPress={async () => {
          setCreating(true);
          try { await createSnapshot(serverId, desc || `snapshot-${Date.now()}`); setDesc(""); await load(); } catch {}
          setCreating(false);
        }} small />
      </View>
      {loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
        snapshots.length === 0 ? <Text style={styles.muted}>No snapshots</Text> : (
          snapshots.map((snap: any) => (
            <View key={snap.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{snap.description || `Snapshot #${snap.id}`}</Text>
                <Text style={styles.muted}>{formatDate(snap.created)} · {(snap.image_size || 0).toFixed(1)} GB</Text>
              </View>
              <ConfirmBtn label="Delete" color="#ef4444" onPress={async () => {
                await deleteSnapshot(snap.id); await load();
              }} />
            </View>
          ))
        )
      )}
    </View>
  );
}

function FirewallsPanel({ serverId }: { serverId: number }) {
  const [firewalls, setFirewalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const d = await getFirewalls(); setFirewalls(d.firewalls); } catch {}
      setLoading(false);
    })();
  }, []);

  const isApplied = (fw: any) =>
    fw.applied_to?.some((a: any) => a.type === "server" && a.server?.id === serverId);

  return loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
    <View>
      {firewalls.length === 0 ? <Text style={styles.muted}>No firewalls configured</Text> : (
        firewalls.map((fw: any) => {
          const applied = isApplied(fw);
          return (
            <View key={fw.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{fw.name}</Text>
                <Text style={styles.muted}>
                  {fw.rules?.length || 0} rules · {applied ? "Applied" : "Not applied"}
                </Text>
                {fw.rules?.map((r: any, i: number) => (
                  <Text key={i} style={styles.ruleText}>
                    {r.direction} {r.protocol} {r.port || "*"} → {r.source_ips?.join(", ") || r.destination_ips?.join(", ") || "any"}
                  </Text>
                ))}
              </View>
              {applied ? (
                <ConfirmBtn label="Remove" color="#ef4444" onPress={async () => {
                  await removeFirewall(serverId, fw.id);
                  const d = await getFirewalls(); setFirewalls(d.firewalls);
                }} />
              ) : (
                <Btn label="Apply" color="#22c55e" onPress={async () => {
                  await applyFirewall(serverId, fw.id);
                  const d = await getFirewalls(); setFirewalls(d.firewalls);
                }} small />
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function VolumesPanel({ serverId }: { serverId: number }) {
  const [volumes, setVolumes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await getVolumes(); setVolumes(d.volumes); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
    <View>
      {volumes.length === 0 ? <Text style={styles.muted}>No volumes</Text> : (
        volumes.map((vol: any) => {
          const attached = vol.server === serverId;
          const attachedElsewhere = vol.server && vol.server !== serverId;
          return (
            <View key={vol.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{vol.name}</Text>
                <Text style={styles.muted}>
                  {vol.size} GB · {vol.format || "ext4"} · {vol.location?.name || ""}
                  {attached ? " · Attached" : attachedElsewhere ? ` · On server #${vol.server}` : " · Detached"}
                </Text>
              </View>
              {attached ? (
                <Btn label="Detach" color="#eab308" onPress={async () => {
                  await detachVolume(vol.id); await load();
                }} small />
              ) : !attachedElsewhere ? (
                <Btn label="Attach" color="#22c55e" onPress={async () => {
                  await attachVolume(serverId, vol.id); await load();
                }} small />
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

function NetworkingPanel({ server }: { server: Server }) {
  const [rdns, setRdns] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <View>
      <InfoRow label="IPv4" value={server.ip} />
      <InfoRow label="IPv6" value={server.ipv6?.split("/")[0] || "—"} />
      <InfoRow label="Datacenter" value={server.datacenter} />
      <View style={{ marginTop: 12 }}>
        <Text style={styles.subLabel}>Reverse DNS (PTR) for {server.ip}</Text>
        <View style={styles.panelRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. myserver.example.com"
            placeholderTextColor="#999"
            value={rdns}
            onChangeText={setRdns}
          />
          <Btn label={saved ? "Saved" : "Set"} color={saved ? "#22c55e" : "#3b82f6"} loading={saving} onPress={async () => {
            setSaving(true);
            try { await setReverseDNS(server.id, server.ip, rdns); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch {}
            setSaving(false);
          }} small />
        </View>
      </View>
    </View>
  );
}

function RescuePanel({ server, onRefresh }: { server: Server; onRefresh: () => void }) {
  const [rootPw, setRootPw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <View>
      <InfoRow label="Rescue Mode" value={server.rescue ? "Active" : "Off"} />
      <Text style={styles.muted}>
        Rescue mode boots a temporary Linux system for recovery. Server must be rebooted after enabling.
      </Text>
      {rootPw && (
        <View style={styles.pwBox}>
          <Text style={styles.pwLabel}>Root Password (copy now!)</Text>
          <Text style={styles.pwValue} selectable>{rootPw}</Text>
        </View>
      )}
      <View style={[styles.panelRow, { marginTop: 8 }]}>
        {server.rescue ? (
          <Btn label="Disable Rescue" color="#ef4444" loading={loading} onPress={async () => {
            setLoading(true);
            try { await disableRescue(server.id); onRefresh(); } catch {}
            setLoading(false);
          }} />
        ) : (
          <Btn label="Enable Rescue" color="#eab308" loading={loading} onPress={async () => {
            setLoading(true);
            try { const d = await enableRescue(server.id); setRootPw(d.root_password); onRefresh(); } catch {}
            setLoading(false);
          }} />
        )}
      </View>
    </View>
  );
}

function BackupsPanel({ server, onRefresh }: { server: Server; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);

  return (
    <View>
      <InfoRow label="Backups" value={server.backups ? "Enabled" : "Disabled"} />
      <Text style={styles.muted}>
        Automatic daily backups. Pricing: 20% of server cost/month.
      </Text>
      <View style={[styles.panelRow, { marginTop: 8 }]}>
        {server.backups ? (
          <ConfirmBtn label="Disable Backups" color="#ef4444" onPress={async () => {
            setLoading(true);
            try { await disableBackups(server.id); onRefresh(); } catch {}
            setLoading(false);
          }} />
        ) : (
          <Btn label="Enable Backups" color="#22c55e" loading={loading} onPress={async () => {
            setLoading(true);
            try { await enableBackups(server.id); onRefresh(); } catch {}
            setLoading(false);
          }} />
        )}
      </View>
    </View>
  );
}

function RebuildPanel({ serverId }: { serverId: number }) {
  const [images, setImages] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [rootPw, setRootPw] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { const d = await getImages(); setImages(d.images); } catch {}
      setLoading(false);
    })();
  }, []);

  return loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
    <View>
      <Text style={styles.muted}>Reinstall the server with a fresh image. All data will be lost.</Text>
      <Text style={styles.subLabel}>Select Image</Text>
      <InlinePicker
        items={images.map((img: any) => ({ label: img.description || img.name, value: img.id.toString() }))}
        selected={selected}
        onSelect={setSelected}
        labelKey="label"
        valueKey="value"
      />
      {rootPw && (
        <View style={styles.pwBox}>
          <Text style={styles.pwLabel}>Root Password (copy now!)</Text>
          <Text style={styles.pwValue} selectable>{rootPw}</Text>
        </View>
      )}
      <ConfirmBtn
        label={`Rebuild${selected ? "" : " (select image)"}`}
        color="#ef4444"
        confirmLabel="Yes, destroy all data"
        onPress={async () => {
          if (!selected) return;
          try { const d = await rebuildServer(serverId, selected); setRootPw(d.root_password); } catch {}
        }}
      />
    </View>
  );
}

function ResizePanel({ server }: { server: Server }) {
  const [types, setTypes] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [resizing, setResizing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try { const d = await getServerTypes(); setTypes(d.server_types); } catch {}
      setLoading(false);
    })();
  }, []);

  return loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
    <View>
      <InfoRow label="Current Type" value={`${server.typeDescription || server.type}`} />
      <Text style={styles.muted}>Server must be powered off to resize. Disk upgrades are irreversible.</Text>
      <Text style={styles.subLabel}>Select New Type</Text>
      <InlinePicker
        items={types.map((t: any) => ({
          label: `${t.name} (${t.cores}c/${t.memory}GB/${t.disk}GB)`,
          value: t.name,
        }))}
        selected={selected}
        onSelect={setSelected}
        labelKey="label"
        valueKey="value"
      />
      {done && <Text style={[styles.muted, { color: "#22c55e" }]}>Resize initiated</Text>}
      <ConfirmBtn
        label={`Resize${selected ? ` to ${selected}` : " (select type)"}`}
        color="#eab308"
        onPress={async () => {
          if (!selected) return;
          setResizing(true);
          try { await resizeServer(server.id, selected, true); setDone(true); } catch {}
          setResizing(false);
        }}
      />
    </View>
  );
}

function ISOPanel({ serverId }: { serverId: number }) {
  const [isos, setIsos] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    (async () => {
      try { const d = await getISOs(); setIsos(d.isos); } catch {}
      setLoading(false);
    })();
  }, []);

  return loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : (
    <View>
      <Text style={styles.muted}>Mount an ISO to boot from. Useful for custom OS installs.</Text>
      <InlinePicker
        items={isos.slice(0, 50).map((iso: any) => ({
          label: iso.description || iso.name,
          value: iso.id.toString(),
        }))}
        selected={selected}
        onSelect={setSelected}
        labelKey="label"
        valueKey="value"
      />
      <View style={styles.panelRow}>
        <Btn label="Attach ISO" color="#3b82f6" loading={attaching} disabled={!selected} onPress={async () => {
          setAttaching(true);
          try { await attachISO(serverId, selected); } catch {}
          setAttaching(false);
        }} small />
        <Btn label="Detach ISO" color="#ef4444" onPress={async () => {
          try { await detachISO(serverId); } catch {}
        }} small />
      </View>
    </View>
  );
}

function ConsolePanel({ serverId }: { serverId: number }) {
  const [console, setConsole] = useState<{ wss_url: string; password: string } | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <View>
      <Text style={styles.muted}>Request a VNC console session. Opens a websocket connection.</Text>
      {console && (
        <View style={styles.pwBox}>
          <Text style={styles.pwLabel}>VNC WebSocket URL</Text>
          <Text style={styles.pwValue} selectable numberOfLines={2}>{console.wss_url}</Text>
          <Text style={[styles.pwLabel, { marginTop: 8 }]}>Password</Text>
          <Text style={styles.pwValue} selectable>{console.password}</Text>
        </View>
      )}
      <Btn label="Request Console" color="#3b82f6" loading={loading} onPress={async () => {
        setLoading(true);
        try { const d = await requestConsole(serverId); setConsole(d); } catch {}
        setLoading(false);
      }} />
    </View>
  );
}

function ProtectionPanel({ server, onRefresh }: { server: Server; onRefresh: () => void }) {
  const [delProt, setDelProt] = useState(false);
  const [rebProt, setRebProt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <View>
      <Text style={styles.muted}>Prevent accidental deletion or rebuild of this server.</Text>
      <Pressable style={styles.toggleRow} onPress={() => setDelProt(!delProt)}>
        <View style={[styles.toggle, delProt && styles.toggleOn]}>
          <View style={[styles.toggleKnob, delProt && styles.toggleKnobOn]} />
        </View>
        <Text style={styles.toggleLabel}>Delete Protection</Text>
      </Pressable>
      <Pressable style={styles.toggleRow} onPress={() => setRebProt(!rebProt)}>
        <View style={[styles.toggle, rebProt && styles.toggleOn]}>
          <View style={[styles.toggleKnob, rebProt && styles.toggleKnobOn]} />
        </View>
        <Text style={styles.toggleLabel}>Rebuild Protection</Text>
      </Pressable>
      <Btn label={saved ? "Saved" : "Save Protection"} color={saved ? "#22c55e" : "#3b82f6"} loading={saving} onPress={async () => {
        setSaving(true);
        try { await setProtection(server.id, delProt, rebProt); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch {}
        setSaving(false);
      }} />
    </View>
  );
}

function LabelsPanel({ server, onRefresh }: { server: Server; onRefresh: () => void }) {
  const [labels, setLabels] = useState<Record<string, string>>(server.labels || {});
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <View>
      {Object.entries(labels).map(([k, v]) => (
        <View key={k} style={styles.listItem}>
          <Text style={styles.listItemTitle}>{k}</Text>
          <Text style={styles.muted}>{v}</Text>
          <Pressable onPress={() => {
            const next = { ...labels };
            delete next[k];
            setLabels(next);
          }}>
            <Text style={{ color: "#ef4444", fontSize: 14 }}>×</Text>
          </Pressable>
        </View>
      ))}
      <View style={[styles.panelRow, { marginTop: 8 }]}>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="key" placeholderTextColor="#999" value={newKey} onChangeText={setNewKey} />
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="value" placeholderTextColor="#999" value={newVal} onChangeText={setNewVal} />
        <Btn label="+" color="#3b82f6" onPress={() => {
          if (newKey) { setLabels({ ...labels, [newKey]: newVal }); setNewKey(""); setNewVal(""); }
        }} small />
      </View>
      <Btn label="Save Labels" color="#3b82f6" loading={saving} onPress={async () => {
        setSaving(true);
        try { await updateServer(server.id, { labels }); onRefresh(); } catch {}
        setSaving(false);
      }} />
    </View>
  );
}

function MetricsPanel({ serverId }: { serverId: number }) {
  const [period, setPeriod] = useState("1h");
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try { const d = await getServerMetrics(serverId, "cpu,disk,network", p); setMetrics(d.metrics); } catch {}
    setLoading(false);
  }, [serverId]);

  useEffect(() => { load(period); }, [period, load]);

  const periods = [
    { label: "1h", value: "1h" },
    { label: "6h", value: "6h" },
    { label: "24h", value: "24h" },
    { label: "7d", value: "7d" },
    { label: "30d", value: "30d" },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
        {periods.map(({ label, value }) => (
          <Pressable
            key={value}
            style={[styles.chip, period === value && styles.chipActive]}
            onPress={() => setPeriod(value)}
          >
            <Text style={[styles.chipText, period === value && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator size="small" color="#1a1a2e" /> : metrics ? (
        <View>
          {metrics.time_series && Object.entries(metrics.time_series).map(([key, series]: [string, any]) => (
            <View key={key} style={{ marginBottom: 12 }}>
              <Text style={styles.subLabel}>{key}</Text>
              <View style={styles.miniChart}>
                {series.values?.slice(-60).map((point: any, i: number) => {
                  const val = parseFloat(point[1]) || 0;
                  const h = Math.min(Math.max(val, 2), 100);
                  return (
                    <View key={i} style={styles.miniBarSlot}>
                      <View style={[styles.miniBar, { height: `${h}%`, backgroundColor: barColor(val) }]} />
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : <Text style={styles.muted}>No metrics data</Text>}
    </View>
  );
}

function ContainersPanel({ serverName }: { serverName: string }) {
  const [containers, setContainers] = useState<any[]>([]);
  const [logs, setLogs] = useState<{ name: string; lines: string[] } | null>(null);

  useEffect(() => {
    connectWs();
    return onWsMessage((msg) => {
      if (msg.type === "containers") setContainers(msg.data);
      if (msg.type === "container_logs") setLogs(msg.data);
      if (msg.type === "agents" && Array.isArray(msg.data)) {
        const agent = msg.data.find((a: any) => a.hostname === serverName);
        if (agent?.containers) setContainers(agent.containers);
      }
    });
  }, [serverName]);

  return (
    <View>
      {containers.length === 0 ? <Text style={styles.muted}>No containers detected (requires agent)</Text> : (
        containers.map((c: any) => (
          <View key={c.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[styles.badgeDot, { backgroundColor: c.status === "running" ? "#22c55e" : "#ef4444" }]} />
                <Text style={styles.listItemTitle}>{c.name}</Text>
              </View>
              <Text style={styles.muted}>{c.image}</Text>
              {c.cpu_percent !== undefined && (
                <Text style={styles.muted}>CPU {c.cpu_percent}% · RAM {c.memory_mb}MB</Text>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {c.status === "running" ? (
                <>
                  <Btn label="Stop" color="#ef4444" onPress={() => sendWsCommand(serverName, "container_action", { container_id: c.name, action: "stop" })} small />
                  <Btn label="Restart" color="#eab308" onPress={() => sendWsCommand(serverName, "container_action", { container_id: c.name, action: "restart" })} small />
                  <Btn label="Logs" color="#3b82f6" onPress={() => sendWsCommand(serverName, "container_logs", { container_id: c.name, tail: 50 })} small />
                </>
              ) : (
                <Btn label="Start" color="#22c55e" onPress={() => sendWsCommand(serverName, "container_action", { container_id: c.name, action: "start" })} small />
              )}
            </View>
          </View>
        ))
      )}
      {logs && (
        <View style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <Text style={styles.subLabel}>Logs: {logs.name}</Text>
            <Pressable onPress={() => setLogs(null)}>
              <Text style={{ color: "#999", fontSize: 12 }}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.logTerminal} nestedScrollEnabled>
            {logs.lines.filter(Boolean).map((line, i) => (
              <Text key={i} style={styles.logLine}>{line}</Text>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────

export default function ServerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getServer(parseInt(id, 10));
      setServer(data.server);
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    connectWs();
    return onWsMessage((msg) => {
      if (msg.type === "metrics" && server && msg.hostname === server.name) setLiveMetrics(msg.data);
      if (msg.type === "agents" && Array.isArray(msg.data) && server) {
        const agent = msg.data.find((a: any) => a.hostname === server.name);
        if (agent?.metrics) setLiveMetrics(agent.metrics);
      }
    });
  }, [server?.name]);

  const doAction = async (action: string) => {
    if (!server) return;
    setActionLoading(action);
    try { await serverAction(server.id, action); } catch {}
    setActionLoading("");
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a1a2e" /></View>;
  }
  if (error || !server) {
    return <View style={styles.center}><Text style={styles.errorText}>{error || "Server not found"}</Text></View>;
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {renaming ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1, fontSize: 20, fontWeight: "700" }]} value={newName} onChangeText={setNewName} autoFocus />
              <Btn label="Save" color="#22c55e" onPress={async () => {
                try { await updateServer(server.id, { name: newName }); await load(); } catch {}
                setRenaming(false);
              }} small />
              <Btn label="×" color="#999" onPress={() => setRenaming(false)} small />
            </View>
          ) : (
            <Pressable onPress={() => { setNewName(server.name); setRenaming(true); }}>
              <Text style={styles.name}>{server.name}</Text>
            </Pressable>
          )}
          <Text style={styles.subHeader}>{server.typeDescription || server.type} · {server.location}</Text>
        </View>
        <StatusBadge status={server.status} />
      </View>

      {/* Quick stats */}
      <View style={styles.section}>
        <View style={styles.resourceGrid}>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{liveMetrics ? `${liveMetrics.cpu.percent}%` : server.cores}</Text>
            <Text style={styles.resourceLabel}>{liveMetrics ? "CPU" : "Cores"}</Text>
          </View>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{liveMetrics ? `${liveMetrics.memory.percent}%` : server.memory}</Text>
            <Text style={styles.resourceLabel}>{liveMetrics ? `RAM (${liveMetrics.memory.used_mb}MB)` : "RAM (GB)"}</Text>
          </View>
          <View style={styles.resourceCard}>
            <Text style={styles.resourceValue}>{liveMetrics ? `${liveMetrics.disk.percent}%` : server.disk}</Text>
            <Text style={styles.resourceLabel}>{liveMetrics ? `Disk (${liveMetrics.disk.used_gb}GB)` : "Disk (GB)"}</Text>
          </View>
        </View>
        {liveMetrics && (
          <View style={{ marginTop: 8 }}>
            <InfoRow label="Load (1m / 5m / 15m)" value={`${liveMetrics.load["1m"]} / ${liveMetrics.load["5m"]} / ${liveMetrics.load["15m"]}`} />
            <InfoRow label="Uptime" value={`${Math.floor(liveMetrics.uptime_seconds / 3600)}h ${Math.floor((liveMetrics.uptime_seconds % 3600) / 60)}m`} />
          </View>
        )}
      </View>

      {/* Power actions bar */}
      <View style={styles.section}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn label={actionLoading === "reboot" ? "..." : "Reboot"} color="#eab308" onPress={() => doAction("reboot")} />
          <Btn label={actionLoading === "shutdown" ? "..." : "Shutdown"} color="#ef4444" onPress={() => doAction("shutdown")} />
          <Btn label={actionLoading === "poweron" ? "..." : "Power On"} color="#22c55e" onPress={() => doAction("poweron")} />
          <Btn label={actionLoading === "reset" ? "..." : "Hard Reset"} color="#ef4444" onPress={() => doAction("reset")} />
        </View>
      </View>

      {/* Nested control panels */}
      <Panel title="Overview" icon="ℹ" defaultOpen>
        <InfoRow label="IP Address" value={server.ip} />
        <InfoRow label="IPv6" value={server.ipv6?.split("/")[0] || "—"} />
        <InfoRow label="Type" value={server.typeDescription || server.type} />
        <InfoRow label="Image" value={server.image} />
        <InfoRow label="Location" value={server.location} />
        <InfoRow label="Datacenter" value={server.datacenter} />
        <InfoRow label="Created" value={formatDate(server.created)} />
        <InfoRow label="Inbound Traffic" value={formatBytes(server.inTraffic)} />
        <InfoRow label="Outbound Traffic" value={formatBytes(server.outTraffic)} />
        <InfoRow label="Included Traffic" value={formatBytes(server.includedTraffic)} />
      </Panel>

      <Panel title="Metrics" icon="📊">
        <MetricsPanel serverId={server.id} />
      </Panel>

      <Panel title="Containers" icon="📦">
        <ContainersPanel serverName={server.name} />
      </Panel>

      <Panel title="Networking" icon="🌐">
        <NetworkingPanel server={server} />
      </Panel>

      <Panel title="Firewalls" icon="🛡">
        <FirewallsPanel serverId={server.id} />
      </Panel>

      <Panel title="Volumes" icon="💾">
        <VolumesPanel serverId={server.id} />
      </Panel>

      <Panel title="Snapshots" icon="📸">
        <SnapshotsPanel serverId={server.id} />
      </Panel>

      <Panel title="Backups" icon="🔄" badge={server.backups ? "ON" : "OFF"}>
        <BackupsPanel server={server} onRefresh={load} />
      </Panel>

      <Panel title="Rescue Mode" icon="🚑" badge={server.rescue ? "ACTIVE" : undefined}>
        <RescuePanel server={server} onRefresh={load} />
      </Panel>

      <Panel title="Rebuild" icon="🔨">
        <RebuildPanel serverId={server.id} />
      </Panel>

      <Panel title="Resize" icon="↕">
        <ResizePanel server={server} />
      </Panel>

      <Panel title="ISO Mount" icon="💿">
        <ISOPanel serverId={server.id} />
      </Panel>

      <Panel title="Console (VNC)" icon="🖥">
        <ConsolePanel serverId={server.id} />
      </Panel>

      <Panel title="Protection" icon="🔒">
        <ProtectionPanel server={server} onRefresh={load} />
      </Panel>

      <Panel title="Labels" icon="🏷">
        <LabelsPanel server={server} onRefresh={load} />
      </Panel>

      {/* Danger zone */}
      <View style={[styles.section, { marginBottom: 40, borderWidth: 1, borderColor: "#ef444440" }]}>
        <Text style={[styles.sectionTitle, { color: "#ef4444" }]}>Danger Zone</Text>
        <ConfirmBtn
          label="Delete Server"
          color="#ef4444"
          confirmLabel="Yes, permanently delete"
          onPress={async () => {
            try { await deleteServer(server.id); router.back(); } catch {}
          }}
        />
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  errorText: { color: "#ef4444", fontSize: 16 },
  backButton: { marginBottom: 12 },
  backText: { fontSize: 15, color: "#1a1a2e", fontWeight: "500" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  name: { fontSize: 24, fontWeight: "700", color: "#1a1a2e" },
  subHeader: { fontSize: 13, color: "#999", marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 13, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  infoLabel: { fontSize: 14, color: "#666" },
  infoValue: { fontSize: 14, color: "#1a1a2e", fontWeight: "500", flexShrink: 1, textAlign: "right" },
  resourceGrid: { flexDirection: "row", gap: 12 },
  resourceCard: { flex: 1, backgroundColor: "#f8f9fa", borderRadius: 8, padding: 16, alignItems: "center" },
  resourceValue: { fontSize: 24, fontWeight: "700", color: "#1a1a2e" },
  resourceLabel: { fontSize: 11, color: "#999", marginTop: 4, textAlign: "center" },

  // Panel styles
  panel: { backgroundColor: "#fff", borderRadius: 12, marginBottom: 8, overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  panelIcon: { fontSize: 16 },
  panelTitle: { fontSize: 15, fontWeight: "600", color: "#1a1a2e", flex: 1 },
  panelChevron: { fontSize: 14, color: "#999" },
  panelBadge: { backgroundColor: "#f0f0f0", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  panelBadgeText: { fontSize: 10, fontWeight: "700", color: "#666", textTransform: "uppercase" },
  panelBody: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  panelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },

  // Buttons
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1 },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  btnText: { fontSize: 13, fontWeight: "600" },

  // Inputs
  input: { flex: 1, borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: "#1a1a2e", backgroundColor: "#fafafa" },

  // Chips (inline picker)
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#f0f0f0", marginRight: 6 },
  chipActive: { backgroundColor: "#1a1a2e" },
  chipText: { fontSize: 12, fontWeight: "500", color: "#666" },
  chipTextActive: { color: "#fff" },

  // List items
  listItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  listItemTitle: { fontSize: 14, fontWeight: "600", color: "#1a1a2e" },

  // Misc
  muted: { fontSize: 12, color: "#999", marginVertical: 4 },
  subLabel: { fontSize: 12, fontWeight: "600", color: "#666", marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 },

  // Password/credential box
  pwBox: { backgroundColor: "#1a1a2e", borderRadius: 8, padding: 12, marginVertical: 8 },
  pwLabel: { fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: 0.3 },
  pwValue: { fontSize: 14, color: "#22c55e", fontFamily: "monospace", marginTop: 2 },

  // Toggle switch
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  toggle: { width: 40, height: 22, borderRadius: 11, backgroundColor: "#ddd", justifyContent: "center", padding: 2 },
  toggleOn: { backgroundColor: "#22c55e" },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff" },
  toggleKnobOn: { alignSelf: "flex-end" },
  toggleLabel: { fontSize: 14, color: "#1a1a2e" },

  // Firewall rules
  ruleText: { fontSize: 11, color: "#666", fontFamily: "monospace", marginTop: 2 },

  // Metrics mini chart
  miniChart: { flexDirection: "row", height: 50, alignItems: "flex-end", gap: 1, backgroundColor: "#f8f9fa", borderRadius: 6, padding: 3, overflow: "hidden" },
  miniBarSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  miniBar: { width: "100%", borderRadius: 1, minHeight: 1 },

  // Logs
  logTerminal: { backgroundColor: "#1a1a2e", borderRadius: 8, padding: 10, maxHeight: 300 },
  logLine: { fontSize: 11, color: "#d4d4d4", fontFamily: "monospace", lineHeight: 16 },
});
