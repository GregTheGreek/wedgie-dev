# Blocks: falling blocks for the wedgie. Joystick moves and drops, green turns, grey turns back,
# red pauses. A full row clears; every 10 rows it gets faster. The best score is saved.
import time, random, gc
import lcd as L
import ui, save

d = L.LCD()
keys = L.Keys()

FRAME = 20                          # ms: 50 fps
C = 11                              # cell size in pixels
W, H, HID = 10, 20, 2               # board, plus 2 hidden rows on top where pieces appear
BX, BY = 10, 10                     # board's top-left on screen
PX = BX + W * C + 14                # the panel on the right

BG = L.color(0, 0, 0)
GRID = L.color(26, 27, 26)
EDGE = L.color(90, 91, 90)
GHOST = L.color(120, 123, 120)
TXT = L.color(254, 254, 254)
DIM = L.color(169, 170, 171)
# 7 pieces: I O T S Z J L. Cyan, purple and orange aren't in the 16: tint() lends them slots 7-9 (light greys this app never draws).
TINTS = ((7, (0, 220, 230)), (8, (170, 60, 220)), (9, (255, 140, 0)))
COL = bytes((0, 7, L.color(255, 220, 0), 8, L.color(34, 196, 82), L.color(227, 49, 44),
             L.color(40, 100, 230), 9))
SHAPES = (None, ("....", "####", "....", "...."), ("##", "##"), (".#.", "###", "..."),
          (".##", "##.", "..."), ("##.", ".##", "..."), ("#..", "###", "..."), ("..#", "###", "..."))
SPEED = (800, 720, 630, 550, 470, 380, 300, 220, 140, 110, 90, 80, 70, 60, 50)
POINTS = (0, 100, 300, 500, 800)


def rotations(rows):
    n = len(rows)
    cells = [(x, y) for y in range(n) for x in range(n) if rows[y][x] == "#"]
    out = []
    for _ in range(4):
        out.append(tuple(cells))
        cells = [(n - 1 - y, x) for x, y in cells]
    return out


ROT = [None] + [rotations(s) for s in SHAPES[1:]]
KICKS = ((0, 0), (-1, 0), (1, 0), (0, -1), (-2, 0), (2, 0))

board = bytearray(W * (H + HID))
bag = []
st = {}                             # the game: piece, x, y, r, next, score, lines, level, best


def tint():
    for i, rgb in TINTS:
        L.tint(i, *rgb)


def take():
    if not bag:
        bag.extend(range(1, 8))
        for i in range(6, 0, -1):
            j = random.getrandbits(8) % (i + 1)
            bag[i], bag[j] = bag[j], bag[i]
    return bag.pop()


def fits(p, x, y, r):
    for cx, cy in ROT[p][r]:
        bx, by = x + cx, y + cy
        if bx < 0 or bx >= W or by >= H + HID:
            return False
        if by >= 0 and board[by * W + bx]:
            return False
    return True


def spawn():
    p = st["next"]
    st["next"] = take()
    st["p"], st["r"], st["y"] = p, 0, 0 if p != 1 else -1
    st["x"] = 3 if p != 2 else 4
    return fits(p, st["x"], st["y"], 0)


def ghost_y():
    y = st["y"]
    while fits(st["p"], st["x"], y + 1, st["r"]):
        y += 1
    return y


def cell(x, y, c):
    d.fill_rect(BX + x * C, BY + y * C, C - 1, C - 1, c)


def draw_board():
    d.fill_rect(BX, BY, W * C, H * C, BG)
    for y in range(H):
        o = (y + HID) * W
        for x in range(W):
            v = board[o + x]
            if v:
                cell(x, y, COL[v])
            elif x & 1 == y & 1:
                d.pixel(BX + x * C + 5, BY + y * C + 5, GRID)
    p, r, x = st["p"], st["r"], st["x"]
    if p:
        gy = ghost_y() - HID
        for cx, cy in ROT[p][r]:
            if gy + cy >= 0:
                d.rect(BX + (x + cx) * C, BY + (gy + cy) * C, C - 1, C - 1, GHOST)
        y = st["y"] - HID
        c = COL[p]
        for cx, cy in ROT[p][r]:
            if y + cy >= 0:
                cell(x + cx, y + cy, c)
    d.show_rect(BX, BY, W * C, H * C)


def num(v, y):
    s = str(v)
    d.fill_rect(PX, y, 240 - PX, 16, BG)
    d.big_text(s, PX, y, TXT, 2 if len(s) <= 5 else 1)


def draw_panel():
    d.fill_rect(PX, 40, 240 - PX, 200, BG)
    d.text("next", PX, 40, DIM)
    n = st["next"]
    for cx, cy in ROT[n][0]:
        d.fill_rect(PX + cx * C, 54 + cy * C, C - 1, C - 1, COL[n])
    d.text("score", PX, 110, DIM)
    num(st["score"], 122)
    d.text("lines", PX, 148, DIM)
    num(st["lines"], 160)
    d.text("level", PX, 186, DIM)
    num(st["level"], 198)
    d.text("best %d" % st["best"], PX, 226, DIM)
    d.show_rect(PX, 40, 240 - PX, 200)


