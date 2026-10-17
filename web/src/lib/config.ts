// Where the app reads and asks for gas. Reads go straight to Arkiv; the relay is only a fallback for the keyless budget.
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://dhadkan.vercel.app";
export const RELAY_RPC = `${API_BASE}/api/rpc`;
export const TAP_URL = `${API_BASE}/api/tap`;
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://dhadkan.vercel.app";
export const REPO_URL = "https://github.com/YASASWIP012/dhadkan";
