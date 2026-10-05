// Upri Sales Bot — posts Upriworld / UpriMutant sales on Stargaze (Cosmos Hub) to Discord webhooks.
// Usage:
//   node index.mjs            normal run (posts new sales since last run, updates state.json)
//   node index.mjs --dry-run  print what would be posted, post nothing, keep state.json unchanged
//   node index.mjs --test     post the latest sale of each collection (marked TEST), keep state.json unchanged

import { readFile, writeFile } from "node:fs/promises";

const DRY_RUN = process.argv.includes("--dry-run");
const TEST = process.argv.includes("--test");
const STATE_FILE = new URL("./state.json", import.meta.url);
const config = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// GET a JSON path from the first LCD that answers.
async function lcd(path) {
  let lastErr;
  for (const base of config.lcd) {
    try {
      const res = await fetchWithTimeout(base + path);
      const body = await res.json();
      if (res.ok) return body;
      lastErr = new Error(`${base}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    } catch (e) {
      lastErr = new Error(`${base}: ${e.message}`);
    }
  }
  throw lastErr;
}

// Public nodes keep different amounts of tx history and can lag, so ask several and merge the results.
async function getSales(collection) {
  const q = encodeURIComponent(`wasm-finalize-sale.collection='${collection}'`);
  const path = `/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=25&order_by=ORDER_BY_DESC`;
  const results = await Promise.allSettled(
    config.lcd.map(async (base) => {
      const res = await fetchWithTimeout(base + path);
      if (!res.ok) throw new Error(`${base}: HTTP ${res.status}`);
      return (await res.json()).tx_responses ?? [];
    })
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  if (!ok.length) throw new Error(results.map((r) => r.reason?.message).join("; "));
  const txs = new Map();
  for (const r of ok) for (const tx of r.value) txs.set(tx.txhash, tx);

  const sales = [];
  for (const tx of txs.values()) {
    if (tx.code !== 0) continue;
    for (const ev of tx.events) {
      if (ev.type !== "wasm-finalize-sale") continue;
      const a = Object.fromEntries(ev.attributes.map((x) => [x.key, x.value]));
      if (a.collection !== collection) continue;
      sales.push({
        id: `${tx.txhash}:${a.msg_index ?? ""}:${a.token_id}`,
        txhash: tx.txhash,
        height: Number(tx.height),
        timestamp: tx.timestamp,
        tokenId: a.token_id,
        price: Number(a.price),
        denom: a.denom,
        seller: a.seller_recipient,
        buyer: a.nft_recipient,
        action: a.marketplace_action,
      });
    }
  }
  return sales.sort((x, y) => x.height - y.height);
}

function toGateway(uri, gateway) {
  return uri.startsWith("ipfs://") ? gateway + uri.slice("ipfs://".length) : uri;
}

// Fetch from IPFS through the configured gateways; returns { res, url } of the first that works.
async function ipfsFetch(uri) {
  for (const g of config.ipfsGateways) {
    const url = toGateway(uri, g);
    try {
      const res = await fetchWithTimeout(url, {}, 25000);
      if (res.ok) return { res, url };
    } catch {}
    if (!uri.startsWith("ipfs://")) break;
  }
  return null;
}

async function getNft(collection, tokenId) {
  const query = Buffer.from(JSON.stringify({ nft_info: { token_id: tokenId } })).toString("base64");
  const info = await lcd(`/cosmwasm/wasm/v1/contract/${collection}/smart/${query}`);
  const nft = { name: null, image: null, imageFile: null };
  const uri = info.data?.token_uri;
  if (!uri) return nft;
  const metaRes = await ipfsFetch(uri);
  if (!metaRes) return nft;
  const meta = await metaRes.res.json().catch(() => null);
  if (!meta) return nft;
  nft.name = meta.name ?? null;
  if (meta.image) {
    const imgRes = await ipfsFetch(meta.image);
    if (imgRes) {
      nft.image = imgRes.url;
      const buf = Buffer.from(await imgRes.res.arrayBuffer());
      const type = imgRes.res.headers.get("content-type") || "image/png";
      // Attach the image to the message so it keeps working even if the gateway goes down later.
      if (buf.length < 8 * 1024 * 1024) {
        const ext = type.includes("gif") ? "gif" : type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png";
        nft.imageFile = { buf, type, name: `nft.${ext}` };
      }
    }
  }
  return nft;
}

let atomUsdCache;
async function atomUsd() {
  if (atomUsdCache !== undefined) return atomUsdCache;
  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=cosmos&vs_currencies=usd");
    atomUsdCache = (await res.json())?.cosmos?.usd ?? null;
  } catch {
    atomUsdCache = null;
  }
  return atomUsdCache;
}

const short = (addr) => (addr ? `${addr.slice(0, 10)}…${addr.slice(-4)}` : "unknown");
const ACTIONS = {
  "accept-collection-bid": "Collection offer accepted",
  "accept-bid": "Offer accepted",
  "buy-now": "Buy now",
  "accept-ask": "Buy now",
};

async function buildMessage(collKey, sale, isTest) {
  const coll = config.collections[collKey];
  const nft = await getNft(coll.address, sale.tokenId).catch((e) => {
    console.warn(`metadata failed for ${coll.name} #${sale.tokenId}: ${e.message}`);
    return { name: null, image: null, imageFile: null };
  });
  const amount = sale.denom === "uatom" ? sale.price / 1e6 : sale.price;
  const unit = sale.denom === "uatom" ? "ATOM" : sale.denom;
  const usd = sale.denom === "uatom" ? await atomUsd() : null;
  const priceText =
    `**${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${unit}**` +
    (usd ? ` (≈ $${(amount * usd).toLocaleString("en-US", { maximumFractionDigits: 2 })})` : "");

  const embed = {
    title: `${isTest ? "[TEST] " : ""}${nft.name ?? `${coll.name} #${sale.tokenId}`} SOLD!`,
    url: `https://www.stargaze.zone/m/${coll.address}/${sale.tokenId}`,
    color: parseInt(coll.color.replace("#", ""), 16),
    fields: [
      { name: "💰 Price", value: priceText, inline: true },
      { name: "🏷️ Type", value: ACTIONS[sale.action] ?? sale.action ?? "Sale", inline: true },
      { name: "​", value: "​", inline: true },
      { name: "🛒 Buyer", value: `[${short(sale.buyer)}](https://www.mintscan.io/cosmos/address/${sale.buyer})`, inline: true },
      { name: "🤝 Seller", value: `[${short(sale.seller)}](https://www.mintscan.io/cosmos/address/${sale.seller})`, inline: true },
      { name: "🔗 Tx", value: `[View on Mintscan](https://www.mintscan.io/cosmos/tx/${sale.txhash})`, inline: true },
    ],
    footer: { text: `${coll.name} • Stargaze on Cosmos Hub` },
    timestamp: sale.timestamp,
  };
  if (nft.imageFile) embed.image = { url: `attachment://${nft.imageFile.name}` };
  else if (nft.image) embed.image = { url: nft.image };
  return { embed, file: nft.imageFile };
}

async function postWebhook(url, { embed, file }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ username: "Upri Sales", embeds: [embed] }));
    if (file) form.append("files[0]", new Blob([file.buf], { type: file.type }), file.name);
    const res = await fetchWithTimeout(url + "?wait=true", { method: "POST", body: form }, 30000);
    if (res.ok) return;
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.ceil((body.retry_after ?? 2) * 1000) + 250);
      continue;
    }
    throw new Error(`webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error("webhook rate limited too many times");
}

async function deliver(collKey, message) {
  const targets = config.routes.filter((r) => r.collections.includes(collKey));
  for (const r of targets) {
    const url = process.env[r.webhookEnv];
    // A missing secret must fail the run, otherwise the sale is marked seen without ever being posted.
    if (!url) throw new Error(`${r.webhookEnv} is not set (add it under Settings → Secrets and variables → Actions)`);
    await postWebhook(url, message);
    console.log(`  posted to ${r.webhookEnv}`);
    await sleep(1000);
  }
}

async function main() {
  let state = {};
  try {
    state = JSON.parse((await readFile(STATE_FILE, "utf8")).replace(/^﻿/, ""));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`state.json is unreadable, fix or delete it: ${e.message}`);
  }

  let failed = false;
  for (const [key, coll] of Object.entries(config.collections)) {
    let sales;
    try {
      sales = await getSales(coll.address);
    } catch (e) {
      console.error(`${coll.name}: could not load sales: ${e.message}`);
      failed = true;
      continue;
    }
    console.log(`${coll.name}: ${sales.length} recent sales on chain`);

    if (TEST) {
      const latest = sales.at(-1);
      if (!latest) continue;
      const msg = await buildMessage(key, latest, true);
      if (DRY_RUN) console.log(JSON.stringify(msg.embed, null, 2), msg.file ? `(+ image ${msg.file.buf.length} bytes)` : "(no image)");
      else await deliver(key, msg);
      continue;
    }

    const s = state[key];
    if (!s) {
      // First run: remember where we are so old sales are not re-announced.
      state[key] = { height: sales.at(-1)?.height ?? 0, seen: sales.map((x) => x.id) };
      console.log(`  first run, starting from height ${state[key].height}`);
      continue;
    }
    const seen = new Set(s.seen);
    const fresh = sales.filter((x) => x.height >= s.height && !seen.has(x.id));
    for (const sale of fresh) {
      console.log(`  new sale: #${sale.tokenId} for ${sale.price} ${sale.denom} (${sale.txhash})`);
      const msg = await buildMessage(key, sale, false);
      if (DRY_RUN) {
        console.log(JSON.stringify(msg.embed, null, 2));
        continue;
      }
      try {
        await deliver(key, msg);
      } catch (e) {
        // Stop here so this sale is retried on the next run instead of being skipped.
        console.error(`  delivery failed, will retry next run: ${e.message}`);
        failed = true;
        break;
      }
      s.height = Math.max(s.height, sale.height);
      s.seen = [...s.seen, sale.id].slice(-200);
    }
  }

  // GitHub pauses scheduled workflows in repos with no commits for 60 days; a monthly change keeps it alive.
  state._heartbeat = new Date().toISOString().slice(0, 7);
  if (!DRY_RUN && !TEST) await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  if (failed) process.exitCode = 1;
}

await main();
