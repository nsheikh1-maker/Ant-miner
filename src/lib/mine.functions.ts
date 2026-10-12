import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { encodeBase58, isSolanaAddress, isSolanaSignature } from "@/lib/base58";
import {
  type Lobby,
  type MineNetwork,
  type Pack,
  cleanAnnouncement,
  cleanMinerName,
  parsePacks,
  paymentUrl,
  readPack,
} from "@/lib/mine-shared";
import { checkSolPayment } from "@/lib/solana-tx";

type Sql = Awaited<ReturnType<(typeof import("@/lib/db"))["getSql"]>>;

class MineError extends Error {}

const fails = new Map<string, { count: number; at: number }>();

function noteFail(userId: string) {
  const now = Date.now();
  const row = fails.get(userId);
  if (!row || now - row.at > 10 * 60 * 1000) {
    fails.set(userId, { count: 1, at: now });
    return;
  }
  row.count += 1;
  row.at = now;
}

function assertAttempts(userId: string) {
  const row = fails.get(userId);
  if (row && row.count >= 8 && Date.now() - row.at < 10 * 60 * 1000) {
    throw new MineError("Too many wrong keys. Wait a few minutes.");
  }
}

async function sqlClient(): Promise<Sql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

type ConfigRow = {
  owner_salt: string | null;
  owner_hash: string | null;
  wallet: string;
  network: string;
  shop_enabled: boolean;
  multiplier: number;
  announcement: string;
  maintenance: boolean;
  packs_json: string;
};

async function configRow(sql: Sql): Promise<ConfigRow> {
  await sql`insert into mine_config (id) values (1) on conflict (id) do nothing`;
  const rows = await sql<ConfigRow>`
    select owner_salt, owner_hash, wallet, network, shop_enabled, multiplier, announcement, maintenance, packs_json
    from mine_config where id = 1
  `;
  const row = rows[0];
  if (!row) throw new MineError("The mine office isn't ready.");
  return row;
}

function asNetwork(value: string): MineNetwork {
  return value === "devnet" ? "devnet" : "mainnet";
}

function lobbyFrom(row: ConfigRow): Lobby {
  const wallet = isSolanaAddress(row.wallet) ? row.wallet.trim() : "";
  const multiplier = Number(row.multiplier);
  return {
    wallet,
    network: asNetwork(row.network),
    shopEnabled: row.shop_enabled === true && wallet.length > 0,
    multiplier: multiplier === 2 || multiplier === 3 ? multiplier : 1,
    announcement: cleanAnnouncement(row.announcement ?? ""),
    maintenance: row.maintenance === true,
    packs: parsePacks(row.packs_json ?? ""),
  };
}

async function hashKey(key: string, salt?: string) {
  const { scryptSync, randomBytes, timingSafeEqual } = await import("node:crypto");
  const nextSalt = salt ?? randomBytes(16).toString("hex");
  const calc = () => scryptSync(key.normalize("NFKC"), nextSalt, 32);
  return {
    salt: nextSalt,
    hash: calc().toString("hex"),
    matches(storedSalt: string, storedHash: string) {
      const next = scryptSync(key.normalize("NFKC"), storedSalt, 32);
      const prev = Buffer.from(storedHash, "hex");
      return prev.length === next.length && timingSafeEqual(prev, next);
    },
  };
}

function cleanKey(key: string): string {
  const trimmed = key.normalize("NFKC").trim();
  if (trimmed.length < 8 || trimmed.length > 80) {
    throw new MineError("Owner key must be 8 to 80 characters.");
  }
  return trimmed;
}

async function requireOwner(sql: Sql, userId: string, key: string) {
  assertAttempts(userId);
  const row = await configRow(sql);
  if (!row.owner_hash || !row.owner_salt) throw new MineError("UNCLAIMED");
  const hashed = await hashKey(cleanKey(key));
  if (!hashed.matches(row.owner_salt, row.owner_hash)) {
    noteFail(userId);
    throw new MineError("That owner key is wrong.");
  }
  fails.delete(userId);
  return row;
}

function rpcUrls(network: MineNetwork): string[] {
  return network === "devnet"
    ? ["https://api.devnet.solana.com"]
    : ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
}

async function fetchTransaction(signature: string, network: MineNetwork): Promise<unknown> {
  let last = "Solana didn't answer.";
  for (const url of rpcUrls(network)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        last = "Solana didn't answer.";
        continue;
      }
      const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
      if (body.error) {
        last = "Solana didn't answer.";
        continue;
      }
      return body.result ?? null;
    } catch {
      last = "Solana didn't answer.";
    }
  }
  throw new MineError(last);
}

