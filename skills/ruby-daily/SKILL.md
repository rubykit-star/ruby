---
name: ruby-daily
description: Write today's on-chain note for the user's Robinhood Chain wallets in their Ruby vault, then summarize what changed. Use when the user asks for their daily wallet note, what changed in their wallet, or to update their Ruby vault.
---
# Ruby daily

1. In the Ruby vault folder, run `npx -y github:rubykit-star/ruby daily`. It reads `ruby.json` and writes `Daily/<date> <label>.md` per wallet. For a wallet not in `ruby.json`, run `npx -y github:rubykit-star/ruby daily 0x… --label name`.
2. Read each new note. Report in a few lines: total value in USDG and the change since the previous note, the largest holdings, and every transfer in the last 24 hours.
3. Ask the user for one line about why anything moved, and add it under **Notes** in that day's file.

Rules
- Ruby is read only. Never ask for a private key or seed phrase, and never sign anything.
- Use only the numbers in the note. Do not guess prices or add opinions about what to buy.
- Native ETH transfers are not in the note; say so if the user asks about them.
