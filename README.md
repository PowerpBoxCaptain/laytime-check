# laytime-check

**A laytime statement you can follow line by line.**

Laytime disputes are rarely about arithmetic and often hide in it: a Sunday counted after demurrage began, a
crane breakdown treated as a full stop when the clause says pro rata, despatch quietly taken as half demurrage.
`laytime-check` works a statement from the charter-party terms and the statement of facts, shows every step, and
refuses to fill a gap: a missing rate, quantity or time gives **NULL**, naming what is missing.

```
$ node laytime.mjs example-voyage.json --sheet
LAYTIME STATEMENT  MV EXAMPLE STAR  discharge, example port  (SHEX, once on demurrage always on demurrage)
 1. time allowed: 42000 / 8000 per day = 5.25 days = 5d 06h 00m (126 h)
 2. laytime commenced: NOR 2026-06-01 09:20 Mon + turn time 12 h = 2026-06-01 21:20 Mon
 3. time used: 6d 05h 40m counted between 2026-06-01 21:20 Mon and 2026-06-09 16:30 Tue (7d 19h 10m elapsed)
 4. laytime expired: 2026-06-08 16:50 Mon; time on demurrage 0d 23h 40m = 23.6667 h
 5. demurrage: 0.986111 days x 18000 USD per day = 17750.00 USD, due to owners

TIME SHEET (port local)
  2026-06-01 21:20 Mon  to  2026-06-03 14:00 Wed    1d 16h 40m  laytime   x1      counts
  2026-06-03 14:00 Wed  to  2026-06-03 19:30 Wed    0d 05h 30m  laytime   x0      rain, hatches closed
  2026-06-03 19:30 Wed  to  2026-06-04 08:00 Thu    0d 12h 30m  laytime   x1      counts
  2026-06-04 08:00 Thu  to  2026-06-05 08:00 Fri    1d 00h 00m  laytime   x0.75   crane no.2 breakdown, 3 of 4 working (counts 0.75)
  2026-06-05 08:00 Fri  to  2026-06-07 00:00 Sun    1d 16h 00m  laytime   x1      counts
  2026-06-07 00:00 Sun  to  2026-06-08 00:00 Mon    1d 00h 00m  laytime   x0      SHEX excepted
  2026-06-08 00:00 Mon  to  2026-06-08 10:00 Mon    0d 10h 00m  laytime   x1      counts
  2026-06-08 10:00 Mon  to  2026-06-08 12:00 Mon    0d 02h 00m  laytime   x0      ship's gear breakdown (excepted on demurrage too)
  2026-06-08 12:00 Mon  to  2026-06-08 16:50 Mon    0d 04h 50m  laytime   x1      counts
  2026-06-08 16:50 Mon  to  2026-06-09 16:30 Tue    0d 23h 40m  demurrage x1      counts

RESULT: ON DEMURRAGE  17750.00 USD
```

(A made-up voyage: see `example-voyage.json`.)

## What it handles

- Time allowed from quantity and rate per day, or stated hours.
- Commencement: NOR + turn time, the GENCON 1994 cl.6(c) noon rule, or a time you state.
- SHINC, SHEX, SSHEX, FHEX, port holidays, your own weekly excepted window (e.g. Sat 12:00 to Mon 08:00),
  "unless used" with the periods actually worked.
- Stoppages that stop the clock, or count pro rata (3 of 4 cranes working = 0.75). Where stoppages overlap, the
  one that stops the most time governs.
- Once on demurrage, always on demurrage, except stoppages you mark as also excepted from demurrage. Can be
  switched off.
- Demurrage and despatch, despatch on laytime saved or all time saved. Laytime that runs out inside a minute is
  split exactly.

## What it does not decide

Whether a NOR was valid, whether a stoppage is excepted, whether a clause also covers demurrage, which reading of
a disputed SOF entry is right. Give it each reading and compare the statements. It is arithmetic, not a legal
opinion. Times are port local; a voyage that crosses a clock change needs the times written in one local time.

## Use

```sh
git clone https://github.com/PowerpBoxCaptain/laytime-check ~/.claude/skills/laytime-check    # as a Claude Code skill
node laytime.mjs voyage.json [--sheet] [--json]                                     # Node 18+, no dependencies
```

Exit codes: `0` complete statement · `2` a NULL (an input is missing) · `3` invalid input.

## Tests

`node test.mjs` runs 32 voyages whose expected figures are worked by hand in the test file: SHINC, SHEX, SSHEX
noon rule, holidays, custom weekends, unless used, rain, pro-rata cranes, once on demurrage (on and off), gear
excepted on demurrage, despatch on both bases, expiry inside a minute, every NULL, and invalid input.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
