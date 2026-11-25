---
name: ruby-check-token
description: Check a Robinhood Chain token from its contract address and write a fact note in the user's Ruby vault. Use when the user pastes a token contract address, asks whether a token is legit, or asks who holds or minted it.
---
# Ruby check token

1. Run `npx -y github:rubykit-star/ruby clip 0x…` in the Ruby vault folder. It writes `Tokens/<symbol> <address>.md`.
2. Read the note and report only what it shows: source verified or not, owner, who sent the first mint and through which contract, supply and burns, holder count and the top holders' shares, and whether a DEX route exists.
3. Point out facts worth checking, plainly: an unverified contract, an owner that is not renounced, one address holding a large share, no DEX route. Explain what each means without calling the token safe or unsafe.
4. Offer to start a research note from `Templates/Research.md` that links the clip.

Rules
- No price predictions and no buy or sell advice.
- If the address has no contract code, say so and stop.
