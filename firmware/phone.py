# A phone knocked on the WEDGIE drive (wedgiedrive.py): may it write requests (phone mode, until unplug)?
# A yes makes the drive writable; a no restarts (slot). Every job a request starts still asks on its own.
# Loaded only when asked: the running app pays no heap for it.
import slot
import ui


def ask():
    """True after a yes (the green button). After it, a short screen saying so: the app draws over it."""
    ok = ui.ask(slot.d, "Allow", ms=slot.ASK_MS, big="phone txns")   # a new way in for transactions, not access (Austin)
    if ok:
        ui.page(slot.d, "Phone txns on")
    return ok
