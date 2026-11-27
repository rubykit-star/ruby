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
| `ruby pool <pair \| v4 pool id>` | Facts about a pool: a DLMM (liquidity book) pair address gives tokens, bin step, active price, reserves, bins and fees; a Uniswap V4 pool id gives the pool key, hook (named from Sourcify), price from slot0, the liquidity active at this price, and the last 24 hours of swaps |
| `ruby locker <token>` | For a Pons launch graduated to Uniswap V4: whether the launch locker owns the position NFT, that position's share of the pool's liquidity, the token supply locked, and any function in the locker's verified ABI that could move them out |
| `ruby lend [wallet]` | Lending on Robinhood Chain, read from the contracts: the Aave V3 market (assets, LTV, supplied, borrowed, rates, price feeds and their last update) and Morpho (markets lending the real USDG, matched by address). With a wallet: its positions, health factor and the price drop that would reach liquidation. Ruby lends nothing |
| `ruby flow [poolId] [count]` | The latest swaps in a Uniswap V4 pool, newest first: buy or sell, amounts, time in UTC and the wallet behind each one, read from the token transfers in the same transaction (the Swap event only names the router). Each wallet is labelled from the chain: wallet, 7702 smart wallet, contract, the pool's hook, or a high-volume sender. Defaults to the RUBY pool |
| `ruby replicate <token> "<claims>"` | Re-run claims about a token against the chain, one verdict per claim: replicated, not replicated or can't check. Reads the launch locker, holder shares (from every Transfer log, confirmed again with `balanceOf`), a wallet's balance, burn, supply, holder count, direct transfers between top holders and Sourcify, all at one pinned block. Writes a plain-text certificate and its sha256, ready to record with `ruby proof` |
| `ruby gpu <endpoint\|payee> [wallet]` | Ruby GPU Spend: what is spent on a GPU network (or any per-call API) over the last 7 days, from the chain. Give its x402 endpoint (Ruby reads the 402 offer for the payee and price) or the payee address: paid calls per day, x402 settlements, USDG, payers, price per call, biggest payers. With a wallet, what that wallet spent there, with a warning on bursts. Payments with prepaid credits or other tokens are not visible |
| `ruby agent "<task>"` | Ruby Agent: an AI agent in your terminal that answers a task about Robinhood Chain by calling Ruby's read-only tools one after another (flow, replicate, GPU spend, locker, holders, pool, lend, block, proof check), then writes the answer and every step as a note. Uses your own OpenRouter key from `OPENROUTER_API_KEY` (never stored or printed); `--model` picks the model (default `openrouter/free`), `--steps` caps the tool calls. It cannot sign or move anything |
| `ruby playbook [name] [token]` | Saved tasks that write a report note, compared with the last run. Built in: `ruby playbook token RUBY` (Ruby Lens facts, the locker claim re-run, the latest swaps, what changed). Add your own in `ruby.json` under `"playbooks"`. `--every 24h` repeats it; `--ai` adds a summary by Ruby Agent with your own key. No key needed otherwise. |
| `ruby lens [token] [--net elysium\|solana]` | Ruby Lens on Robinhood Chain (default), Elysium or Solana. Robinhood Chain: the latest Pons launches (buys, sells, traders, the creator's buy, progress to the curve's ETH target), or every fact Ruby can read about one token, as a note |
| `ruby radar` | A note of the latest Pons launchpad launches: dev buy, what the creator holds now and sold, buys and sells, traders, ETH in the curve |
| `ruby mcp` | A memory server for AI agents (MCP over stdio): `ruby_radar`, `ruby_clip`, `ruby_pool`, `ruby_locker`, `ruby_lend`, `ruby_flow`, `ruby_replicate`, `ruby_gpu`, `ruby_lens_new`, `ruby_lens_check`, `ruby_daily`, `ruby_remember`, `ruby_recall`, `ruby_read`, `ruby_seal_prepare`, `ruby_verify`, `ruby_proof_prepare`, `ruby_proof_check` |
| `ruby footprint` | What the public can read about a wallet: counterparties, active hours, holdings, open approvals (last 30 days, `--days` to change) |
| `ruby lock` / `ruby unlock` | Encrypt or decrypt every note with a password (AES-256-GCM, scrypt key), on your machine |
| `ruby watch` | Follow wallets and tokens live: launches they create, launchpad trades, the creator selling, big moves, burns. Logs to `Watch/<date>.md` |
| `ruby x402` | Every USDG transfer-by-signature (EIP-3009, the way x402 settles) on Robinhood Chain: payments, volume, top payees, the small API-sized ones. Writes `X402/<time>.md` |
| `ruby seal` / `ruby verify` | Prove a note is unchanged since a block: its SHA-256 sent on chain from your own wallet |
| `ruby proof` / `ruby proof-check` / `ruby proofs` | Ruby Proof: record on Robinhood Chain that an answer (often an AI's) was made from a source note read at a given block, as hashes only, from your own wallet; find proofs of an answer; list every proof. Contract `0x0cc3335d87c21ba7b6bdadb79f356a05c13fba02`, verified on Sourcify (exact match), no owner, not audited |
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

### One URL, nothing to install

Ruby runs as a hosted MCP server at **`https://ruby-mcp.vercel.app/mcp`** (Streamable HTTP, read only: no key, no signing, no fee). Eleven tools: `ruby_block`, `ruby_lens_new`, `ruby_lens_check` (both take `network`: robinhood, elysium or solana), `ruby_flow`, `ruby_replicate`, `ruby_gpu`, `ruby_locker`, `ruby_holders`, `ruby_pool`, `ruby_lend`, `ruby_proof_check`.

```
claude mcp add --transport http ruby https://ruby-mcp.vercel.app/mcp
```

Cursor (`~/.cursor/mcp.json`): `{ "mcpServers": { "ruby": { "url": "https://ruby-mcp.vercel.app/mcp" } } }`
VS Code (`.vscode/mcp.json`): `{ "servers": { "ruby": { "type": "http", "url": "https://ruby-mcp.vercel.app/mcp" } } }`
Claude: Settings → Connectors → Add custom connector → paste the URL.

The hosted server is `api/mcp.mjs` in this repository. It allows 60 calls a minute per address; for more, or for the vault tools (notes, memory, seal, proof), run Ruby locally as below.

### Run it locally

Add Ruby as an MCP server, for example in Claude Desktop's config:

```json
{ "mcpServers": { "ruby": { "command": "npx", "args": ["-y", "github:rubykit-star/ruby", "mcp", "--vault", "/path/to/my-vault"] } } }
```

Claude Code:

```
claude mcp add ruby -- npx -y github:rubykit-star/ruby mcp --vault /path/to/my-vault
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.ruby]
command = "npx"
args = ["-y", "github:rubykit-star/ruby", "mcp", "--vault", "/path/to/my-vault"]
```

### Sealing what an agent remembers

`ruby_seal_prepare` returns a note's SHA-256 and the exact seal data. It signs and sends nothing: you send the seal from your own wallet (rubykit.cc/seal simulates it first). `ruby_verify` then checks the note against that transaction on Robinhood Chain mainnet and writes a `Seals/` note when it matches. Paths outside the vault are refused.

### What Ruby does not do

- No scores, ratings, predictions, or buy and sell advice. It never calls a token safe.
- It never holds or asks for a private key or seed phrase.
- No Ruby server receives your notes.
- A seal proves a note is unchanged since a block, not that what it says is true.

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
