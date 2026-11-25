# Ruby Brain Kit

An on-chain second brain for **Robinhood Chain**. Ruby writes plain Markdown notes about your wallets and the tokens you look at, straight from the chain. Open them in any Markdown editor, keep them in git, or hand them to your AI.

Read only: Ruby never signs anything and never asks for a key (Seal is the one exception, sent from your own wallet).

Website: https://rubykit.cc

## What's in the kit

| Part | What it does |
| --- | --- |
| `vault/` | A ready vault: Daily, Wallets, Tokens, Radar, Watch, X402, Memory, Privacy, Seals, Research, Canvas, Templates |
| `ruby daily` | Today's note for each wallet: balances, value in USDG, the last 24 hours of token transfers, change since the last note |
| `ruby clip` | A fact note for a token from its contract address: verified or not, owner, first mint, supply and burns, holders, price |
| `ruby radar` | A note of the latest Pons launchpad launches: dev buy, what the creator holds now and sold, buys and sells, traders, ETH in the curve |
| `ruby mcp` | A memory server for AI agents (MCP over stdio): `ruby_radar`, `ruby_clip`, `ruby_daily`, `ruby_remember`, `ruby_recall`, `ruby_read` |
| `ruby footprint` | What the public can read about a wallet: counterparties, active hours, holdings, open approvals (last 30 days, `--days` to change) |
| `ruby lock` / `ruby unlock` | Encrypt or decrypt every note with a password (AES-256-GCM, scrypt key), on your machine |
| `ruby watch` | Follow wallets and tokens live: launches they create, launchpad trades, the creator selling, big moves, burns. Logs to `Watch/<date>.md` |
| `ruby x402` | Every USDG transfer-by-signature (EIP-3009, the way x402 settles) on Robinhood Chain: payments, volume, top payees, the small API-sized ones. Writes `X402/<time>.md` |
| `ruby seal` / `ruby verify` | Prove a note is unchanged since a block: its SHA-256 sent on chain from your own wallet |
| `skills/` | Three skills for Claude: daily note, check a token, weekly review |

## Start

```
npx -y github:rubykit-star/ruby init my-vault
cd my-vault
```

Put your wallet in `ruby.json`:

```json
{ "wallets": [{ "address": "0x…", "label": "main" }], "watch": [] }
```

Then:

```
npx -y github:rubykit-star/ruby daily
npx -y github:rubykit-star/ruby clip 0x…token
npx -y github:rubykit-star/ruby radar
```

## Your AI

Add Ruby as an MCP server, for example in Claude Desktop's config:

```json
{ "mcpServers": { "ruby": { "command": "npx", "args": ["-y", "github:rubykit-star/ruby", "mcp", "--vault", "/path/to/my-vault"] } } }
```

Your agent can then read the chain, write notes into the vault and recall them later. Notes it saves go to `Memory/`. It can only read files inside the vault.

`watch` takes extra token addresses to include in daily notes. Set `RUBY_RPC` to use another Robinhood Chain RPC.

## Where the data comes from

- Balances, transfers, supply, mints and holders: Robinhood Chain mainnet JSON-RPC.
- Prices: live KyberSwap quotes of 1,000 USDG on Robinhood Chain.
- Source verification: Sourcify.
- Launches and trades: the Pons launchpad factory's launch events and each bonding curve's buy and sell events.

A clip lists facts with links to check each one. It gives no score and no advice. Holders are rebuilt from transfer logs and skipped for tokens with more than 30,000 transfers. Daily notes do not list native ETH transfers.

## Skills

Copy a folder from `skills/` into your Claude skills folder (for Claude Code: `~/.claude/skills/`). Then ask "write my daily note" or paste a token address.

## Protocol

The note, seal and lock formats are written down in [PROTOCOL.md](PROTOCOL.md), so any tool can read Ruby notes and check Ruby seals without Ruby.

## License

MIT