async function finishCredit(sql: Sql, order: { id: string; user_id: string; kind: string; ant_credit: number }) {
  const claimed = await sql<{ kind: string; ant_credit: number }>`
    update mine_orders set credited = true
    where id = ${order.id} and credited = false
    returning kind, ant_credit
  `;
  if (claimed.length > 0 && claimed[0].kind === "ant") {
    const credit = Number(claimed[0].ant_credit);
    await sql`
      insert into mine_grants (user_id, ant_total) values (${order.user_id}, ${credit})
      on conflict (user_id) do update set ant_total = mine_grants.ant_total + ${credit}
    `;
  }
  if (claimed.length > 0 && claimed[0].kind === "tip") {
    await sql`
      insert into mine_flags (user_id, supporter) values (${order.user_id}, true)
      on conflict (user_id) do update set supporter = true
    `;
    await sql`update mine_scores set supporter = true where user_id = ${order.user_id}`;
  }
  const grants = await sql<{ ant_total: number }>`select ant_total from mine_grants where user_id = ${order.user_id}`;
  return Number(grants[0]?.ant_total ?? 0);
}

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof MineError && error.message !== "UNCLAIMED") {
    return { ok: false, error: error.message };
  }
  if (error instanceof MineError) return { ok: false, error: "Claim the mine before changing it." };
  console.error(error);
  return { ok: false, error: "The mine office hit a snag. Try again." };
}

export const getLobby = createServerFn({ method: "GET" }).handler(async (): Promise<Lobby> => {
  const sql = await sqlClient();
  return lobbyFrom(await configRow(sql));
});

export const myGrant = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const grants = await sql<{ ant_total: number }>`select ant_total from mine_grants where user_id = ${context.userId}`;
    const flags = await sql<{ supporter: boolean }>`select supporter from mine_flags where user_id = ${context.userId}`;
    return { antTotal: Number(grants[0]?.ant_total ?? 0), supporter: flags[0]?.supporter === true };
  });

type BoardRow = {
  rank: number;
  name: string;
  total: number;
  level: number;
  supporter: boolean;
  you: boolean;
};

function mapBoard(rows: { rank: number; name: string; total: number; level: number; supporter: boolean; you: boolean }[]): BoardRow[] {
  return rows.map((row) => ({
    rank: Number(row.rank),
    name: row.name,
    total: Number(row.total),
    level: Number(row.level),
    supporter: row.supporter === true,
    you: row.you === true,
  }));
}

export const publicBoard = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await sqlClient();
  const rows = await sql<{ rank: number; name: string; total: number; level: number; supporter: boolean }>`
    select row_number() over (order by total desc, updated_at asc) as rank, name, total, level, supporter
    from mine_scores
    where hidden = false
    order by total desc, updated_at asc
    limit 20
  `;
  return { rows: mapBoard(rows.map((row) => ({ ...row, you: false }))) };
});

export const standings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{ rank: number; name: string; total: number; level: number; supporter: boolean; you: boolean }>`
      with ranked as (
        select user_id, name, total, level, supporter,
               row_number() over (order by total desc, updated_at asc) as rank
        from mine_scores
        where hidden = false
      )
      select rank, name, total, level, supporter, (user_id = ${context.userId}) as you
      from ranked
      where rank <= 20 or user_id = ${context.userId}
      order by rank asc
    `;
    return { rows: mapBoard(rows) };
  });

