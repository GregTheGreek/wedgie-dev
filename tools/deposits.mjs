// The shop's deposit contracts (contracts/src/WedgieDeposits.sol, src/shop/deposits.ts).
//   node tools/deposits.mjs code                 copy the built creation codes into deposits.ts (after forge build;
//                                                 never once an order has used them: deposits.ts)
//   node tools/deposits.mjs where <safe>         the factory's address for that Safe (the same on every chain)
//   node tools/deposits.mjs deploy <safe> <rpc>  deploy the factory through the deterministic deployer, if it isn't there.
//                                                 Signs with DEPLOY_KEY from the env (never in git; any key with a little gas)
//   node tools/deposits.mjs sweep <safe> <rpc> <order id>...   move those orders' USDC to the Safe (DEPLOY_KEY pays the gas)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";

// src/ imports say .js (for Vercel); here they are .ts
registerHooks({ resolve: (s, c, next) => { try { return next(s, c); } catch (e) { if (s.endsWith(".js")) return next(s.slice(0, -3) + ".ts", c); throw e; } } });

const [cmd, safe, rpc, ...ids] = process.argv.slice(2);
const P = new URL("../src/shop/deposits.ts", import.meta.url).pathname;
if (cmd === "code") {
  const code = (n) => JSON.parse(readFileSync(new URL(`../contracts/out/WedgieDeposits.sol/${n}.json`, import.meta.url))).bytecode.object;
  let s = readFileSync(P, "utf8");
  s = s.replace(/FACTORY_CODE = "0x[0-9a-f]*"/, `FACTORY_CODE = "${code("WedgieDeposits")}"`).replace(/DEPOSIT_CODE = "0x[0-9a-f]*"/, `DEPOSIT_CODE = "${code("Deposit")}"`);
  writeFileSync(P, s);
  process.exit(0);
}
const D = await import(P);
const factory = D.factoryOf(safe);
const cast = (...a) => execFileSync("cast", a, { encoding: "utf8" }).trim();
if (cmd === "where") { console.log(factory); process.exit(0); }
if (!process.env.DEPLOY_KEY) { console.error("Set DEPLOY_KEY."); process.exit(1); }
if (cmd === "deploy") {
  if (cast("code", factory, "--rpc-url", rpc) !== "0x") { console.log("already there:", factory); process.exit(0); }
  const init = D.FACTORY_CODE + safe.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  cast("send", D.DEPLOYER, "0x" + "00".repeat(32) + init.slice(2), "--rpc-url", rpc, "--private-key", process.env.DEPLOY_KEY);
  for (let i = 0; cast("code", factory, "--rpc-url", rpc) === "0x"; i++) {   // the RPC can lag the receipt
    if (i > 10) { console.error("deploy failed"); process.exit(1); }
    execFileSync("sleep", ["2"]);
  }
  console.log("deployed:", factory);
}
if (cmd === "sweep") {
  const USDC = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }[Number(cast("chain-id", "--rpc-url", rpc))];
  cast("send", factory, "sweepMany(bytes32[],address)", `[${ids.map(D.saltOf).join(",")}]`, USDC, "--rpc-url", rpc, "--private-key", process.env.DEPLOY_KEY);
  console.log("swept", ids.length);
}
