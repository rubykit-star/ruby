// ruby locker <token>: what the Pons V2 launch locker holds for a graduated token, read from the chain.
// The locker keeps each launch's Uniswap V4 position NFT and the token remainder. Ruby checks custody (ownerOf),
// the position's liquidity against the whole pool, the locked token supply, and the locker's own ABI on Sourcify.
import { rpc, tokenInfo, EXPLORER, short } from "./chain.mjs";
import { frontmatter, write, safeName } from "./note.mjs";
import { keccak256, hexBytes } from "./keccak.mjs";
import { POOL_MANAGER } from "./poolv4.mjs";

export const PONS_V2_LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const SEL = { isLocked: "0x4a4fbeec", lockedPositions: "0xfa22143d", lockedTokenSupply: "0x732e78e4", positionManager: "0x791b98bc", factory: "0xc45a0155", owner: "0x8da5cb5b",
  ownerOf: "0x6352211e", getPositionLiquidity: "0x1efeed33", getPoolAndPositionInfo: "0x7ba03aad", balanceOf: "0x70a08231", totalSupply: "0x18160ddd" };
const MOVERS = /withdraw|transfer(?!Ownership)|collect|sweep|rescue|recover|execute|multicall|call|unlock|release|emergency|migrate|approve|burn|decrease|remove/i;
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0"), addr = (w) => "0x" + w.slice(-40).toLowerCase();
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const sourcifyFull = async (a) => { try { const r = await fetch(`https://sourcify.dev/server/v2/contract/4663/${a}?fields=abi,compilation`); const j = await r.json(); return { match: j.match || null, name: j.compilation && j.compilation.name, abi: j.abi || [] }; } catch { return { match: null, name: null, abi: [] }; } };
const vt = (m) => (m === "exact_match" ? "exact match" : m === "match" ? "match" : "not verified");

export async function readLocker(token, locker = PONS_V2_LOCKER) {
  token = token.toLowerCase();
  const locked = BigInt(await call(locker, SEL.isLocked + pad(token))) === 1n;
  const [tid, supplyLocked, pmw, facw, ownw, balw, tsw] = await Promise.all([call(locker, SEL.lockedPositions + pad(token)), call(locker, SEL.lockedTokenSupply + pad(token)), call(locker, SEL.positionManager), call(locker, SEL.factory), call(locker, SEL.owner), call(token, SEL.balanceOf + pad(locker)), call(token, SEL.totalSupply)]);
  const R = { token, locker, locked, tokenId: BigInt(tid), supplyLocked: BigInt(supplyLocked), lockerBalance: BigInt(balw), totalSupply: BigInt(tsw), positionManager: addr(pmw), factory: addr(facw), owner: addr(ownw) };
  if (locked && R.tokenId > 0n) {
    const id = pad(R.tokenId.toString(16)), [ow, lq, info] = await Promise.all([call(R.positionManager, SEL.ownerOf + id), call(R.positionManager, SEL.getPositionLiquidity + id), call(R.positionManager, SEL.getPoolAndPositionInfo + id)]);
    const w = info.slice(2).match(/.{64}/g), pi = BigInt("0x" + w[5]);
    R.nftOwner = addr(ow); R.positionLiquidity = BigInt(lq);
    R.key = { currency0: addr(w[0]), currency1: addr(w[1]), fee: parseInt(w[2], 16), tickSpacing: Number(BigInt.asIntN(24, BigInt("0x" + w[3]))), hooks: addr(w[4]) };
    R.tickLower = Number(BigInt.asIntN(24, (pi >> 8n) & 0xffffffn)); R.tickUpper = Number(BigInt.asIntN(24, (pi >> 32n) & 0xffffffn));
    R.poolId = keccak256(hexBytes(w.slice(0, 5).join("")));
    const slot = keccak256(hexBytes(R.poolId + pad("6")));
    R.poolLiquidity = BigInt(await call(POOL_MANAGER, "0x1e2eaeaf" + pad((BigInt(slot) + 3n).toString(16))));
  }
  const [sLocker, sPM, sFac, sHook] = await Promise.all([sourcifyFull(locker), sourcifyFull(R.positionManager), sourcifyFull(R.factory), R.key ? sourcifyFull(R.key.hooks) : null]);
  R.sources = { locker: sLocker, positionManager: sPM, factory: sFac, hook: sHook };
  R.lockerFunctions = sLocker.abi.filter((e) => e.type === "function" && e.stateMutability !== "view" && e.stateMutability !== "pure").map((e) => e.name);
  R.movers = R.lockerFunctions.filter((n) => MOVERS.test(n));
  return R;
}