export const postScore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name?: string; total?: number; level?: number }) => ({
    name: cleanMinerName(String(input?.name ?? "")),
    total: Number(input?.total),
    level: Math.floor(Number(input?.level)),
  }))
  .handler(async ({ context, data }) => {
    if (!Number.isFinite(data.total) || data.total < 1 || data.total > 1e15) {
      return { ok: false as const, error: "Dig a little on the ranked mine first." };
    }
    if (!Number.isFinite(data.level) || data.level < 1 || data.level > 8) {
      return { ok: false as const, error: "That level isn't on the map." };
    }
    try {
      const sql = await sqlClient();
      const lobby = lobbyFrom(await configRow(sql));
      if (lobby.maintenance) return { ok: false as const, error: "The ranked mine is paused." };
      await sql`
        insert into mine_scores (user_id, name, total, level, supporter)
        values (
          ${context.userId},
          ${data.name},
          ${data.total},
          ${data.level},
          coalesce((select supporter from mine_flags where user_id = ${context.userId}), false)
        )
        on conflict (user_id) do update set
          name = excluded.name,
          total = excluded.total,
          level = excluded.level,
          supporter = mine_scores.supporter or excluded.supporter,
          updated_at = now()
      `;
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });

type OrderTicket = {
  ok: true;
  orderId: string;
  url: string;
  lamports: number;
  sol: string;
  wallet: string;
  network: MineNetwork;
  memo: string;
  ant: number;
  kind: "ant" | "tip";
};

export const createOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { kind?: string; packId?: string; lamports?: number; name?: string }) => ({
    kind: input?.kind === "tip" ? "tip" : input?.kind === "ant" ? "ant" : "",
    packId: String(input?.packId ?? ""),
    lamports: Number(input?.lamports),
    name: cleanMinerName(String(input?.name ?? "")),
  }))
  .handler(async ({ context, data }) => {
    try {
      const sql = await sqlClient();
      const lobby = lobbyFrom(await configRow(sql));
      if (!lobby.shopEnabled || !lobby.wallet) {
        throw new MineError("The treasury is closed until the owner sets a Solana wallet.");
      }
      let lamports = 0;
      let ant = 0;
      let packId: string | null = null;
      let message = "Ant Mine tip";
      if (data.kind === "ant") {
        const pack = lobby.packs.find((item) => item.id === data.packId);
        if (!pack) throw new MineError("That pack isn't for sale.");
        lamports = pack.lamports;
        ant = pack.ant;
        packId = pack.id;
        message = `Ant Mine ${pack.name}`;
      } else if (data.kind === "tip") {
        if (!Number.isSafeInteger(data.lamports)) throw new MineError("Enter a tip between 0.01 and 50 SOL.");
        lamports = data.lamports;
        const { MIN_LAMPORTS, MAX_LAMPORTS } = await import("@/lib/mine-shared");
        if (lamports < MIN_LAMPORTS || lamports > MAX_LAMPORTS) {
          throw new MineError("Tips are between 0.01 and 50 SOL.");
        }
      } else {
        throw new MineError("Pick a pack or a tip.");
      }

      const { randomBytes } = await import("node:crypto");
      const orderId = `ord_${encodeBase58(randomBytes(9))}`;
      const reference = encodeBase58(randomBytes(32));
      await sql`
        insert into mine_orders (
          id, user_id, payer_name, kind, pack_id, lamports, ant_credit, wallet, network, reference_key
        ) values (
          ${orderId},
          ${context.userId},
          ${data.name},
          ${data.kind},
          ${packId},
          ${lamports},
          ${ant},
          ${lobby.wallet},
          ${lobby.network},
          ${reference}
        )
      `;
      const { lamportsToSolString } = await import("@/lib/mine-shared");
      const ticket: OrderTicket = {
        ok: true,
        orderId,
        url: paymentUrl({ wallet: lobby.wallet, lamports, reference, memo: orderId, message }),
        lamports,
        sol: lamportsToSolString(lamports),
        wallet: lobby.wallet,
        network: lobby.network,
        memo: orderId,
        ant,
        kind: data.kind,
      };
      return ticket;
    } catch (error) {
      return fail(error);
    }
  });

