// A throwaway wallet for one-off public actions such as keeping a vault alive. It holds no data and is
// discarded with the tab.
import { walletClient } from "@dhadkan/core";
import { newSecret } from "./keys";
import { ensureGas } from "./tap";

let session: ReturnType<typeof newSecret> | null = null;

export async function sessionWallet() {
  session ??= newSecret();
  await ensureGas(session.account.address);
  return walletClient(session.account);
}
