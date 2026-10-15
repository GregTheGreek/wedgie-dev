#!/usr/bin/env python3
"""wedgie@buidlguidl.com from the command line (Gmail IMAP + SMTP, the app password).
Creds: SHOP_MAIL_USER / SHOP_MAIL_PASS in .env or ~/.wedgie-credentials.env. 2-Step codes: python3 ~/.wedgie-totp.py

  python3 tools/mail.py list [n]            newest n in the inbox (default 10)
  python3 tools/mail.py read <id>           one message, as plain text
  python3 tools/mail.py send <to> <subject> body from stdin
"""
import email, email.policy, imaplib, os, re, smtplib, sys
from email.message import EmailMessage

env = {}
for f in (os.path.expanduser("~/.wedgie-credentials.env"), os.path.join(os.path.dirname(__file__), "..", ".env")):
    if os.path.exists(f): env.update(re.findall(r"^([A-Z_]+)=(.*)$", open(f).read(), re.M))
USER, PASS = env.get("SHOP_MAIL_USER", "wedgie@buidlguidl.com"), env["SHOP_MAIL_PASS"]


def inbox():
    m = imaplib.IMAP4_SSL("imap.gmail.com")
    m.login(USER, PASS)
    m.select("INBOX", readonly=True)
    return m


def get(m, i):
    return email.message_from_bytes(m.fetch(i, "(RFC822)")[1][0][1], policy=email.policy.default)


cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
if cmd == "list":
    m = inbox()
    for i in reversed(m.search(None, "ALL")[1][0].split()[-int(sys.argv[2] if len(sys.argv) > 2 else 10):]):
        h = email.message_from_bytes(m.fetch(i, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")[1][0][1], policy=email.policy.default)
        print(f"{i.decode():>5}  {h['date']}  {h['from']}\n       {h['subject']}")
elif cmd == "read":
    msg = get(inbox(), sys.argv[2].encode())
    print(f"From: {msg['from']}\nTo: {msg['to']}\nDate: {msg['date']}\nSubject: {msg['subject']}\n")
    body = msg.get_body(("plain", "html"))
    print(body.get_content() if body else "(no text body)")
elif cmd == "send":
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = f"wedgie <{USER}>", sys.argv[2], sys.argv[3]
    msg.set_content(sys.stdin.read())
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(USER, PASS)
        s.send_message(msg)
    print("sent")
else:
    print(__doc__)
