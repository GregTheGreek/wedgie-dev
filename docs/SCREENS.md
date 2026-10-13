# Other screens

The wedgie is built for the Waveshare **Pico-LCD-1.3** (240x240 color). That stays the default.
Other screens can be added without making the LCD wedgie any bigger: their code sits in its own
files and loads only on a wedgie that has that screen.

## Pico-OLED-1.3 (Waveshare, 128x64, white)

Same pins as the LCD. Two keys on the right edge:

| key | pin | means |
|---|---|---|
| KEY1 (top) | GP17 | yes (green) |
| KEY0 (bottom) | GP15 | no (red) |

**Turn it on:** put an empty file named `oled` on the wedgie (after a yes to full control):

    mpremote resume exec "open('oled','w').close()"

Then restart it. No file = the LCD. A wedgie can't tell the two screens apart by itself yet, so it
never guesses.

What works: the home screen, every yes/no question, the busy screen (text, no bar), "wedgie broke",
full control. What doesn't yet: the boot logo and bar, screenshots, sleep on battery, and apps
drawn for 240x240 (they get cut off; an app checks `d.width` to draw a small layout).

Files: `firmware/oled.py` (the driver: same framebuffer, lights every pixel darker than near-white),
`firmware/small.py` (the system screens at 128x64). The hooks: `lcd.py` (the `oled` file), `splash.py`
(skips the LCD logo), and a `d.width < 240` line in `ui.page`, `ui.ask`, `loader.screen`,
`loader.what`, `slot.empty`, `hatch.shown`.

## Adding another screen

1. A driver file like `oled.py`: an `LCD` class (a `framebuf.FrameBuffer` with `width`, `height`,
   `show()`, `show_rect()`, `backlight()`, `big_text`, `center_text`) and `KEYS` (`"A"` = yes, `"Y"` = no).
2. A flag file and two lines in `lcd.py` that import it.
3. If it isn't 128x64, `small.py`'s layouts may need its size.
