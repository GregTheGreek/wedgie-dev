# Blackjack for the wedgie. The secure chip shuffles a fresh deck every hand. Green hits, red stands,
# grey doubles. Dealer stands on 17. Blackjack pays 3 to 2. Your chips are saved.
import time, framebuf
import lcd as L
import ui, save
from wedgie import rand_below, rand_source

d = L.LCD()
keys = L.Keys()

FELT = ui.GREEN_D
CARD, INK, RED, BACK = ui.WHITE, ui.INK, ui.RED, L.color(40, 100, 230)
TXT, DIM = ui.WHITE, L.color(195, 196, 197)
CW, CH = 44, 62
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
SUITS = (
    ("...###....###...", "..#####..#####..", ".##############.", ".##############.", ".##############.",
     ".##############.", "..############..", "...##########...", "....########....", ".....######.....",
     "......####......", ".......##......."),
    (".......##.......", "......####......", ".....######.....", "....########....", "...##########...",
     "..############..", "..############..", "...##########...", "....########....", ".....######.....",
     "......####......", ".......##......."),
    (".......##.......", "......####......", ".....######.....", "....########....", "..############..",
     ".##############.", ".##############.", "..####.##.####..", ".......##.......", "......####......",
     ".....######.....", "................"),
    ("......####......", ".....######.....", ".....######.....", "......####......", "..###.####.###..",
     ".##############.", ".##############.", "..###..##..###..", ".......##.......", "......####......",
     ".....######.....", "................"),
)                                   # hearts, diamonds, spades, clubs


