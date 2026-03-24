import docker


def collect_containers() -> list[dict]:
    try:
        client = docker.from_env()
    except Exception:
        return []

    result = []
    for c in client.containers.list(all=True):
        stats = {}
        if c.status == "running":
            try:
                raw = c.stats(stream=False)
                # CPU
                cpu_delta = raw["cpu_stats"]["cpu_usage"]["total_usage"] - raw["precpu_stats"]["cpu_usage"]["total_usage"]
                sys_delta = raw["cpu_stats"]["system_cpu_usage"] - raw["precpu_stats"]["system_cpu_usage"]
                num_cpus = raw["cpu_stats"].get("online_cpus", 1)
                cpu_percent = round((cpu_delta / sys_delta) * num_cpus * 100, 1) if sys_delta > 0 else 0
                # Memory
                mem_usage = raw["memory_stats"].get("usage", 0)
                mem_limit = raw["memory_stats"].get("limit", 1)
                stats = {
                    "cpu_percent": cpu_percent,
                    "memory_mb": round(mem_usage / 1024 / 1024, 1),
                    "memory_limit_mb": round(mem_limit / 1024 / 1024, 1),
                }
            except Exception:
                pass

        result.append({
            "id": c.short_id,
            "name": c.name,
            "image": c.image.tags[0] if c.image.tags else str(c.image.id)[:12],
            "status": c.status,
            "created": c.attrs.get("Created", ""),
            **stats,
        })

    return result
