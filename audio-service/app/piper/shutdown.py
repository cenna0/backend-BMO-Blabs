from __future__ import annotations

import signal


class ShutdownRequested(BaseException):
    pass


_REQUESTED = False


def shutdown_requested() -> bool:
    return _REQUESTED


def install_shutdown_handlers() -> None:
    def request_shutdown(_signum: int, _frame: object) -> None:
        global _REQUESTED
        _REQUESTED = True
        raise ShutdownRequested()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