def suit_art(rows, c):
    fb = framebuf.FrameBuffer(bytearray(16 * 12 // 2), 16, 12, framebuf.GS4_HMSB)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            fb.pixel(x, y, c if ch == "#" else CARD)
    return fb


ART = [suit_art(s, RED if i < 2 else INK) for i, s in enumerate(SUITS)]
deck = bytearray(range(52))
st = {"chips": 100, "bet": 10, "msg": "", "hide": True, "src": ""}
you, dealer = [], []


def shuffle():
    for i in range(51, 0, -1):          # Fisher-Yates, every swap from the chip
        j = rand_below(i + 1)
        deck[i], deck[j] = deck[j], deck[i]
    st["top"] = 0


def draw_card():
    c = deck[st["top"]]
    st["top"] += 1
    return c


def total(hand):
    t, aces = 0, 0
    for c in hand:
        r = c % 13
        t += 11 if r == 0 else min(r + 1, 10)
        aces += r == 0
    while t > 21 and aces:
        t -= 10
        aces -= 1
    return t


def card(c, x, y, down=False):
    d.fill_rect(x + 1, y, CW - 2, CH, INK)
    d.fill_rect(x, y + 1, CW, CH - 2, INK)
    if down:
        d.fill_rect(x + 2, y + 2, CW - 4, CH - 4, BACK)
        for i in range(6, CH - 6, 6):
            d.hline(x + 6, y + i, CW - 12, CARD)
        return
    d.fill_rect(x + 2, y + 2, CW - 4, CH - 4, CARD)
    s, r = c // 13, RANKS[c % 13]
    d.big_text(r, x + 4, y + 5, RED if s < 2 else INK, 2)
    d.blit(ART[s], x + CW - 20, y + CH - 18)


def row(hand, y, hide=False):
    n = len(hand)
    step = min(CW + 4, (232 - CW) // max(1, n - 1))
    x = (240 - (CW + step * (n - 1))) // 2
    for i, c in enumerate(hand):
        card(c, x + i * step, y, hide and i == 1)


def table(hint):
    d.fill(FELT)
    dt = "dealer" if st["hide"] else "dealer %d" % total(dealer)
    d.text(dt, 8, 4, DIM)
    row(dealer, 16, st["hide"])
    if st["msg"]:
        d.center_text(st["msg"], 92, TXT, 2)
    d.text("you %d" % total(you), 8, 118, DIM)
    row(you, 130)
    d.text("chips %d" % st["chips"], 8, 200, TXT)
    b = "bet %d" % st["bet"]
    d.text(b, 232 - 8 * len(b), 200, TXT)
    ui.say(d, hint, 224, TXT)
    d.show()


def pace(t, ms=20):
    left = ms - time.ticks_diff(time.ticks_ms(), t)
    time.sleep_ms(left if left > 0 else 1)


def wait(want):
    keys.pressed()
    while True:
        t = time.ticks_ms()
        for k in keys.pressed():
            if k in want:
                return k
        pace(t)


def betting():
    """Pick the bet. Returns when green deals."""
    if st["chips"] < 5:
        ui.page(d, "Out of chips", [("Here's 100 more.", ui.INK)], "{g} play")
        wait(("A",))
        st["chips"] = 100
        save.store("chips", 100)
    st["bet"] = max(5, min(st["bet"], st["chips"]))
    while True:
        d.fill(FELT)
        d.center_text("Blackjack", 20, TXT, 3)
        d.center_text("chips", 70, DIM)
        d.center_text(str(st["chips"]), 84, TXT, 3)
        d.center_text("bet", 124, DIM)
        d.center_text(str(st["bet"]), 138, TXT, 3)
        d.center_text("joystick: bet", 172, DIM)
        d.center_text("shuffled by " + st["src"], 190, DIM)
        ui.say(d, "{g} deal", 220, TXT, 2)
        d.show()
        k = wait(("A", "up", "down", "left", "right"))
        if k == "A":
            return
        step = 5 if k in ("up", "right") else -5
        st["bet"] = max(5, min(st["chips"], st["bet"] + step))


def settle(win, pays=1):
    """win: 1 you, 0 push, -1 dealer. Sets the message and the chips."""
    st["hide"] = False
    gain = int(st["bet"] * pays) if win > 0 else -st["bet"] if win < 0 else 0
    st["chips"] += gain
    if pays != 1 and win > 0:
        st["msg"] = "Blackjack +%d" % gain
    elif win > 0:
        st["msg"] = "You win +%d" % gain
    elif win < 0:
        st["msg"] = st["msg"] or "Dealer wins"
    else:
        st["msg"] = "Push"
    save.store("chips", st["chips"])
    table("{g} next hand")
    wait(("A",))


def hand():
    shuffle()
    you[:] = [draw_card(), draw_card()]
    dealer[:] = [draw_card(), draw_card()]
    st["hide"], st["msg"] = True, ""
    bet0 = st["bet"]
    try:
        if total(you) == 21 or total(dealer) == 21:
            if total(you) == 21 and total(dealer) == 21:
                return settle(0)
            if total(you) == 21:
                return settle(1, 1.5)
            st["msg"] = "Dealer 21"
            return settle(-1)
        while True:
            can2 = len(you) == 2 and st["chips"] >= 2 * st["bet"]
            table("{g} hit  {r} stand" + ("  {k} x2" if can2 else ""))
            k = wait(("A", "Y", "B", "X") if can2 else ("A", "Y"))
            if k in ("B", "X"):
                st["bet"] *= 2
                you.append(draw_card())
                break
            if k == "Y":
                break
            you.append(draw_card())
            if total(you) > 21:
                st["msg"] = "Bust"
                return settle(-1)
            if total(you) == 21:
                break
        if total(you) > 21:
            st["msg"] = "Bust"
            return settle(-1)
        st["hide"] = False
        table("")
        while total(dealer) < 17:
            time.sleep_ms(600)
            dealer.append(draw_card())
            table("")
        time.sleep_ms(400)
        y, dl = total(you), total(dealer)
        if dl > 21:
            st["msg"] = "Dealer busts"
            settle(1)
        else:
            settle(1 if y > dl else -1 if y < dl else 0)
    finally:
        st["bet"] = bet0
        st["chips"] = int(st["chips"])


def run():
    st["chips"] = save.load("chips", 100)
    bar = ui.progress("Blackjack", "the secure chip")
    st["src"] = rand_source().split(" (")[0]
    if bar:
        bar.to(1)
    while True:
        betting()
        hand()
