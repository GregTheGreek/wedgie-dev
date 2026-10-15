# Plan: a PIN the chip checks (Trust M V1)

Our wedgies have a Trust M **V1**. It has no PIN feature (that's V3). Today any code on the RP2040 can
sign with the Safe key (`KEY2`, E0F2). A thief can flash firmware and sign.

**The idea:** set `KEY2` to sign only over a shielded connection (`Conf(E140)`). The link's secret
(E140) is made from a PIN typed on the wedgie, never saved on the board. No PIN, no signature, even
under fake firmware.

Untested, and not an Infineon pattern. Steps 1–4 are safe. From step 5 on: **spare board only**, it
can lock things for good.

## To do

1. [ ] **Read the chip** (read-only, any board). UID E0C2 bytes 25–26 (`08 09` = V1 1.30.809),
   metadata of E140 and E0F2, SEC counter (E0C5). Write the results here.
2. [ ] **Shielded connection in `firmware/optiga.py`.** Handshake + record protection from the IFX I2C
   protocol v2.03, §6.3.5 (TLS PRF "Platform Binding"). Check RAM with `tools/chipprobe.mjs`.
3. [ ] **Test the link on a spare board** with a test secret in E140. Read, sign, verify on the computer.
4. [ ] **Wrong secret:** handshake fails? What error? Time 1000 wrong tries, read SEC before and
   after. Does the chip slow down? This decides the PIN length.
5. [ ] **Lock the key (spare board, permanent).** `KEY2` execute rule (D3) = `Conf(E140)`. Then:
   - sign with no link → refused (0x07)?
   - sign over the link, right secret → works?
   - sign over the link, wrong secret → refused?
6. [ ] **Lock the rules.** `KEY2` change rule = never. E140: change only over the link (= change PIN),
   read never. Check a thief can't rewrite either.
7. [ ] **Sniffing.** One recorded handshake lets someone guess the PIN on a computer. Measure a slow
   PIN-to-secret step on the RP2040 (seconds per try is fine). Pick PIN length from steps 4 and 7.
8. [ ] **Change PIN** over the link, old PIN stops working.
9. [ ] **Forgot PIN** = make a new key. Say so on screen. The wedgie should be one of two Safe signers.
10. [ ] **Screens:** set PIN, type PIN, change PIN. Few words, big text (`docs/STYLE.md`).
11. [ ] **Go / no-go.** If wrong guesses aren't slowed and the slow step is too slow, stop here.

## Sources

- Solution Reference Manual v3.70, "Access Conditions": V1 has no `Auto(X)` (the V3 PIN).
  https://github.com/Infineon/optiga-trust-m-overview
- IFX I2C protocol v2.03 §6.3.5 (shielded connection handshake).
- `docs/PLAN-TRUST.md` Phase 3.
