from bmo_piper.host_snapshot import parse_meminfo


def test_parse_meminfo_reports_bytes():
    parsed = parse_meminfo(
        "MemTotal: 8000 kB\nMemAvailable: 4000 kB\nSwapTotal: 0 kB\n"
    )
    assert parsed == {
        "mem_total_bytes": 8000 * 1024,
        "mem_available_bytes": 4000 * 1024,
        "swap_total_bytes": 0,
    }
