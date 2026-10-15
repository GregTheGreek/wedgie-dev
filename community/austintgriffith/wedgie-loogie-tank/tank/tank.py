# Loogie Tank: the loogies your Safe owns, swimming on your wedgie.
#
# The wedgie has no internet, so it never reads the chain: a computer tells it which loogies it has
# and it keeps them in a save ("tank"), so they swim at every boot, offline.
#   save "tank" = {"loogies": [[chain, id, "rrggbb", chubbiness, mouth], ...]}
#   chain: "eth" (Loogies, mainnet) or "op" (OptimisticLoogies). mouth: mouthLength, 0 = none (mainnet).
# No save yet: a few demo loogies.
#
# USB ("usb": true: the app reads its own lines, like wedgie-safe; everything else goes to the slot):
#   {"id":1,"type":"tank","loogies":[["op",7,"4fc822",81,188], ...]} -> {"id":1,"type":"tank_ok","n":16}
#   hello answers carry "running": "tank" and "tank": how many loogies are in it.
# Anyone plugged in can refill the tank without a press: it only ever changes this app's own save.
#
# Each loogie is drawn like its on-chain SVG (two eyes, a head ellipse chubbiness wide, a mouth curve),
# scaled down, from the C ellipse/line calls. Its exact color comes from lcd.tint: the screen holds 16
# colors, so up to 11 different loogie colors show at once; more share the nearest one.
#
# Joystick: pick a loogie (its number shows). Press: bubbles.
import sys, select, json, time, random, gc, math
from lcd import LCD, Keys, tint
import save
import wedgie as W

lcd = LCD()
keys = Keys()
FRAME = 40                          # ms per frame: 25 fps, a calm tank
MAX = 16                            # loogies in the tank at once

BLACK, WHITE = 0, 10                # palette slots kept as they are
WATER, SAND, BUBBLE = 15, 14, 9     # tinted
SLOTS = (1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13)    # tinted to loogie colors
FLOOR = 222                         # where the sand starts

DEMO = [["op", 7, "4fc822", 81, 188], ["eth", 7, "062200", 49, 0], ["op", 1, "e4572e", 100, 220],
        ["op", 2, "f3a712", 40, 160], ["eth", 3, "29335c", 70, 0], ["op", 4, "a8c686", 60, 200]]

# one loogie: [x16, y16, dx16, dy16, slot, rx, phase, id, chain, mouth points (8 ints, facing left)]
fish = []
tints = []                          # (slot, r, g, b)
sel = -1                            # the picked loogie, or -1
sel_until = 0
label = ""
bubbles = [[0, 0, 0] for _ in range(8)]     # x, y, r (r 0 = none)
BOB = bytes(int(2 + 2 * math.sin(i * 6.2832 / 32)) for i in range(32))


def rgb(h):
    v = int(h, 16)
    return v >> 16 & 255, v >> 8 & 255, v & 255


def colors(hexes):
    """Each hex -> a tinted slot: the first 11 distinct get their own, the rest the nearest of those."""
    global tints
    tints = []
    got = {}
    out = []
    for h in hexes:
        h = h.lower()
        if h not in got:
            r, g, b = rgb(h)
            if len(tints) < len(SLOTS):
                got[h] = SLOTS[len(tints)]
                tints.append((got[h], r, g, b))
            else:
                best, bd = SLOTS[0], 1 << 30
                for s, tr, tg, tb in tints:
                    d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2
                    if d < bd:
                        best, bd = s, d
                got[h] = best
        out.append(got[h])
    return out


