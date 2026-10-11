# Plan: a writable WEDGIE drive, done right (2026-10-11)

Goal: a phone (or a desktop app, or a web page) sends requests by writing files on the WEDGIE drive. Plug
in, it connects by itself. The only press is the green button on the wedgie for anything that signs or moves
money. A desktop never says "Disk Not Ejected Properly". As few waits and prompts as possible.

## What stays true (the security)

1. **Every signature and every install needs a real press on the wedgie.** Not changed. It's in the
   request handler, the same for serial and files.
2. **Files can't do more than USB serial.** Any computer can already send every request over serial without
   asking. The drive is a second way in for the same requests, never a bigger one. The dangerous ones (`open`,
   full control) still ask in red. A test checks the file path and the serial path go through the same handler.
3. **Nothing written to the drive reaches flash.** Writes live in RAM (12 sectors) and are gone at unplug.
4. **A bad file can't crash it.** Fuzz the FAT/inbox parser in the release gate (wrong sizes, loops in the
   FAT, huge files, garbage).

## What goes (it didn't make sense)

- **The "Allow phone txns?" question.** It protects nothing (point 2: serial never asked). It was there only
  because the drive goes writable, and a writable drive makes a Mac warn. One press and one wait less on
  every plug-in.
- **The 8 s quiet window.** It only covered a Mac's reads at mount; Windows Defender or a Linux indexer can
  read any time. It cost every phone 8 s. The new trigger doesn't need it.
- **Timing-based knock** (two reads of PHONE.TXT 0.7-10 s apart). Replaced by an order no scanner makes.

## The trigger: read B, A, B

- The drive has two tiny hidden files at its top: `KNOCKA.TXT`, `KNOCKB.TXT` (A before B in the folder and
  on disk). Each file's text says what it's for, so an AI reading the drive learns it there.
- **Read B, then A, then B, within 3 s → the drive turns writable.** No question.
- Why it's safe from desktops: a scanner reads each file once, in folder order (A then B), and through the OS
  cache (a second read of B never reaches the wedgie). B-A-B needs uncached reads in reverse order. Only
  something doing it on purpose does that.
- If something does trigger it by accident: that computer gets a writable drive and an eject warning once.
  No security cost (point 2).
- No time window after plug-in. A trigger at any time works.

## Turning writable

- On the trigger: writable, USB off, then on, so the phone remounts it writable (an iPhone kept its read-only
  mount through a SCSI media change and a 0.4 s drop; 2 s works). **Measure the shortest drop an iPhone
  accepts** (try 1.0 and 1.5 s) and use that.
- The phone icon shows in the screen's corner while writable, until unplug.
- Next plug-in starts read-only again (desktops never see it writable).

## Faster requests

- **Free a request's RAM as soon as the wedgie has read it**, not when the host deletes it. Today a deleted
  file frees only once iOS writes the delete out and 2 s have passed, so a big transaction's pieces must go
  2.2 s apart, and the third piece failed until we worked around it. With this, pieces go as fast as the
  answers come back (~1 s each). The host still deletes old REQ files, but nothing waits on it.
- Try `SETTLE` 0.3 s (now 0.7 s: how long the host must be quiet before a file is read).

## The phone (Instant Wallet app, wedgie app)

- App in front + WEDGIE drive read-only → read B, A, B (uncached) right away, again every 2 s until writable.
  No panel, no tap, no "Press green" for connecting. The wedgie button just turns green.
- While new and old firmware are both out there, also do the old knock (PHONE.TXT twice). Old firmware still
  asks its question, so the app shows "Press green on your wedgie" only when the drive stays read-only
  for 10 s.
- The drive picker stays (iOS needs it once). After that: plug in → connected in about 4-7 s, no taps
  (iOS mount 2-4 s, the drop 1-2 s, the remount 1-2 s).
- Signing: the bottom bar ("Sending it to your wedgie" → "Press the green button on your wedgie").

## Desktops

- Never writable by themselves → never the eject warning.
- A desktop app, or a web page in Chrome (File System Access: pick the WEDGIE folder), can do B-A-B and send
  requests by file without serial. That one gets the eject warning at unplug; it should tell its person to
  eject. Serial stays the better path on a desktop.

## Later, maybe

- **Tell an iPhone apart at USB connect** (the order and kinds of setup requests differ per OS). If it's
  reliable, the drive could be writable from the start for iPhones: no trigger, no drop, ~2 s faster. Log the
  setup requests from Mac, Windows, Linux, iPhone, iPad first. Fragile across iOS updates; B-A-B stays.
- **A second drive (LUN) for requests** that has "no disk" until triggered: might skip the drop. But it's a
  second volume, so the phone would have to pick a second folder. Not worth it now.

## Steps

1. Firmware 0.3.40: B-A-B trigger, no question, no 8 s window, RAM freed on read, shortest working drop.
   test_drive: B-A-B turns writable; A-B, A-B-A-B in folder order, a full scan, and cached repeats don't.
   Parser fuzz in the gate. skill.md + the drive's SKILL.md. Sign.
2. Real boards: Mac (10 plug-ins, Finder browsing, Quick Look: never writable, no warning), Windows
   (Defender scan: never writable), iPhone (connects with no tap; a big transaction streams).
3. Instant Wallet app + site, wedgie app + /safe: B-A-B, auto-connect, old knock as a fallback, no panel
   for connecting, pieces without the 2.2 s gap on 0.3.40+ (hello's `version`).
4. Measure plug-in to connected, and a big transaction's time. Write the numbers here.
