// Generates manifest.json, images, the settings-panel catalogue and the bundled "DevOps" profile for DevOps Deck.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { FX, PRESET_ICONS, keySvg, monoSvg } from "../../shared/icons.js";
import { buildProfile, copyUi, writeActionImages, writer } from "../../tools/common.mjs";
import { DEVOPS_FX } from "./fx.js";
import { FEATURES, GROUPS } from "./features.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const UUID = "com.windowstoolkit.devops";
const NAME = "DevOps Deck";
const VERSION = "1.0.0.0";
const PROFILE = "profiles/DevOps";
const sd = join(here, `${UUID}.sdPlugin`);
const write = writer(sd);

Object.assign(FX, DEVOPS_FX);
for (const f of FEATURES) {
	if (!f.id.startsWith("dev-") || !DEVOPS_FX[f.glyph]) throw new Error(`Bad feature ${f.id} (glyph ${f.glyph})`);
	PRESET_ICONS[f.id] = { glyph: f.glyph, theme: f.theme, label: f.label ?? f.name, style: "glass" };
}

/** id (UUID suffix), list name, tooltip — order = order in the Stream Deck action list. */
const ACTIONS = FEATURES.map((f) => [f.id.slice(4), f.name, f.tip]);

writeActionImages(sd, FEATURES.map((f) => ({ id: f.id.slice(4), kind: f.id })));
// Plugin icon: a passing pipeline in the Vivid look, so it reads in Stream Deck's store and action list.
write("imgs/plugin/category.svg", monoSvg("dev-workflow", 28));
const logo = keySvg({ glyph: "dev-workflow", theme: "emerald", label: "", style: "vivid", data: { state: "ok", line: "" } });
for (const [file, size] of [["icon.png", 256], ["icon@2x.png", 512]]) write(`imgs/plugin/${file}`, new Resvg(logo, { fitTo: { mode: "width", value: size } }).render().asPng());

copyUi(sd);
// The settings panel draws the same art: fx.js is inlined (without its exports) into the panel's catalogue script.
const fxSource = readFileSync(join(here, "fx.js"), "utf8").replace(/^export /gm, "");
write("ui/features.js", `(() => {
${fxSource}
Object.assign(window.WinToolkitIcons.FX, DEVOPS_FX);
})();
window.WinToolkitFeatures = ${JSON.stringify({ groups: GROUPS, features: FEATURES })};
for (const { id, glyph, theme, label, name } of window.WinToolkitFeatures.features) {
	window.WinToolkitIcons.PRESET_ICONS[id] = { glyph, theme, label: label ?? name, style: "glass" };
}
`);
write("ui/companion.js", "// DevOps Deck has no companion app.\n");
write("features.json", JSON.stringify(FEATURES, null, "\t") + "\n");

/** Default layout for a 15-key Stream Deck (5 × 3), "column,row". */
const LAYOUT = {
	"0,0": "jenkins", "1,0": "gitlab", "2,0": "ghactions", "3,0": "jenkinsview", "4,0": "sonar",
	"0,1": "gitlabmr", "1,1": "ghprs", "2,1": "awx", "3,1": "k8s", "4,1": "awsalarms",
};
buildProfile({ sd, uuid: UUID, pluginName: NAME, version: VERSION, profile: PROFILE, title: "DevOps", layout: LAYOUT, actions: ACTIONS });

const manifest = {
	$schema: "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
	Name: NAME,
	Version: VERSION,
	Author: "Windows Toolkit",
	Description: "Live CI/CD and operations status on Stream Deck: Jenkins, GitLab, GitHub Actions, pull and merge requests, SonarQube quality gates, Ansible (AWX), Kubernetes pods and CloudWatch alarms. Tap to open, hold to start a run.",
	UUID,
	Icon: "imgs/plugin/icon",
	Category: NAME,
	CategoryIcon: "imgs/plugin/category",
	CodePath: "bin/plugin.js",
	PropertyInspectorPath: "ui/pi.html",
	SDKVersion: 2,
	Software: { MinimumVersion: "7.1" },
	OS: [{ Platform: "windows", MinimumVersion: "10" }],
	Nodejs: { Version: "20" },
	Profiles: [{ Name: PROFILE, DeviceType: 0, Readonly: false, DontAutoSwitchWhenInstalled: true, AutoInstall: true }],
	Actions: ACTIONS.map(([id, name, tip]) => ({
		Name: name,
		UUID: `${UUID}.${id}`,
		Icon: `imgs/actions/${id}`,
		Tooltip: tip,
		Controllers: ["Keypad"],
		States: [{ Image: `imgs/keys/${id}`, ShowTitle: false, TitleAlignment: "bottom" }],
	})),
};
write("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");
console.log(`Generated ${NAME}: ${ACTIONS.length} actions + layout "${PROFILE}"`);
