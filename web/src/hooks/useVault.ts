import { loadVault, watchVault, type VaultView } from "@proof-of-life/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useI18n } from "../lib/i18n";
import { read, sockets } from "../lib/net";

export type LiveEvent = { at: number; text: string; tx?: Hex };

/**
 * Loads a vault with one query, then follows it over a WebSocket. Check-ins arrive as events; the lapse,
 * which fires no event, is caught by a timer set from the heartbeat's own expiry and confirmed by a re-query.
 */
export function useVault(vaultId: Hex, creator: Hex) {
  const { t } = useI18n();
  const [view, setView] = useState<VaultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const v = await read((c) => loadVault(c, vaultId, creator));
      setView(v);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, [vaultId, creator]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hbKey = view?.heartbeat?.key ?? null;
  const lapse = view?.status.blocksToLapse ?? null;
  const custodians = view?.manifest.custodians.map((c) => c.address as Hex).join(",") ?? "";

  useEffect(() => {
    if (!view) return;
    const push = (e: LiveEvent) => setEvents((xs) => [e, ...xs].slice(0, 20));
    let stop = () => {};
    try {
      stop = watchVault(
        sockets(),
        { heartbeatKey: hbKey, custodians: custodians ? (custodians.split(",") as Hex[]) : [], creator, lapseInBlocks: lapse },
        (s) => {
          if (s.kind === "checkin") push({ at: Date.now(), text: t("ev_checkin", { b: String(s.blockNumber) }), tx: s.txHash });
          if (s.kind === "activity") push({ at: Date.now(), text: t("ev_activity", { b: String(s.blockNumber) }), tx: s.txHash });
          if (s.kind === "deadline") push({ at: Date.now(), text: t("ev_deadline") });
          setTimeout(refresh, s.kind === "deadline" ? 0 : 800);
        },
      );
    } catch {}
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hbKey, lapse, custodians, creator, refresh, !!view]);

  return { view, error, refresh, fetchedAt, events };
}

/** The current block, estimated between reads from the 2-second block time. */
export function useHead(head: bigint | undefined, fetchedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (head === undefined) return { head: undefined, secondsSince: 0 };
  const secondsSince = (now - fetchedAt) / 1000;
  return { head: head + BigInt(Math.floor(secondsSince / 2)), secondsSince };
}
