# 2048 for the wedgie. Slide the joystick: every tile moves that way, two the same become one.
# Grey undoes the last move, red starts over. The board and the best score are saved.
import time, random, gc, framebuf
import lcd as L
import ui, save

d = L.LCD()
keys = L.Keys()

FRAME = 20
T, G = 50, 4                        # tile size, gap
GX, GY = 14, 24                     # the grid's top-left; the score sits above it
INK, WHITE = 1, 10                  # two of the 16 left as they are: dark and light text
# 11 slots are tinted to the classic colors: board, empty cell, then 2, 4, 8 ... 2048. The rest stay as
# they are: dark and light text (also the 4096+ tile) and the button colors ui.say() draws.
SLOTS = (0, 2, 3, 4, 5, 7, 8, 9, 12, 14, 15)
RGB = ((187, 173, 160), (205, 193, 180), (238, 228, 218), (237, 224, 200), (242, 177, 121),
       (245, 149, 99), (246, 124, 95), (246, 94, 59), (237, 207, 114), (237, 200, 80), (237, 194, 46))
FILL = (0, 2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10)     # tile 2**n -> its SLOTS index (128 & 256, 512 & 1024 share)
BOARD, EMPTY = SLOTS[0], SLOTS[1]

grid = bytearray(16)                # 0 empty, n = the tile 2**n
undo = bytearray(16)
st = {"score": 0, "best": 0, "undo": -1, "won": False, "moves": 0}
tiles = {}                          # n -> its 50x50 picture, made the first time it's needed


def tint():
    for i, rgb in zip(SLOTS, RGB):
        L.tint(i, *rgb)