export async function lockerNote(token, vault, { log = () => {} } = {}) {
  log("reading the Pons V2 launch locker…");
  const R = await readLocker(token), T = await tokenInfo(R.token), sym = T.symbol || short(R.token), dec = T.decimals ?? 18;
  const amt = (v) => (Number(v) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 2 }), pct = (v) => (R.totalSupply ? (Number(v) / Number(R.totalSupply)) * 100 : 0).toFixed(2) + "%";
  const share = R.poolLiquidity ? (Number(R.positionLiquidity) / Number(R.poolLiquidity)) * 100 : null, fullRange = R.tickLower <= -887000 && R.tickUpper >= 887000;
  const link = (a) => `[${short(a)}](${EXPLORER}/address/${a})`;
  const fm = frontmatter({ type: "locker", token: R.token, symbol: sym, locker: R.locker, locked: R.locked, position_id: R.tokenId.toString(), pool_id: R.poolId || null, position_share_of_pool: share == null ? null : +share.toFixed(2),
    full_range: R.locked ? fullRange : null, token_supply_locked_pct: +pct(R.supplyLocked).replace("%", ""), locker_moving_functions: R.movers, chain: "Robinhood Chain mainnet (4663)", tags: ["locker", "pons", "robinhood-chain"] });
  const body = `
# ${sym} · launch locker

What the Pons V2 launch locker ${link(R.locker)} holds for ${sym}, read from Robinhood Chain mainnet. Facts with links, no score.

## Liquidity position
|  |  |
| --- | --- |
| locked for ${sym} | ${R.locked ? "yes" : "no: this token has no graduated position in this locker"} |
${R.locked ? `| position NFT | #${R.tokenId} on ${link(R.positionManager)} (${R.sources.positionManager.name || "PositionManager"}, source ${vt(R.sources.positionManager.match)}) |
| NFT owner now | ${link(R.nftOwner)}${R.nftOwner === R.locker ? " · the locker itself" : " · NOT the locker"} |
| pool | Uniswap V4 · id \`${R.poolId}\` · hook ${link(R.key.hooks)} ${R.sources.hook && R.sources.hook.name ? "(" + R.sources.hook.name + ")" : ""} |
| range | ticks ${R.tickLower} to ${R.tickUpper}${fullRange ? " · full range" : ""} |
| position liquidity | ${R.positionLiquidity.toLocaleString("en-US")} |
| whole pool's active liquidity | ${R.poolLiquidity.toLocaleString("en-US")} |
| share of the pool held by the locker | **${share.toFixed(2)}%** |
` : ""}
## Token supply
|  |  |
| --- | --- |
| ${sym} locked as remainder | ${amt(R.supplyLocked)} (${pct(R.supplyLocked)} of supply) |
| ${sym} the locker holds now | ${amt(R.lockerBalance)} |

## The locker contract
|  |  |
| --- | --- |
| source (Sourcify) | ${vt(R.sources.locker.match)} · ${R.sources.locker.name || ""} |
| functions that change state | ${R.lockerFunctions.join(", ") || "none"} |
| any that could move tokens or the position out | ${R.movers.length ? "**" + R.movers.join(", ") + "**" : "none in the verified ABI"} |
| owner | ${link(R.owner)} |
| factory | ${link(R.factory)} (${R.sources.factory.name || "unknown"}, source ${vt(R.sources.factory.match)}) · already set, and setFactory can only run once |

The verified source says the locker "exposes no withdrawal or arbitrary-call function" and that renounceOwnership is disabled. Ruby checks the published ABI for anything that could move tokens out; it does not audit the code. Swap fees on a V4 position are handled by the pool's hook, not by this locker.

## Notes
-
`;
  return write(vault, `Research/${safeName(sym + " locker " + R.token.slice(0, 6))}.md`, fm + body);
}
