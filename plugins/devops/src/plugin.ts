import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { mkdirSync, writeFileSync } from "node:fs";
import { REGISTRY, globals, setDefaultStyle, setGlobals, repaintEverything, watchWindowsMotion } from "../../../shared/base.js";
import { FX } from "../../../shared/icons.js";
import { ps } from "../../../shared/ps.js";
import { DEVOPS_FX } from "../fx.js";
import { FEATURES, makeKeys, pollNow, secretSlotFor } from "./keys.js";
import { clearSecret, hasSecret, rememberVault, restoreVault, saveSecret, vaultDropped } from "./secrets.js";

// DevOps Deck draws its own status art on the shared key renderer, in the quiet Glass look by default.
Object.assign(FX, DEVOPS_FX);
setDefaultStyle("glass");

streamDeck.logger.setLevel("info");
const log = streamDeck.logger.createScope("plugin");

for (const K of makeKeys()) streamDeck.actions.registerAction(new K());

const familyOf = (manifestId: string) => FEATURES.find((f) => manifestId.endsWith("." + f.id.slice(4)))?.secret;
const where = (slot: string) => slot.split("|")[1]?.replace(/^https?:\/\//, "") ?? "";

/** Settings panel ➜ plugin messages (same protocol as Windows Toolkit, plus encrypted tokens). */
streamDeck.ui.onSendToPlugin<{ event?: string; settings?: JsonObject; key?: string; value?: string }>(async (ev) => {
	const p = ev.payload ?? {};
	const event = p.event;
	if (event === "secretSave" || event === "secretClear" || event === "secretInfo") {
		const key = typeof p.key === "string" ? p.key : "token";
		const settings = p.settings ?? ((await ev.action.getSettings()) as JsonObject);
		const slot = secretSlotFor(ev.action.manifestId, settings);
		const reply = (message: string, error = false) => streamDeck.ui.sendToPropertyInspector({ event: "secretStatus", key, message, error });
		if (!slot) { await reply("Enter the server address above first; tokens are saved per server.", event === "secretSave"); return; }
		if (event === "secretSave") {
			const err = await saveSecret(slot, typeof p.value === "string" ? p.value : "");
			if (err) { await reply(err, true); return; }
			log.info(`token saved for ${where(slot)}`);
			await reply(`Saved for ${where(slot)}, encrypted for your Windows account.`);
			pollNow(familyOf(ev.action.manifestId));
			return;
		}
		if (event === "secretClear") {
			await clearSecret(slot);
			log.info(`token removed for ${where(slot)}`);
			await reply(`Removed the token for ${where(slot)}.`);
			pollNow(familyOf(ev.action.manifestId));
			return;
		}
		await reply(hasSecret(slot) ? `A token is saved for ${where(slot)} (encrypted). Paste a new one to replace it.` : `No token saved for ${where(slot)} yet.`);
		return;
	}
	if (event === "getIcon" || event === "refreshIcon") {
		const inst = REGISTRY.get(ev.action.manifestId);
		if (!inst) return;
		const settings = p.settings ?? ((await ev.action.getSettings()) as JsonObject);
		if (event === "refreshIcon") await inst.refreshIcon(settings);
		const rendered = await inst.imageFinal(settings);
		await streamDeck.ui.sendToPropertyInspector({ event: "icon", ...rendered, token: JSON.stringify(settings) });
	}
});

ps.start();
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
	setGlobals(ev.settings);
	// A settings panel that never saw the saved tokens must not wipe them.
	if (vaultDropped()) { log.warn("global settings arrived without saved tokens; keeping them"); void restoreVault(); }
	else rememberVault();
	void repaintEverything();
});
watchWindowsMotion();

await streamDeck.connect();
try {
	Object.assign(globals, await streamDeck.settings.getGlobalSettings());
	rememberVault();
	pollNow();
} catch (e) {
	log.warn(`global settings: ${(e as Error).message}`);
}

// A fresh receipt lets the installer verify this connected SDK process without reading settings.
try {
	mkdirSync(new URL("../logs/", import.meta.url), { recursive: true });
	writeFileSync(new URL("../logs/installer-ready.json", import.meta.url), JSON.stringify({ pid: process.pid, readyAt: new Date().toISOString() }), "utf8");
} catch { log.warn("Installer startup receipt could not be written"); }
