---
name: laytime-check
description: Work out a laytime statement (time allowed, time used, demurrage or despatch) from charter-party terms and a statement of facts, with every figure shown and nothing assumed. Use when the user gives laytime terms, a NOR, an SOF or stoppages and asks for laytime, demurrage, despatch or a time sheet, or asks to check someone else's laytime calculation.
---

# laytime-check

`laytime.mjs` turns a voyage file (JSON) into a laytime statement: each step is worked from the inputs, and an
input that decides a figure but is missing gives NULL, never a default.

## Building the voyage file

Take each value from the charter party, the recap or the SOF, and keep a note of where it came from.

| field | from | notes |
|---|---|---|
| `quantity`, `rate_per_day` | CP / B/L | or `allowed_hours` if the CP states time, not a rate |
| `terms` | CP | SHINC, SHEX, SSHEX, FHEX; or `excepted_weekly` for a CP's own window, e.g. Sat 12:00 to Mon 08:00 |
| `holidays` | port calendar | excepted unless the terms are SHINC (`holidays_excepted: true` to override) |
| `unless_used`, `used` | CP / SOF | "unless used": the periods worked on excepted days; leave `used` out and the result is NULL |
| `nor_tendered` + `commencement` | SOF / CP | `{"rule":"turn_time","hours":12}` or `{"rule":"gencon_noon"}`; or `laytime_commenced` directly |
| `stoppages` | SOF + CP | only those the CP excepts; `count_fraction` for pro rata (3 of 4 cranes = 0.75); `on_demurrage: true` only if the CP also stops demurrage for it |
| `completed` | SOF | |
| `demurrage_rate_per_day`, `despatch_rate_per_day` | CP | never assume despatch is half demurrage |
| `despatch_basis` | CP | `laytime_saved` (default) or `all_time_saved` |

Times are port local, `YYYY-MM-DDTHH:MM`, no offset.

## Running it

```sh
node <skill-dir>/laytime.mjs voyage.json --sheet     # statement + full time sheet
node <skill-dir>/laytime.mjs voyage.json --json      # for another program
```

Exit codes: `0` complete · `2` a NULL (name the missing input to the user) · `3` invalid input.

## What to tell the user

- Give the result with its steps, and which document each input came from.
- Where the charter party is unclear or the SOF can be read two ways (was the NOR valid? does this stoppage count?
  is that clause excepting demurrage too?), **run both readings and show both results.** Do not pick one: that is
  for the parties.
- Never fill a missing rate, quantity or time to get a number. Say what is missing.
- Say that the figures are worked from the inputs given and are not a legal opinion.
