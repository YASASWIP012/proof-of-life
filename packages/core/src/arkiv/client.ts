import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket, type Account } from "viem";

export const TIRAMISU = {
  chainId: 7738577,
  rpc: "https://rpc.tiramisu.db-chain.testnet.arkiv.network",
  ws: "wss://rpc.tiramisu.db-chain.testnet.arkiv.network",
  explorer: "https://tiramisu.explorer.arkiv.network",
} as const;

export type Endpoints = { rpc?: string; ws?: string };

export const publicClient = (e: Endpoints = {}) =>
  createPublicClient({ chain: tiramisu, transport: http(e.rpc ?? TIRAMISU.rpc, { retryCount: 1, timeout: 20_000 }) });

/** Event watching only opens a real socket over a WebSocket transport; over HTTP it silently polls. */
export const socketClient = (e: Endpoints = {}) =>
  createPublicClient({ chain: tiramisu, transport: webSocket(e.ws ?? TIRAMISU.ws, { reconnect: true }) });

export const walletClient = (account: Account, e: Endpoints = {}) =>
  createWalletClient({ chain: tiramisu, account, transport: http(e.rpc ?? TIRAMISU.rpc, { retryCount: 0, timeout: 60_000 }) });

export type PublicClient = ReturnType<typeof publicClient>;
export type SocketClient = ReturnType<typeof socketClient>;
export type WalletClient = ReturnType<typeof walletClient>;

export const explorerTx = (hash: string) => `${TIRAMISU.explorer}/tx/${hash}`;
export const explorerAddress = (a: string) => `${TIRAMISU.explorer}/address/${a}`;