export const verifyPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { orderId?: string; signature?: string }) => ({
    orderId: String(input?.orderId ?? "").trim(),
    signature: String(input?.signature ?? "").trim(),
  }))
  .handler(async ({ context, data }) => {
    try {
      if (!data.orderId || !isSolanaSignature(data.signature)) {
        throw new MineError("Paste the transaction signature from your wallet.");
      }
      const sql = await sqlClient();
      const orders = await sql<{
        id: string;
        user_id: string;
        kind: string;
        lamports: number;
        ant_credit: number;
        wallet: string;
        network: string;
        reference_key: string;
        signature: string | null;
        status: string;
        credited: boolean;
      }>`
        select id, user_id, kind, lamports, ant_credit, wallet, network, reference_key, signature, status, credited
        from mine_orders
        where id = ${data.orderId} and user_id = ${context.userId}
      `;
      const order = orders[0];
      if (!order) throw new MineError("That order isn't yours.");
      if (order.status === "paid") {
        if (order.signature && order.signature !== data.signature) {
          throw new MineError("That order was already paid with a different transaction.");
        }
        const antTotal = await finishCredit(sql, {
          id: order.id,
          user_id: order.user_id,
          kind: order.kind,
          ant_credit: Number(order.ant_credit),
        });
        return {
          ok: true as const,
          kind: order.kind === "tip" ? ("tip" as const) : ("ant" as const),
          antCredit: order.kind === "ant" ? Number(order.ant_credit) : 0,
          antTotal,
          signature: order.signature ?? data.signature,
          network: asNetwork(order.network),
        };
      }
      const taken = await sql<{ id: string }>`select id from mine_orders where signature = ${data.signature}`;
      if (taken.length > 0) throw new MineError("That transaction was already claimed.");

      const tx = await fetchTransaction(data.signature, asNetwork(order.network));
      if (!tx) throw new MineError("That signature isn't confirmed yet. Wait a few seconds and try again.");
      const check = checkSolPayment(tx, {
        wallet: order.wallet,
        lamports: Number(order.lamports),
        reference: order.reference_key,
        memo: order.id,
      });
      if (!check.ok) throw new MineError(check.reason);

      const updated = await sql<{ id: string }>`
        update mine_orders
        set status = 'paid', signature = ${data.signature}
        where id = ${order.id} and user_id = ${context.userId} and status = 'pending'
          and not exists (select 1 from mine_orders existing where existing.signature = ${data.signature})
        returning id
      `;
      if (updated.length === 0) throw new MineError("That transaction was already claimed.");
      const antTotal = await finishCredit(sql, {
        id: order.id,
        user_id: order.user_id,
        kind: order.kind,
        ant_credit: Number(order.ant_credit),
      });
      return {
        ok: true as const,
        kind: order.kind === "tip" ? ("tip" as const) : ("ant" as const),
        antCredit: order.kind === "ant" ? Number(order.ant_credit) : 0,
        antTotal,
        signature: data.signature,
        network: asNetwork(order.network),
      };
    } catch (error) {
      return fail(error);
    }
  });

export type OwnerOrder = {
  id: string;
  payerName: string;
  kind: "ant" | "tip";
  lamports: number;
  antCredit: number;
  network: MineNetwork;
  signature: string | null;
  createdAt: string;
};

export type OwnerScore = {
  userId: string;
  name: string;
  total: number;
  level: number;
  hidden: boolean;
  supporter: boolean;
};

export type OwnerView =
  | { ok: true; claimed: false; unlocked: false }
  | { ok: true; claimed: true; unlocked: false }
  | {
      ok: true;
      claimed: true;
      unlocked: true;
      config: Lobby;
      totals: { network: MineNetwork; lamports: number; count: number }[];
      orders: OwnerOrder[];
      scores: OwnerScore[];
    };

export const loadOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { key?: string }) => ({ key: String(input?.key ?? "").slice(0, 80) }))
  .handler(async ({ context, data }): Promise<OwnerView | { ok: false; error: string }> => {
    try {
      const sql = await sqlClient();
      const row = await configRow(sql);
      if (!row.owner_hash) return { ok: true, claimed: false, unlocked: false };
      if (!data.key.trim()) return { ok: true, claimed: true, unlocked: false };
      await requireOwner(sql, context.userId, data.key);
      const lobby = lobbyFrom(row);
      const totals = await sql<{ network: string; lamports: number; count: number }>`
        select network, coalesce(sum(lamports), 0) as lamports, count(*)::int as count
        from mine_orders
        where status = 'paid'
        group by network
      `;
      const orders = await sql<{
        id: string;
        payer_name: string;
        kind: string;
        lamports: number;
        ant_credit: number;
        network: string;
        signature: string | null;
        created_at: string;
      }>`
        select id, payer_name, kind, lamports, ant_credit, network, signature,
               to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as created_at
        from mine_orders
        where status = 'paid'
        order by created_at desc
        limit 30
      `;
      const scores = await sql<{
        user_id: string;
        name: string;
        total: number;
        level: number;
        hidden: boolean;
        supporter: boolean;
      }>`
        select user_id, name, total, level, hidden, supporter
        from mine_scores
        order by total desc
        limit 50
      `;
      return {
        ok: true,
        claimed: true,
        unlocked: true,
        config: lobby,
        totals: totals.map((item) => ({
          network: asNetwork(item.network),
          lamports: Number(item.lamports),
          count: Number(item.count),
        })),
        orders: orders.map((item) => ({
          id: item.id,
          payerName: item.payer_name,
          kind: item.kind === "tip" ? "tip" : "ant",
          lamports: Number(item.lamports),
          antCredit: Number(item.ant_credit),
          network: asNetwork(item.network),
          signature: item.signature,
          createdAt: item.created_at,
        })),
        scores: scores.map((item) => ({
          userId: item.user_id,
          name: item.name,
          total: Number(item.total),
          level: Number(item.level),
          hidden: item.hidden === true,
          supporter: item.supporter === true,
        })),
      };
    } catch (error) {
      return fail(error);
    }
  });

