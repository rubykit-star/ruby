# Ruby Protocol · v0.1

The open rules Ruby follows, so any tool or AI can read Ruby notes and check Ruby seals without Ruby.

## 1. Notes

A note is a UTF-8 Markdown file that starts with YAML frontmatter between `---` lines. Values are JSON literals (strings in double quotes, numbers, arrays). Every note has `type` and `tags`. Readers ignore keys they do not know.

| type | folder | keys |
| --- | --- | --- |
| `token` | `Tokens/` | symbol, name, address, chain, decimals, total_supply, burned_pct, holders, verified, first_block, price_usdg, clipped, block |
| `daily` | `Daily/` | date, wallet, label, total_usdg, change_usdg, transfers_24h, block, chain |
| `radar` | `Radar/` | taken, block, launches, chain, source |
| `footprint` | `Privacy/` | wallet, taken, block, days, transactions_sent, token_transfers, counterparties, open_approvals, chain |
| `pool` | `Pools/` | DLMM: pair, token_x, token_y, symbol_x, symbol_y, bin_step, active_id, price, base_fee_pct, reserve_x, reserve_y, tvl_usdg, swaps_24h, volume_24h_usdg, fees_24h_usdg, verified, code_verified, block, chain · V4: dex "uniswap-v4", pool_id, token_x, token_y, symbol_x, symbol_y, tick_spacing, tick, price, fee, hooks, liquidity, swaps_24h, volume_24h_usdg, block, chain |
| `proofs` | `Proofs/` | taken, block, proofs, provers, contract, chain |
| `memory` | `Memory/` | title, saved |
| `seal` | `Seals/` | note, sha256, tx, sealer, block, sealed_at |
| `x402` | `X402/` | taken, block, hours, payments, usdg, payers, payees, under_1_usdg, chain |
| `watch` | `Watch/` | date, watching (a list of addresses); the body is one line per event: level, time, address, what happened, transaction link |

Every fact in a note body links to where it can be checked (an explorer page, a transaction, Sourcify). Notes hold facts, never scores or advice.

## 2. Seals

A seal proves a file existed, unchanged, at a block.

