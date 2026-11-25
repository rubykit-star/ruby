---
type: home
tags: [ruby]
---
# Ruby

Your on-chain second brain for Robinhood Chain. Every note here is a plain Markdown file you own.

## Every day
- Run `ruby daily` in this folder. It writes `Daily/<date> <wallet>.md` for every wallet in `ruby.json`.
- Read what changed, then write one line under **Notes**: why you moved, what you're watching.

## Before you buy
- Run `ruby clip 0x…` with the token's contract address. It writes `Tokens/<symbol> <address>.md`: verified or not, who minted it, supply, burns, holders, price.
- Nothing in a clip is an opinion. Open every link and check.

## Launches
- Run `ruby radar` for a note of the latest launchpad launches: dev buy, dev holdings and sales, buys and sells, traders.

## Your AI
- Run `ruby mcp` as an MCP server. Your agent can clip, write daily and radar notes, remember and recall, all in this vault.

## Folders
- [[Daily/]] daily wallet notes, one per wallet per day
- [[Wallets/]] one note per wallet you follow: who it is, why you follow it
- [[Tokens/]] token fact notes from `ruby clip`
- [[Research/]] your own theses and write-ups
- [[Radar/]] launch radar notes
- [[Memory/]] what your AI agent chose to remember
- [[Canvas/]] maps of how tokens and wallets connect
- [[Templates/]] note templates

Ruby is read only. It never signs anything and never asks for a key.