export const claimOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { key?: string; wallet?: string; network?: string }) => ({
    key: String(input?.key ?? "").slice(0, 80),
    wallet: String(input?.wallet ?? "").trim(),
    network: input?.network === "devnet" ? "devnet" : "mainnet",
  }))
  .handler(async ({ data }) => {
    try {
      const key = cleanKey(data.key);
      if (!isSolanaAddress(data.wallet)) throw new MineError("Paste a real Solana address.");
      const sql = await sqlClient();
      const row = await configRow(sql);
      if (row.owner_hash) throw new MineError("This mine already has an owner key.");
      const hashed = await hashKey(key);
      const updated = await sql<{ id: number }>`
        update mine_config
        set owner_salt = ${hashed.salt},
            owner_hash = ${hashed.hash},
            wallet = ${data.wallet},
            network = ${data.network},
            shop_enabled = true
        where id = 1 and owner_hash is null
        returning id
      `;
      if (updated.length === 0) throw new MineError("This mine already has an owner key.");
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });

export const saveOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    key?: string;
    wallet?: string;
    network?: string;
    shopEnabled?: boolean;
    multiplier?: number;
    announcement?: string;
    maintenance?: boolean;
    packs?: Pack[];
  }) => ({
    key: String(input?.key ?? "").slice(0, 80),
    wallet: String(input?.wallet ?? "").trim(),
    network: input?.network === "devnet" ? ("devnet" as const) : ("mainnet" as const),
    shopEnabled: input?.shopEnabled === true,
    multiplier: Number(input?.multiplier),
    announcement: cleanAnnouncement(String(input?.announcement ?? "")),
    maintenance: input?.maintenance === true,
    packs: Array.isArray(input?.packs) ? input.packs : [],
  }))
  .handler(async ({ context, data }) => {
    try {
      if (data.wallet && !isSolanaAddress(data.wallet)) throw new MineError("That Solana address isn't valid.");
      if (![1, 2, 3].includes(data.multiplier)) throw new MineError("Multiplier is 1×, 2×, or 3×.");
      if (data.packs.length < 1 || data.packs.length > 4) throw new MineError("Keep 1 to 4 packs.");
      const packs: Pack[] = [];
      for (const item of data.packs) {
        const pack = readPack(item);
        if (!pack) throw new MineError("Check each pack: name, 0.01–50 SOL, and $ANT.");
        packs.push(pack);
      }
      const ids = new Set(packs.map((pack) => pack.id));
      if (ids.size !== packs.length) throw new MineError("Pack ids have to be unique.");
      const shopEnabled = data.shopEnabled && data.wallet.length > 0;
      if (data.shopEnabled && !data.wallet) throw new MineError("Add a Solana address before opening the treasury.");
      const sql = await sqlClient();
      await requireOwner(sql, context.userId, data.key);
      await sql`
        update mine_config set
          wallet = ${data.wallet},
          network = ${data.network},
          shop_enabled = ${shopEnabled},
          multiplier = ${data.multiplier},
          announcement = ${data.announcement},
          maintenance = ${data.maintenance},
          packs_json = ${JSON.stringify(packs)}
        where id = 1
      `;
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });

export const setScoreHidden = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { key?: string; userId?: string; hidden?: boolean }) => ({
    key: String(input?.key ?? "").slice(0, 80),
    userId: String(input?.userId ?? "").slice(0, 80),
    hidden: input?.hidden === true,
  }))
  .handler(async ({ context, data }) => {
    try {
      if (!data.userId) throw new MineError("Missing score.");
      const sql = await sqlClient();
      await requireOwner(sql, context.userId, data.key);
      const updated = await sql<{ user_id: string }>`
        update mine_scores set hidden = ${data.hidden} where user_id = ${data.userId} returning user_id
      `;
      if (updated.length === 0) throw new MineError("That score is already gone.");
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  });