def load(rows):
    """The tank's loogies from save rows; S = how much smaller than the SVG they're drawn."""
    global fish, S, sel
    rows = rows[:MAX]
    S = 3 if len(rows) <= 4 else 4 if len(rows) <= 8 else 5
    slots = colors([r[2] for r in rows])
    fish = []
    for i, (chain, tid, _, chub, mouth) in enumerate(rows):
        # the mouth, from the SVG's path M 137 240 Q 172 250 (mouth+7) 235, head centre (204.5, 211.8)
        m = None
        if mouth:
            pts = []
            for k in range(4):
                t = k / 3
                x = (1 - t) ** 2 * 137 + 2 * (1 - t) * t * 172 + t * t * (mouth + 7)
                y = (1 - t) ** 2 * 240 + 2 * (1 - t) * t * 250 + t * t * 235
                pts.append(round((x - 204.5) / S))
                pts.append(round((y - 211.8) / S))
            m = pts
        sp = random.choice((-1, 1)) * random.randint(6, 14)
        fish.append([random.randint(30, 210) << 4, random.randint(40, FLOOR - 20) << 4, sp,
                     random.randint(-4, 4), slots[i], max(3, chub // S), random.randint(0, 31),
                     tid, chain, m])
    sel = -1


def draw_loogie(f, t):
    x = f[0] >> 4
    y = (f[1] >> 4) + BOB[(t + f[6]) & 31]
    rx = f[5]
    m = f[9]
    s = 1 if f[2] > 0 else -1             # the SVG loogie faces left; mirror it when it swims right
    er = 30 // S
    ry = 52 // S
    # eye 1 (behind the head), the head, eye 2, then both pupils
    ex, ey = x - s * 23 // S, y - 57 // S
    lcd.ellipse(ex, ey, er + 1, er + 1, BLACK, True)
    lcd.ellipse(ex, ey, er, er, WHITE, True)
    lcd.ellipse(x, y, rx + 1, ry + 1, BLACK, True)
    lcd.ellipse(x, y, rx, ry, f[4], True)
    fx, fy = x + s * 5 // S, y - 43 // S
    lcd.ellipse(fx, fy, er + 1, er + 1, BLACK, True)
    lcd.ellipse(fx, fy, er, er, WHITE, True)
    lcd.fill_rect(ex - s * 8 // S - 1, ey - 1, 2, 2, BLACK)
    lcd.fill_rect(fx - s * 2 // S - 1, fy, 2, 2, BLACK)
    if m:
        for k in (0, 2, 4):
            lcd.line(x + s * m[k], y + m[k + 1], x + s * m[k + 2], y + m[k + 3], BLACK)
            lcd.line(x + s * m[k], y + m[k + 1] + 1, x + s * m[k + 2], y + m[k + 3] + 1, BLACK)


def update(t):
    for f in fish:
        f[0] += f[2]
        f[1] += f[3]
        rx = f[5] + 12
        if f[0] < (rx << 4) and f[2] < 0 or f[0] > ((240 - rx) << 4) and f[2] > 0:
            f[2] = -f[2]
        if f[1] < (30 << 4) and f[3] < 0 or f[1] > ((FLOOR - 16) << 4) and f[3] > 0:
            f[3] = -f[3]
        if random.getrandbits(7) == 0:
            f[3] = random.randint(-4, 4)
    for b in bubbles:
        if b[2]:
            b[1] -= 2
            if b[1] < -4:
                b[2] = 0
        elif random.getrandbits(6) == 0:
            b[0], b[1], b[2] = random.randint(10, 230), FLOOR, random.randint(1, 3)


def draw(t):
    lcd.fill(WATER)                     # fill() drops tints: put them back
    tint(WATER, 143, 185, 235)
    tint(SAND, 232, 210, 150)
    tint(BUBBLE, 230, 242, 255)
    for s, r, g, b in tints:
        tint(s, r, g, b)
    lcd.fill_rect(0, FLOOR, 240, 240 - FLOOR, SAND)
    for b in bubbles:
        if b[2]:
            lcd.ellipse(b[0], b[1], b[2], b[2], BUBBLE)
    for f in fish:
        draw_loogie(f, t >> 2)
    if not fish:
        lcd.center_text("No loogies", 100, WHITE, 2)
    if sel >= 0 and time.ticks_diff(sel_until, time.ticks_ms()) > 0:
        f = fish[sel]
        lcd.ellipse(f[0] >> 4, (f[1] >> 4) - 20 // S, f[5] + 6, 90 // S, WHITE)
        lcd.center_text(label, FLOOR + 5, BLACK, 1)


def pick(step):
    global sel, sel_until, label
    if not fish:
        return
    sel = (sel + step) % len(fish)
    f = fish[sel]
    label = ("OP #" if f[8] == "op" else "ETH #") + str(f[7])
    sel_until = time.ticks_add(time.ticks_ms(), 3000)


def good(rows):
    """The rows a host sent, checked: anything off and the whole list is refused."""
    if not isinstance(rows, list):
        raise ValueError("loogies: a list")
    out = []
    for r in rows[:MAX]:
        if not (isinstance(r, list) and len(r) == 5 and r[0] in ("eth", "op")):
            raise ValueError("a loogie: [chain, id, color, chubbiness, mouth]")
        c = str(r[2]).lower().replace("#", "")
        int(c, 16)
        if len(c) != 6:
            raise ValueError("color: rrggbb")
        out.append([r[0], int(r[1]), c, max(0, min(255, int(r[3]))), max(0, min(255, int(r[4])))])
    return out


def handle(m):
    mid, t = m.get("id"), m.get("type")
    if t == "tank":
        try:
            rows = good(m.get("loogies"))
        except (ValueError, TypeError) as e:
            W.send({"id": mid, "type": "error", "error": "bad tank: %s" % e})
            return
        save.store("tank", {"loogies": rows})
        load(rows)
        gc.collect()
        W.send({"id": mid, "type": "tank_ok", "n": len(rows)})
    elif t == "hello":
        W.send(W.hello(mid, running="tank", tank=len(fish)))
    else:                               # hello's cousins, shots, jobs, open: the slot's
        import slot
        slot.handle(m)


def pump(poll):
    """One request per call, read through the one line reader (wedgie.lines)."""
    R = W.lines()
    line = R.pump(poll)
    if R.intr:                          # a Ctrl-C while sealed: the red question (hatch.py)
        R.intr = False
        if W.SEALED and not W.is_open():
            try:
                import hatch
                ok = hatch.ctrl_c()
            except Exception as e:
                sys.print_exception(e)
                ok = False
            if ok:
                raise KeyboardInterrupt
    if line is False:
        W.send({"type": "error", "error": "line too long"})
    elif line and line.strip():
        try:
            m = json.loads(line)
        except Exception:
            W.send({"type": "error", "error": "bad json"})
            return
        line = None
        if not isinstance(m, dict):
            return
        try:
            handle(m)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as e:
            W.failed(m.get("id"), e)


def run():
    tank = save.load("tank", None)
    load(tank["loogies"] if tank else DEMO)
    gc.collect()
    poll = select.poll()
    poll.register(sys.stdin, select.POLLIN)
    W.send(W.hello(None, type="ready", running="tank", tank=len(fish)))
    t = 0
    while True:
        t0 = time.ticks_ms()
        for k in keys.pressed():
            if k in ("right", "down"):
                pick(1)
            elif k in ("left", "up"):
                pick(-1)
            elif k == "press":
                for b in bubbles:
                    if not b[2]:
                        b[0], b[1], b[2] = random.randint(10, 230), FLOOR, random.randint(2, 4)
        pump(poll)
        update(t)
        draw(t)
        lcd.show()
        t += 1
        left = FRAME - time.ticks_diff(time.ticks_ms(), t0)
        if left > 0:
            time.sleep_ms(left)
