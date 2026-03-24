import psutil
import platform
import time


def collect_system_metrics() -> dict:
    cpu_percent = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    load = psutil.getloadavg()
    boot_time = psutil.boot_time()
    uptime = time.time() - boot_time

    return {
        "cpu": {
            "percent": cpu_percent,
            "cores": psutil.cpu_count(logical=True),
            "freq_mhz": round(psutil.cpu_freq().current) if psutil.cpu_freq() else None,
        },
        "memory": {
            "total_mb": round(mem.total / 1024 / 1024),
            "used_mb": round(mem.used / 1024 / 1024),
            "percent": mem.percent,
        },
        "disk": {
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "percent": round(disk.percent, 1),
        },
        "load": {
            "1m": round(load[0], 2),
            "5m": round(load[1], 2),
            "15m": round(load[2], 2),
        },
        "uptime_seconds": round(uptime),
        "hostname": platform.node(),
    }
