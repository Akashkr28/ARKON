"""OpenCASCADE prints progress and statistics straight to stdout. Keep only what matters."""

import os

from OCP.Message import Message, Message_Gravity

LEVELS = {
    "trace": Message_Gravity.Message_Trace,
    "info": Message_Gravity.Message_Info,
    "warning": Message_Gravity.Message_Warning,
    "fail": Message_Gravity.Message_Fail,
}


def configure_occt_output(level: str | None = None) -> None:
    """Show OCCT messages at `level` and above (default: OCCT_LOG env var, else "fail")."""
    gravity = LEVELS.get(
        (level or os.environ.get("OCCT_LOG", "fail")).lower(), Message_Gravity.Message_Fail
    )
    printers = Message.DefaultMessenger_s().Printers()
    for i in range(1, printers.Length() + 1):
        printers.Value(i).SetTraceLevel(gravity)


def silence_occt_output() -> None:
    """Drop OCCT's console printers entirely (tests feed it broken files on purpose)."""
    messenger = Message.DefaultMessenger_s()
    printers = messenger.Printers()
    for printer in [printers.Value(i) for i in range(1, printers.Length() + 1)]:
        messenger.RemovePrinter(printer)