- `hash` = SHA-256 of the file's exact bytes, as 64 lowercase hex characters.
- The seal is a transaction on Robinhood Chain mainnet (chain id 4663) with `from` = `to` (the sealer's own address), `value` = 0, and `data` = the UTF-8 bytes of `ruby-seal:` followed by `hash`.

To verify a seal for a file and a transaction hash:

1. Compute the file's SHA-256.
2. Read the transaction and its receipt. The receipt status must be success.
3. Decode the transaction data as UTF-8. It must equal `ruby-seal:` + the hash exactly.
4. The block's timestamp is the seal time. `from` is the sealer. `from` = `to` marks a self seal.
5. Any other data means not a match. Changing one byte of the file changes the hash.

Test vector, the first Ruby seal on Robinhood Chain mainnet:

| | |
| --- | --- |
| file bytes | `First Ruby seal. Robinhood Chain, 25 Nov 2026.` (46 bytes, UTF-8, no trailing newline) |
| hash | `1f6f333aefac7c8328395699f9936bdfaa644a373d3641590d9e92f87a362a7b` |
| data | UTF-8 of `ruby-seal:1f6f333aefac7c8328395699f9936bdfaa644a373d3641590d9e92f87a362a7b` |
| transaction | `0x48a26e333e5417f2e4ceb2109f8963d7b1dc1c90e489e13cc4602c90ed66c3c9` |
| block | 122,724,179, `from` = `to`, `value` = 0 |
| one byte changed | `...25 Nov 2026!` hashes to `981b1f4fe1954834f4165194c8f0a6271d01171792773db6392437c5de2d3294`: not a match |

Agents can use the `ruby_seal_prepare` and `ruby_verify` MCP tools. `ruby_seal_prepare` only returns the hash and data; the sealer still signs and sends from their own wallet.

Writers simulate the transaction (`eth_simulateV1`) before asking the sealer to sign. Ruby never holds a key.

## 2.2 Proofs

A proof records that an answer was made from a source read at a block. It lives in RubyProof on Robinhood Chain mainnet: `0x0cc3335d87c21ba7b6bdadb79f356a05c13fba02` (deployed at block 123,114,651, source verified on Sourcify, exact match; no owner, no admin, no upgrade, cannot hold funds; not audited).

- `answerHash` = SHA-256 of the answer's exact UTF-8 bytes. `sourceHash` = SHA-256 of the source's exact bytes (usually a Ruby note).
- `sourceBlock` = the Robinhood Chain block the source was read at (a Ruby note's `block`). It can't be later than the current block.
- `kind` = a short UTF-8 label, right-padded to 32 bytes (`pool`, `clip`, `radar`, `note`…).
- Call `prove(bytes32 answerHash, bytes32 sourceHash, uint64 sourceBlock, bytes32 kind)` (selector `0x47b99798`) from your own wallet with 0 ETH. It emits `Proved(address indexed prover, bytes32 indexed answerHash, bytes32 indexed sourceHash, uint64 sourceBlock, bytes32 kind, uint256 index)` (topic `0xb90d70600762281214595c6c7815b98d92c639f0b93ec934e481fe9ad59f6113`).
- To check an answer: hash it, then read `Proved` logs with that hash as the second topic. To check its source too, compare the third topic with the source's hash.
- Robinhood Chain is an Arbitrum chain: inside a contract `block.number` is the Ethereum block, so RubyProof reads the chain's own block from ArbSys (`0x64`).

A proof shows who recorded it, when, and from which source block. It does not show that the answer is true.

## 3. Locked notes

A locked note is `<name>.md.ruby`:

`"RUBY1"` (5 bytes) | salt (16) | iv (12) | GCM tag (16) | ciphertext

- Key: scrypt(password, salt), N = 2^15, r = 8, p = 1, 32 bytes.
- Cipher: AES-256-GCM over the note's exact bytes.
- A writer checks the locked copy decrypts to the same bytes before removing the plain note. A wrong password or a changed file fails the GCM check.

## 4. Data sources

- Chain reads: Robinhood Chain mainnet JSON-RPC (`eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, receipts). Readers split `eth_getLogs` ranges when a node limits them.
- Source verification: Sourcify v2, `GET /server/v2/contract/4663/<address>`.
- Prices: a live KyberSwap route quote of 1,000 USDG into the token (USDG `0x5fc5360d0400a0fd4f2af552add042d716f1d168`, 6 decimals). A price is "USDG per token".
- DLMM pools (liquidity book): the pair's own view functions `getTokenX`, `getTokenY`, `getBinStep`, `getActiveId`, `getReserves`, `getBin(id)`, `getStaticFeeParameters`; swaps from its `Swap` event (topic `0xad7d6f97abf51ce18e17a38f4d70e975be9c0708474987bb3e26ad21bd93ca70`, amounts packed as X in the low 128 bits and Y in the high 128 bits). Price of 1 X in Y = (1 + binStep / 10,000) ^ (activeId − 8,388,608) × 10^(decimalsX − decimalsY). Base fee = baseFactor × binStep / 10^8. Known factories: `0xdcd5f77697914e27f56fd263ef82923c8524abac`, `0x3d8dc63ddc9b992cfde89f7aea6f18717e84687d`.
- Uniswap V4 pools: every pool lives in the PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951` and is named by a 32-byte pool id. The pool key (currency0, currency1, fee, tickSpacing, hooks) comes from `Initialize` (topic `0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438`, topics = id, currency0, currency1). State is read with `extsload` (selector `0x1e2eaeaf`) at slot keccak256(id ‖ 6): slot0 packs sqrtPriceX96 (160 bits), tick (24), protocolFee (24), lpFee (24); liquidity is at that slot + 3. Price of 1 currency0 in currency1 = (sqrtPriceX96 / 2^96)^2 × 10^(decimals0 − decimals1). Swaps come from `Swap` (topic `0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f`); amounts are from the swapper's side (positive = taken out of the pool). Currency 0x0 is native ETH.
- x402-style payments: USDG `AuthorizationUsed` (topic `0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5`, topics = authorizer, nonce) paired with the USDG `Transfer` from that authorizer in the same transaction.
- Launches: the Pons launchpad factory `0xe33e9e479df8802cb0866d5d05258bec4cf62948`
  - launch: topic `0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37`, topics = token, curve, creator; data words = creator, dev ETH in, dev tokens out
  - buy on a curve: topic `0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455`, data words 0 = ETH in, 1 = tokens out
  - sell on a curve: topic `0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df`, data words 0 = tokens in, 1 = ETH out

## 5. Principles

1. Read only. The only write is a seal, sent from the user's own wallet after a simulation.
2. Facts, never scores. No ratings, predictions, or buy and sell advice.
3. A link for every fact.
4. Local first. Notes stay on the user's machine; no Ruby server receives them.
5. Plain files. Markdown, JSON frontmatter values, open formats.

Changes to this protocol are proposed as issues on github.com/rubykit-star/ruby.
