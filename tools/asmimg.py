# Packs the /assemble images: drawings (gpt-image-2.5-sunburst, one per step, made from Austin's photos)
# and the photos themselves (clawd-pico-case/assembly/photos) into public/img/assemble/.
#   python3 tools/asmimg.py <drawings dir with sNN.png> <photos dir>
import sys, glob, os
from PIL import Image, ImageChops
draws, photos = sys.argv[1], sys.argv[2]
out = "public/img/assemble"
for d in ("", "/p", "/t"): os.makedirs(out + d, exist_ok=True)
for f in sorted(glob.glob(draws + "/s??.png")):
    im = Image.open(f).convert("RGB")
    bg = Image.new("RGB", im.size, im.getpixel((4, 4)))
    box = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 18 else 0).getbbox()
    if box:  # trim the empty paper, keep a margin
        m = 40; im = im.crop((max(0, box[0] - m), max(0, box[1] - m), min(im.width, box[2] + m), min(im.height, box[3] + m)))
    im.thumbnail((900, 1100)); im.save(f"{out}/d{os.path.basename(f)[1:3]}.webp", quality=82, method=6)
for f in sorted(glob.glob(photos + "/*.jpg")):
    n = os.path.basename(f)[:-4]; im = Image.open(f).convert("RGB")
    big = im.copy(); big.thumbnail((1100, 1100)); big.save(f"{out}/p/{n}.webp", quality=70, method=6)
    w, h = im.size; s = min(w, h); t = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((160, 160))
    t.save(f"{out}/t/{n}.webp", quality=74, method=6)