def tile(n):
    fb = tiles.get(n)
    if fb:
        return fb
    fb = framebuf.FrameBuffer(bytearray(T * T // 2), T, T, framebuf.GS4_HMSB)
    fb.fill(SLOTS[FILL[n]] if n < len(FILL) else INK)
    for x, y in ((0, 0), (T - 1, 0), (0, T - 1), (T - 1, T - 1)):
        fb.pixel(x, y, BOARD)
    s = str(1 << n)
    k = len(s)
    mono = framebuf.FrameBuffer(bytearray(8 * k), 8 * k, 8, framebuf.MONO_HLSB)
    mono.text(s, 0, 0, 1)
    cw = min(24, 44 // k)           # each digit's width; 1 digit 24 px, 4 digits 11
    w, h = cw * k, min(24, cw * 3 // 2)
    x0, y0, c = (T - w) // 2, (T - h) // 2, INK if n < 3 else WHITE
    for ty in range(h):
        sy = ty * 8 // h
        for tx in range(w):
            if mono.pixel(tx * 8 * k // w, sy):
                fb.pixel(x0 + tx, y0 + ty, c)
    tiles[n] = fb
    return fb


def add():
    free = [i for i in range(16) if not grid[i]]
    if free:
        grid[free[random.getrandbits(8) % len(free)]] = 2 if random.getrandbits(8) < 26 else 1


def slide(dx, dy):
    """Move every tile toward (dx, dy). Returns the points it made, or -1 if nothing moved."""
    pts, moved = 0, False
    for a in range(4):
        line = [a + 4 * b for b in range(4)] if dx == 0 else [4 * a + b for b in range(4)]
        if dx > 0 or dy > 0:
            line.reverse()
        vals = [grid[i] for i in line if grid[i]]
        out = []
        j = 0
        while j < len(vals):
            if j + 1 < len(vals) and vals[j] == vals[j + 1]:
                out.append(vals[j] + 1)
                pts += 1 << (vals[j] + 1)
                j += 2
            else:
                out.append(vals[j])
                j += 1
        out += [0] * (4 - len(out))
        for i, v in zip(line, out):
            if grid[i] != v:
                moved = True
            grid[i] = v
    return pts if moved else -1


def stuck():
    for i in range(16):
        if not grid[i]:
            return False
        if i % 4 < 3 and grid[i] == grid[i + 1]:
            return False
        if i < 12 and grid[i] == grid[i + 4]:
            return False
    return True


def draw_top():
    d.fill_rect(0, 0, 240, GY - G, BOARD)
    d.big_text(str(st["score"]), GX, 2, WHITE, 2)
    b = "best %d" % st["best"]
    d.text(b, ui.right() - 8 * len(b), 6, WHITE)
    d.show(0, GY - G)


def draw_grid():
    d.fill_rect(0, GY - G, 240, 240 - GY + G, BOARD)
    for i in range(16):
        x, y = GX + (i % 4) * (T + G), GY + (i // 4) * (T + G)
        if grid[i]:
            d.blit(tile(grid[i]), x, y)
        else:
            d.fill_rect(x + 1, y + 1, T - 2, T - 2, EMPTY)
    d.show(GY - G, 240)


def screen():
    d.fill(BOARD)
    tint()
    draw_top()
    draw_grid()


def keep():
    save.store("game", {"grid": list(grid), "score": st["score"], "won": st["won"]})


def fresh():
    grid[:] = bytes(16)
    st["score"], st["undo"], st["won"], st["moves"] = 0, -1, False, 0
    add(); add()


def pace(t):
    left = FRAME - time.ticks_diff(time.ticks_ms(), t)
    time.sleep_ms(left if left > 0 else 1)


def wait_a():
    time.sleep_ms(500)
    keys.pressed()
    while True:
        t = time.ticks_ms()
        if "A" in keys.pressed():
            return
        pace(t)


def title():
    d.fill(BOARD)
    tint()
    d.blit(tile(11), 95, 30)
    ui.say(d, "{g} play", 120, WHITE, 2)
    ui.say(d, "{k} undo   {r} new", 160, WHITE)
    d.center_text("joystick: slide", 180, WHITE)
    if st["best"]:
        d.center_text("best %d" % st["best"], 210, WHITE, 2)
    d.show()
    wait_a()


DIRS = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}


def run():
    random.seed(time.ticks_us())
    st["best"] = save.load("best", 0)
    g = save.load("game", None)
    if g and len(g.get("grid", ())) == 16 and not stuck_of(g["grid"]):
        grid[:] = bytes(g["grid"])
        st["score"], st["won"] = g.get("score", 0), g.get("won", False)
    else:
        fresh()
    title()
    screen()
    while True:
        t = time.ticks_ms()
        for k in keys.pressed():
            if k in DIRS:
                undo[:] = grid
                pts = slide(*DIRS[k])
                if pts < 0:
                    continue
                st["undo"] = st["score"]
                st["score"] += pts
                add()
                st["moves"] += 1
                if st["score"] > st["best"]:
                    st["best"] = st["score"]
                draw_grid()
                if pts:
                    draw_top()
                if st["moves"] % 10 == 0:
                    keep()
                if not st["won"] and max(grid) >= 11:
                    st["won"] = True
                    keep()
                    time.sleep_ms(500)
                    ui.page(d, "2048!", [("score %d" % st["score"], ui.INK)], "{g} keep going")
                    wait_a()
                    screen()
                elif stuck():
                    if st["best"] > save.load("best", 0):
                        save.store("best", st["best"])
                    time.sleep_ms(900)
                    ui.page(d, "Game over", [("score %d" % st["score"], ui.INK),
                                             ("best %d" % st["best"], ui.MUTED)], "{g} play again")
                    fresh()
                    keep()
                    wait_a()
                    screen()
            elif k == "B" and st["undo"] >= 0:
                grid[:] = undo
                st["score"], st["undo"] = st["undo"], -1
                draw_top(); draw_grid()
            elif k == "Y":
                if ui.ask(d, "New game?", keys=keys):
                    if st["best"] > save.load("best", 0):
                        save.store("best", st["best"])
                    fresh()
                    keep()
                gc.collect()
                screen()
        pace(t)


def stuck_of(g):
    grid[:] = bytes(g)
    return stuck()
