// ruby clip <token>: one note of facts about a token, every line read from Robinhood Chain or Sourcify
import { rpc, logs, head, block, tokenInfo, balanceOf, isContract, sourcify, quoteUsdgTo, fmt, num, short, pad, topicAddr, T_TRANSFER, DEAD, ZERO, EXPLORER } from "./chain.mjs";
import { frontmatter, table, write, safeName } from "./note.mjs";

const MAX_TRANSFERS = 30000; // above this, holders are not computed from logs (too many to read in one go)

export async function clip(token, vault, { log = () => {} } = {}) {
  token = token.toLowerCase();
  if (!(await isContract(token))) throw new Error(`${token} has no contract code on Robinhood Chain mainnet`);
  log("reading the token…");
  const info = await tokenInfo(token);
  if (info.decimals === null || info.totalSupply === null) throw new Error("this contract does not answer like an ERC-20 token (no decimals or totalSupply)");
  const dec = info.decimals, now = await head();

  log("finding the first mint…");
  // walk forward from genesis in 9M windows: the first window with a mint (a Transfer from 0x0) holds the first mint
  let mint = null;
  for (let from = 0; from <= now && !mint; from += 9_000_000) {
    const l = await logs({ address: token, topics: [T_TRANSFER, pad(ZERO)] }, from, Math.min(now, from + 8_999_999));
    if (l.length) mint = l[0];
  }
  let first = null;
  if (mint) {
    const [tx, b] = await Promise.all([rpc("eth_getTransactionByHash", [mint.transactionHash]), block(parseInt(mint.blockNumber, 16))]);
    first = { block: parseInt(mint.blockNumber, 16), tx: mint.transactionHash, at: new Date(parseInt(b.timestamp, 16) * 1000), sender: tx.from.toLowerCase(), via: tx.to ? tx.to.toLowerCase() : null, to: topicAddr(mint.topics[2]), amount: BigInt(mint.data) };
  }

  log("reading transfers and holders…");
  let holders = null, transfers = null;
  if (first) {
    const all = await logs({ address: token, topics: [T_TRANSFER] }, first.block, now).catch(() => null);
    if (all && all.length <= MAX_TRANSFERS) {
      transfers = all.length; const bal = new Map();
      for (const l of all) { const v = BigInt(l.data), f = topicAddr(l.topics[1]), t = topicAddr(l.topics[2]); bal.set(f, (bal.get(f) || 0n) - v); bal.set(t, (bal.get(t) || 0n) + v); }
      bal.delete(ZERO);
      holders = [...bal.entries()].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1));
    } else if (all) transfers = all.length;
  }
  const [dead, zero, verified, priceUsdg] = await Promise.all([balanceOf(token, DEAD), balanceOf(token, ZERO), sourcify(token), quoteUsdgTo(token, dec).catch(() => null)]);
  const burned = dead + zero, sup = info.totalSupply, pct = (v) => (sup ? ((num(v, dec) / num(sup, dec)) * 100).toFixed(2) + "%" : "–");

  // label the top holders we can name from the chain itself
  const top = [];
  for (const [a, v] of (holders || []).slice(0, 10)) {
    const parts = [];
    if (a === DEAD) parts.push("dead address (burned)");
    if (a === first?.to) parts.push("first mint recipient");
    if (a !== DEAD && (await isContract(a))) parts.push("contract");
    let label = parts.join(", ");
    if (a === info.owner) label = (label ? label + ", " : "") + "owner()";
    top.push([`[${short(a)}](${EXPLORER}/address/${a})`, fmt(v, dec, 2), pct(v), label]);
  }

  const sym = info.symbol || short(token), file = `Tokens/${safeName(sym)} ${token.slice(0, 6)}.md`;
  const fm = frontmatter({ type: "token", symbol: sym, name: info.name, address: token, chain: "Robinhood Chain mainnet (4663)", decimals: dec, total_supply: fmt(sup, dec, 2), burned_pct: pct(burned),
    holders: holders ? holders.length : null, verified: verified || "no", first_block: first?.block ?? null, price_usdg: priceUsdg ? +priceUsdg.toPrecision(6) : null, clipped: new Date().toISOString(), block: now, tags: ["token", "robinhood-chain"] });
  const ownerLine = info.owner === null ? "no owner() function" : info.owner === ZERO ? "renounced (owner() is 0x0)" : `[${short(info.owner)}](${EXPLORER}/address/${info.owner})`;
  const body = `${fm}
# ${sym}${info.name && info.name !== sym ? " · " + info.name : ""}

Facts read from Robinhood Chain mainnet at block ${now.toLocaleString("en-US")}. No opinions or scores: check each line yourself with the links.

## Contract
${table(["", ""], [
    ["address", `[${token}](${EXPLORER}/token/${token})`],
    ["source verified (Sourcify)", verified ? `${verified} · [view](https://repo.sourcify.dev/4663/${token})` : "not verified"],
    ["owner", ownerLine],
    ["decimals", String(dec)],
    ["total supply", fmt(sup, dec, 2)],
  ])}
## Birth
${first ? table(["", ""], [
    ["first mint", `${fmt(first.amount, dec, 2)} to [${short(first.to)}](${EXPLORER}/address/${first.to})`],
    ["block · time", `${first.block.toLocaleString("en-US")} · ${first.at.toISOString().replace("T", " ").slice(0, 16)} UTC`],
    ["transaction", `[${short(first.tx)}](${EXPLORER}/tx/${first.tx})`],
    ["sent by", `[${short(first.sender)}](${EXPLORER}/address/${first.sender})`],
    ["through contract", first.via ? `[${short(first.via)}](${EXPLORER}/address/${first.via})${first.via === token ? " (the token itself)" : " (a factory or launchpad)"}` : "–"],
  ]) : "No mint event found.\n"}
## Supply
${table(["", "amount", "share"], [
    ["burned (dead + 0x0)", fmt(burned, dec, 2), pct(burned)],
    ["circulating, not burned", fmt(sup - burned, dec, 2), pct(sup - burned)],
  ])}
## Holders
${holders ? `${holders.length.toLocaleString("en-US")} addresses hold it, from ${transfers.toLocaleString("en-US")} transfers.\n\n` + table(["address", "balance", "share", "label"], top)
  : transfers ? `Too many transfers (${transfers.toLocaleString("en-US")}) to rebuild holders here. See the [explorer](${EXPLORER}/token/${token}?tab=holders).\n` : "Could not read the transfers.\n"}
## Price
${priceUsdg ? `About **${priceUsdg.toPrecision(6)} USDG** per token, from a live KyberSwap quote of 1,000 USDG on Robinhood Chain.` : "No DEX route on KyberSwap right now (for example, still on a launchpad curve)."}

## Notes
- 
`;
  return write(vault, file, body);
}
