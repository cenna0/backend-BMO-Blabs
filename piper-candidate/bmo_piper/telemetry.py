from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Event, Thread
import os
import time


CGROUP_MEMORY = Path("/sys/fs/cgroup/memory.current")


def memory_current() -> int:
    try:
        return int(CGROUP_MEMORY.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return 0


def host_mem_available() -> int:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) * 1024
    except OSError:
        pass
    return 0


def process_count() -> int:
    return sum(entry.name.isdigit() for entry in Path("/proc").iterdir())


def descriptor_count() -> int:
    total = 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            total += len(list((entry / "fd").iterdir()))
        except OSError:
            continue
    return total


def file_count(root: Path) -> int:
    try:
        return sum(path.is_file() for path in root.rglob("*"))
    except OSError:
        return -1


@dataclass(frozen=True)
class Telemetry:
    memory_before: int
    memory_peak: int
    memory_after: int
    host_mem_available_min: int
    process_before: int
    process_peak: int
    process_after: int
    descriptors_before: int
    descriptors_peak: int
    descriptors_after: int
    temp_files_before: int
    temp_files_peak: int
    temp_files_after: int


class Sampler:
    def __init__(self, temp_root: Path, interval: float = 0.02) -> None:
        self.temp_root = temp_root
        self.interval = interval
        self.stop_event = Event()
        self.memory_values: list[int] = []
        self.host_values: list[int] = []
        self.process_values: list[int] = []
        self.descriptor_values: list[int] = []
        self.temp_values: list[int] = []
        self.thread = Thread(target=self._sample, daemon=True)

    def _take(self) -> None:
        self.memory_values.append(memory_current())
        self.host_values.append(host_mem_available())
        self.process_values.append(process_count())
        self.descriptor_values.append(descriptor_count())
        self.temp_values.append(file_count(self.temp_root))

    def _sample(self) -> None:
        while not self.stop_event.is_set():
            self._take()
            self.stop_event.wait(self.interval)

    def __enter__(self) -> "Sampler":
        self._take()
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.stop_event.set()
        self.thread.join(timeout=1)
        self._take()

    def result(self) -> Telemetry:
        return Telemetry(
            memory_before=self.memory_values[0],
            memory_peak=max(self.memory_values),
            memory_after=self.memory_values[-1],
            host_mem_available_min=min(value for value in self.host_values if value > 0),
            process_before=self.process_values[0],
            process_peak=max(self.process_values),
            process_after=self.process_values[-1],
            descriptors_before=self.descriptor_values[0],
            descriptors_peak=max(self.descriptor_values),
            descriptors_after=self.descriptor_values[-1],
            temp_files_before=self.temp_values[0],
            temp_files_peak=max(self.temp_values),
            temp_files_after=self.temp_values[-1],
        )