def new_screen():
    d.fill(BG)
    tint()
    d.rect(BX - 2, BY - 2, W * C + 3, H * C + 3, EDGE)
    d.show()


def lock():
    p, r, x, y = st["p"], st["r"], st["x"], st["y"]
    for cx, cy in ROT[p][r]:
        if y + cy < 0:
            return False
        board[(y + cy) * W + x + cx] = p
    full = [row for row in range(H + HID) if all(board[row * W:row * W + W])]
    if full:
        st["p"] = 0
        for row in full:                    # a flash, then they go
            if row >= HID:
                d.fill_rect(BX, BY + (row - HID) * C, W * C - 1, C - 1, TXT)
        d.show_rect(BX, BY, W * C, H * C)
        time.sleep_ms(90)
        for row in full:
            board[W:(row + 1) * W] = board[0:row * W]
            board[0:W] = bytes(W)
        st["lines"] += len(full)
        st["score"] += POINTS[len(full)] * st["level"]
        st["level"] = st["lines"] // 10 + 1
    return True


def pace(t):
    left = FRAME - time.ticks_diff(time.ticks_ms(), t)
    time.sleep_ms(left if left > 0 else 1)


def title():
    d.fill(BG)
    tint()
    for i, p in enumerate((1, 3, 6, 2, 4, 7, 5)):       # one of each, falling into a row
        for cx, cy in ROT[p][0]:
            d.fill_rect(8 + i * 33 + cx * 7, 20 + cy * 7, 6, 6, COL[p])
    d.center_text("Blocks", 70, TXT, 4)
    ui.say(d, "{g} turn   {k} turn back", 130, TXT)
    ui.say(d, "{r} pause", 150, TXT)
    d.center_text("joystick: move, drop", 170, DIM)
    best = save.load("best", 0)
    if best:
        d.center_text("best %d" % best, 196, DIM, 2)
    ui.say(d, "{g} play", 224, TXT)
    d.show()
    while True:
        t = time.ticks_ms()
        if "A" in keys.pressed():
            return
        pace(t)


def paused():
    d.fill_rect(BX, BY + 90, W * C, 40, BG)
    d.center_text("paused", BY + 100, TXT, 2)
    d.show()
    while True:
        t = time.ticks_ms()
        k = keys.pressed()
        if "A" in k or "Y" in k:
            return
        pace(t)


def over():
    best = st["best"]
    if st["score"] > best:
        save.store("best", st["score"])
        best = st["score"]
    ui.page(d, "Game over", [("score %d" % st["score"], ui.INK), ("best %d" % best, ui.MUTED)],
            "{g} play again")
    time.sleep_ms(600)
    keys.pressed()
    while True:
        t = time.ticks_ms()
        if "A" in keys.pressed():
            return
        pace(t)


def game():
    random.seed(time.ticks_us())
    board[:] = bytes(len(board))
    bag.clear()
    st["score"], st["lines"], st["level"], st["p"] = 0, 0, 1, 0
    st["best"], st["next"] = save.load("best", 0), take()
    gc.collect()
    new_screen()
    spawn()
    draw_panel()
    draw_board()
    fall = time.ticks_ms()
    das = {"left": 0, "right": 0}           # ms each side has been held
    while True:
        t = time.ticks_ms()
        moved = locked = False
        p = st["p"]
        for k in keys.pressed():
            if k == "A" or k == "B":
                r = (st["r"] + (1 if k == "A" else 3)) % 4
                for kx, ky in KICKS:
                    if fits(p, st["x"] + kx, st["y"] + ky, r):
                        st["x"] += kx; st["y"] += ky; st["r"] = r
                        moved = True
                        break
            elif k == "up" or k == "press":
                g = ghost_y()
                st["score"] += 2 * (g - st["y"])
                st["y"] = g
                locked = True
            elif k == "Y":
                paused()
                new_screen(); draw_panel(); moved = True
            elif k == "left" or k == "right":
                dx = -1 if k == "left" else 1
                if fits(p, st["x"] + dx, st["y"], st["r"]):
                    st["x"] += dx; moved = True
                das[k] = 0
        for k in ("left", "right"):         # held: wait 160 ms, then a step every 50 ms
            if keys.held(k):
                das[k] += FRAME
                if das[k] >= 160:
                    das[k] -= 50
                    dx = -1 if k == "left" else 1
                    if fits(p, st["x"] + dx, st["y"], st["r"]):
                        st["x"] += dx; moved = True
            else:
                das[k] = 0
        speed = SPEED[min(st["level"], len(SPEED)) - 1]
        if keys.held("down"):
            speed = min(speed, 40)
        if not locked and time.ticks_diff(t, fall) >= speed:
            fall = t
            if fits(p, st["x"], st["y"] + 1, st["r"]):
                st["y"] += 1; moved = True
                if keys.held("down"):
                    st["score"] += 1
            else:
                locked = True
        if locked:
            if not lock() or not spawn():
                st["p"] = st["p"] or p
                draw_board()
                time.sleep_ms(700)
                return
            fall = t
            draw_panel()
            moved = True
        if moved:
            draw_board()
        pace(t)


def run():
    while True:
        title()
        game()
        over()
