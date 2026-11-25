// API tokens for DevOps Deck. A token is encrypted with Windows DPAPI for the signed-in Windows user, bound to
// its server, and kept in the plugin's global settings — never in a key's settings, logs or profile exports.
// Decrypted tokens live only in memory.
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { globals, setGlobals } from "../../../shared/base.js";
import { ps } from "../../../shared/ps.js";

const DRY = process.platform !== "win32" || process.env.WINTOOLKIT_DRYRUN === "1";
type Vault = Record<string, string>;

/** "family|https://server" — one token per kind of server and address. */
export const slotOf = (family: string, origin: string) => `${family}|${origin.toLowerCase()}`;
const binding = (slot: string) => `devops-deck|${slot}`;

export function vault(): Vault {
	const v = globals.devopsSecrets;
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Vault) : {};
}
/** Last vault this process saw, to repair it if another writer drops it by mistake. */
let known: Vault | undefined;
export function rememberVault(): void { known = { ...vault() }; }
/** True when global settings arrived without the vault although we had one (e.g. an old settings panel wrote them). */
export function vaultDropped(): boolean { return globals.devopsSecrets === undefined && !!known && Object.keys(known).length > 0; }
export async function restoreVault(): Promise<void> {
	if (!known) return;
	const next = { ...globals, devopsSecrets: { ...known } };
	setGlobals(next);
	await streamDeck.settings.setGlobalSettings(next as JsonObject);
}

const plain = new Map<string, string>();

async function store(slot: string, blob: string | undefined): Promise<void> {
	const v = { ...vault() };
	if (blob) v[slot] = blob; else delete v[slot];
	const next = { ...globals, devopsSecrets: v };
	setGlobals(next);
	known = { ...v };
	await streamDeck.settings.setGlobalSettings(next as JsonObject);
}

/** Encrypts and saves a token. Returns an error message, or undefined when saved. */
export async function saveSecret(slot: string, value: string): Promise<string | undefined> {
	const t = value.trim();
	if (!t) return "Paste the token first.";
	if (t.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(t)) return "That doesn't look like a token (spaces or line breaks).";
	let blob: string;
	if (DRY) blob = "dry:" + Buffer.from(t, "utf8").toString("base64"); // tests only: no DPAPI outside Windows
	else {
		const r = await ps.run("secret-protect", [t, binding(slot)], 20_000);
		if (r.status !== "ok" || !r.message.startsWith("dpapi:v1:")) return "Windows couldn't encrypt the token, so it wasn't saved.";
		blob = r.message;
	}
	plain.set(blob, t);
	await store(slot, blob);
	return undefined;
}

export async function clearSecret(slot: string): Promise<void> {
	const blob = vault()[slot];
	if (blob) plain.delete(blob);
	await store(slot, undefined);
}

export const hasSecret = (slot: string) => !!vault()[slot];

/** The token for a server, or undefined when none is saved or it can't be decrypted (e.g. another Windows user). */
export async function readSecret(slot: string): Promise<string | undefined> {
	const blob = vault()[slot];
	if (!blob) return undefined;
	const have = plain.get(blob);
	if (have) return have;
	if (blob.startsWith("dry:")) {
		if (!DRY) return undefined;
		const t = Buffer.from(blob.slice(4), "base64").toString("utf8");
		plain.set(blob, t);
		return t;
	}
	if (DRY || !blob.startsWith("dpapi:v1:")) return undefined;
	const r = await ps.run("secret-unprotect", [blob, binding(slot)], 20_000);
	if (r.status !== "ok" || !r.message) return undefined;
	plain.set(blob, r.message);
	return r.message;
}
