// Simulated Stream Deck + mock CI servers for DevOps Deck. Runs the real built plugin (bin/plugin.js) in dry-run mode:
// HTTP keys talk to a local mock of Jenkins / GitLab / GitHub Enterprise / SonarQube / AWX; kubectl and aws are
// small fake programs on PATH. Checks key art, tokens (encrypted slot, never in key settings), tap, hold-to-run.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const UUID = "com.windowstoolkit.devops";
const sd = join(here, `${UUID}.sdPlugin`);
const manifest = JSON.parse(readFileSync(join(sd, "manifest.json"), "utf8"));
const features = JSON.parse(readFileSync(join(sd, "features.json"), "utf8"));
const runDir = mkdtempSync(join(tmpdir(), "devops-deck-test-"));
const LOG = join(runDir, "dryrun.jsonl");
const CLI_LOG = join(runDir, "cli.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra && !ok ? "  — " + extra : ""}`); };

/* ---------------- mock servers ---------------- */
const TOKENS = { jenkins: "jk-11aa22bb33cc", gitlab: "glpat-TESTTOKEN123", github: "ghp_testTOKEN456", sonar: "squ_testTOKEN789", awx: "awx-TESTTOKEN000" };
const hits = [];
const now = Date.now();
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const basicOk = (req, user, pass) => req.headers.authorization === "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const server = createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		const u = new URL(req.url, "http://x");
		hits.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body });
		const p = u.pathname;
		// Jenkins
		if (p === "/job/app/job/main/lastBuild/api/json") return json(res, 200, { number: 128, result: "SUCCESS", building: false, duration: 252000, estimatedDuration: 250000, timestamp: now - 600000, url: `http://${req.headers.host}/job/app/job/main/128/` });
		if (p === "/job/secure/lastBuild/api/json") return basicOk(req, "ci-bot", TOKENS.jenkins) ? json(res, 200, { number: 7, result: null, building: true, duration: 0, estimatedDuration: 100000, timestamp: Date.now() - 40000 }) : json(res, 401, {});
		if (p === "/job/app/job/main/buildWithParameters" && req.method === "POST") return basicOk(req, "ci-bot", TOKENS.jenkins) ? (res.writeHead(201), res.end()) : json(res, 401, {});
		if (p === "/job/secure/build" && req.method === "POST") return basicOk(req, "ci-bot", TOKENS.jenkins) ? (res.writeHead(201), res.end()) : json(res, 401, {});
		if (p === "/view/Team/api/json") return json(res, 200, { jobs: [{ name: "a", color: "blue" }, { name: "b", color: "red" }, { name: "c", color: "red_anime" }, { name: "d", color: "yellow" }, { name: "e", color: "disabled" }] });
		if (p === "/login") return json(res, 200, {});
		if (p === "/redirect/job/x/lastBuild/api/json") { res.writeHead(302, { location: "/login" }); return res.end(); }
		// GitLab
		const gl = req.headers["private-token"] === TOKENS.gitlab;
		if (p === "/api/v4/projects/group%2Fapp/pipelines" || p === "/api/v4/projects/group/app/pipelines") return json(res, 200, [{ id: 9, iid: 45, status: "failed", ref: "main", web_url: `http://${req.headers.host}/group/app/-/pipelines/9`, created_at: new Date(now - 900000).toISOString(), updated_at: new Date(now - 700000).toISOString() }]);
		if (/^\/api\/v4\/projects\/group(%2F|\/)app\/pipelines\/9$/.test(p)) return json(res, 200, { id: 9, duration: 184 });
		if (/^\/api\/v4\/projects\/group(%2F|\/)app$/.test(p)) return gl ? json(res, 200, { default_branch: "main" }) : json(res, 401, {});
		if (/^\/api\/v4\/projects\/group(%2F|\/)app\/pipeline$/.test(p) && req.method === "POST") return gl ? json(res, 201, { id: 10 }) : json(res, 401, {});
		if (p === "/api/v4/user") return gl ? json(res, 200, { username: "nikhil" }) : json(res, 401, {});
		if (p === "/api/v4/merge_requests") return gl ? json(res, 200, [{}], { "x-total": "3" }) : json(res, 401, {});
		// GitHub Enterprise Server (same API as github.com under /api/v3)
		const gh = req.headers.authorization === `Bearer ${TOKENS.github}`;
		if (p === "/api/v3/repos/acme/web/actions/workflows/ci.yml/runs") return json(res, 200, { workflow_runs: [{ run_number: 88, status: "completed", conclusion: "success", html_url: `http://${req.headers.host}/acme/web/actions/runs/1`, run_started_at: new Date(now - 300000).toISOString(), created_at: new Date(now - 300000).toISOString(), updated_at: new Date(now - 140000).toISOString() }] });
		if (p === "/api/v3/repos/acme/web") return json(res, 200, { default_branch: "main" });
		if (p === "/api/v3/repos/acme/web/actions/workflows/ci.yml/dispatches" && req.method === "POST") return gh ? (res.writeHead(204), res.end()) : json(res, 401, {});
		if (p === "/api/v3/search/issues") return gh ? json(res, 200, { total_count: 12, items: [] }) : json(res, 401, {});
		// SonarQube under a context path
		const so = req.headers.authorization === "Basic " + Buffer.from(`${TOKENS.sonar}:`).toString("base64");
		if (p === "/sonar/api/qualitygates/project_status") return so ? json(res, 200, { projectStatus: { status: "ERROR" } }) : json(res, 401, {});
		if (p === "/sonar/api/measures/component") return so ? json(res, 200, { component: { measures: [{ metric: "coverage", value: "61.24" }] } }) : json(res, 401, {});
		// AWX / AAP 2.5 gateway (the old /api/v2 path is gone → the key falls back)
		const ax = req.headers.authorization === `Bearer ${TOKENS.awx}`;
		if (p.startsWith("/api/v2/")) return json(res, 404, {});
		if (p === "/api/controller/v2/job_templates/7/jobs/") return ax ? json(res, 200, { results: [{ id: 312, status: "successful", elapsed: 72.4, name: "Deploy web" }] }) : json(res, 401, {});
		if (p === "/api/controller/v2/job_templates/7/launch/" && req.method === "POST") return ax ? json(res, 201, { job: 313 }) : json(res, 401, {});
		json(res, 404, {});
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ---------------- fake kubectl / aws on PATH ---------------- */
const bin = join(runDir, "bin");
const fake = (name, out) => {
	const js = join(runDir, `${name}.cjs`);
	writeFileSync(js, `require("fs").appendFileSync(${JSON.stringify(CLI_LOG)}, JSON.stringify({ name: ${JSON.stringify(name)}, args: process.argv.slice(2), pager: process.env.AWS_PAGER }) + "\\n"); process.stdout.write(${JSON.stringify(JSON.stringify(out))});`);
	if (process.platform === "win32") writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`);
	else { writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); chmodSync(join(bin, name), 0o755); }
};
(await import("node:fs")).mkdirSync(bin);
fake("kubectl", { items: [
	{ status: { phase: "Running", containerStatuses: [{ ready: true }] } },
	{ status: { phase: "Running", containerStatuses: [{ ready: true }] } },
	{ status: { phase: "Running", containerStatuses: [{ ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }] } },
	{ status: { phase: "Succeeded", containerStatuses: [] } },
] });
fake("aws", [2, 0]);
const cliCalls = () => (existsSync(CLI_LOG) ? readFileSync(CLI_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/* ---------------- fake Stream Deck ---------------- */
const wss = new WebSocketServer({ port: 0 });
const sent = [];
let sock, globalSettings = {};
wss.on("connection", (s) => {
	sock = s;
	s.on("message", (d) => {
		const m = JSON.parse(d.toString());
		sent.push(m);
		if (m.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", payload: { settings: globalSettings } });
		if (m.event === "setGlobalSettings") globalSettings = m.payload;
	});
});
const send = (m) => sock.send(JSON.stringify(m));
const waitFor = async (pred, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const hit = sent.find(pred); if (hit) return hit; await sleep(25); } return undefined; };
const dry = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const image = (m) => decodeURIComponent(m.payload.image);
const lastImage = (ctx) => { const m = [...sent].reverse().find((x) => x.event === "setImage" && x.context === ctx); return m ? image(m) : ""; };
const waitImage = async (ctx, text, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (lastImage(ctx).includes(text)) return true; await sleep(40); } return false; };

const settingsOf = {};
const ev = (event, id, ctx, settings, extra = {}) => send({ event, action: `${UUID}.${id}`, context: ctx, device: "DEV1", payload: { settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0, ...extra } });
const appear = (id, ctx, settings) => { settingsOf[ctx] = { id, settings }; ev("willAppear", id, ctx, settings); };
const disappear = (ctx) => ev("willDisappear", settingsOf[ctx].id, ctx, settingsOf[ctx].settings);
const changeSettings = (ctx, settings) => { settingsOf[ctx].settings = settings; ev("didReceiveSettings", settingsOf[ctx].id, ctx, settings); };
const press = async (ctx, holdMs = 40) => { const { id, settings } = settingsOf[ctx]; ev("keyDown", id, ctx, settings); await sleep(holdMs); ev("keyUp", id, ctx, settings); };
// The SDK only answers the settings panel that is open, so open the key's panel first (closing any other).
let panel;
const toPlugin = (ctx, payload) => {
	const act = (c) => `${UUID}.${settingsOf[c].id}`;
	if (panel !== ctx) {
		if (panel) send({ event: "propertyInspectorDidDisappear", action: act(panel), context: panel, device: "DEV1" });
		send({ event: "propertyInspectorDidAppear", action: act(ctx), context: ctx, device: "DEV1" });
		panel = ctx;
	}
	send({ event: "sendToPlugin", action: act(ctx), context: ctx, payload });
};
const piReplies = () => sent.filter((m) => m.event === "sendToPropertyInspector").map((m) => m.payload);

const info = { application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.22631", version: "7.1.0.21000" }, colors: {}, devicePixelRatio: 2, devices: [{ id: "DEV1", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }], plugin: { uuid: UUID, version: manifest.Version } };
const proc = spawn(process.execPath, [join(sd, "bin/plugin.js"), "-port", String(wss.address().port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
	cwd: sd,
	env: { ...process.env, WINTOOLKIT_DRYRUN: "1", WINTOOLKIT_DRYRUN_LOG: LOG, PATH: bin + delimiter + process.env.PATH },
	stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
proc.stdout.on("data", (d) => (out += d));
proc.stderr.on("data", (d) => (out += d));

try {
	check("plugin registers", !!(await waitFor((m) => m.event === "registerPlugin")));
	send({ event: "deviceDidConnect", device: "DEV1", deviceInfo: { name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 } });

	// --- package
	check("manifest has the 10 DevOps keys", manifest.Actions.length === 10 && features.length === 10 && manifest.Actions.every((a) => a.UUID.startsWith(UUID + ".")));
	check("manifest bundles the DevOps layout", manifest.Profiles?.[0]?.Name === "profiles/DevOps" && existsSync(join(sd, "profiles/DevOps.streamDeckProfile")));
	check("every key has art and an action-list icon", manifest.Actions.every((a) => existsSync(join(sd, a.States[0].Image + ".svg")) && existsSync(join(sd, a.Icon + ".svg"))));
	check("static key art uses the Glass look", manifest.Actions.every((a) => readFileSync(join(sd, a.States[0].Image + ".svg"), "utf8").includes('data-style="glass"')));
	const featuresJs = readFileSync(join(sd, "ui/features.js"), "utf8");
	check("settings panel gets the DevOps art and fields", featuresJs.includes("Object.assign(window.WinToolkitIcons.FX, DEVOPS_FX)") && !/^export /m.test(featuresJs) && featuresJs.includes('"type":"secret"'));
	check("settings panel maps devops actions to dev- keys", readFileSync(join(sd, "ui/pi.js"), "utf8").includes('"com.windowstoolkit.devops.": "dev-"'));

	// --- live status from each kind of server
	appear("jenkins", "c-jenkins", { url: `${ORIGIN}/job/app/job/main/`, params: "BRANCH=main&ENV=staging", user: "ci-bot" });
	check("Jenkins: last build passed, with number and duration", await waitImage("c-jenkins", "#128 · 4m 12s"), lastImage("c-jenkins").slice(-400));
	check("Jenkins: key is labelled with the job name", /&gt;main&lt;|>MAIN<|>main</i.test(lastImage("c-jenkins")));
	check("Jenkins: passing build turns the key green", lastImage("c-jenkins").includes("#2BD67B"));
	const frames = sent.filter((m) => m.event === "setImage" && m.context === "c-jenkins").slice(-4).map(image);
	await sleep(400);
	check("Jenkins: art animates while visible", new Set([...frames, lastImage("c-jenkins")]).size >= 2);

	appear("jenkinsview", "c-view", { url: `${ORIGIN}/view/Team/` });
	check("Jenkins Health: counts failing jobs", await waitImage("c-view", "2 FAILING"));

	appear("gitlab", "c-gitlab", { url: `${ORIGIN}/group/app`, branch: "main" });
	check("GitLab: failed pipeline with iid and duration", await waitImage("c-gitlab", "#45 · 3m 04s"), lastImage("c-gitlab").slice(-300));
	check("GitLab: asks for the branch's pipelines", hits.some((h) => h.path.endsWith("/pipelines") && h.search.includes("ref=main")));

	appear("ghactions", "c-gha", { url: `${ORIGIN}/acme/web`, workflow: "ci.yml", branch: "main" });
	check("GitHub Actions (Enterprise): last run passed", await waitImage("c-gha", "#88 · 2m 40s"), lastImage("c-gha").slice(-300));
	check("GitHub Actions: sends the GitHub API headers", hits.some((h) => h.path.includes("/actions/workflows/ci.yml/runs") && h.headers["x-github-api-version"] === "2022-11-28"));

	appear("sonar", "c-sonar", { url: `${ORIGIN}/sonar/dashboard?id=my-app` });
	check("Quality Gate: no token on a private server → asks for one", await waitImage("c-sonar", "CHECK TOKEN"));

	appear("awx", "c-awx", { url: `${ORIGIN}/#/templates/job_template/7/details` });
	check("Ansible: no token → ADD TOKEN, nothing sent to the server", (await waitImage("c-awx", "ADD TOKEN")) && !hits.some((h) => h.path.includes("job_templates")));

	appear("k8s", "c-k8s", { namespace: "prod", context: "aks-west" });
	check("Kubernetes: a crash-looping pod turns the key red", (await waitImage("c-k8s", "1 CRASHING")) && lastImage("c-k8s").includes("#FF4D5E"));
	const kc = cliCalls().find((c) => c.name === "kubectl");
	check("Kubernetes: kubectl gets namespace and context as separate arguments", kc && kc.args.join(" ") === "get pods -o json --request-timeout=10s --namespace prod --context aks-west", JSON.stringify(kc));

	appear("awsalarms", "c-aws", { region: "eu-west-1", profile: "prod" });
	check("CloudWatch: firing alarms counted", await waitImage("c-aws", "2 FIRING"));
	const ac = cliCalls().find((c) => c.name === "aws");
	check("CloudWatch: aws CLI called for the region and profile, pager off", ac && ac.args.includes("eu-west-1") && ac.args.includes("prod") && ac.pager === "", JSON.stringify(ac));

	appear("k8s", "c-k8s-bad", { namespace: "prod; rm -rf /" });
	check("Kubernetes: a bad namespace is refused before kubectl runs", (await waitImage("c-k8s-bad", "CHECK NAMESPACE")) && !cliCalls().some((c) => c.args.join(" ").includes("rm -rf")));

	appear("jenkins", "c-file", { url: "file:///C:/Windows/System32/calc.exe" });
	await sleep(600);
	const d0 = dry().length;
	await press("c-file");
	await sleep(300);
	check("only http(s) addresses: a file: address opens nothing", !dry().slice(d0).some((c) => c.command === "url") && sent.some((m) => m.event === "showAlert" && m.context === "c-file"));

	// --- tokens: encrypted per server, never in a key's settings
	appear("jenkins", "c-secure", { url: `${ORIGIN}/job/secure/`, user: "ci-bot" });
	check("private Jenkins job without a token → CHECK TOKEN", await waitImage("c-secure", "CHECK TOKEN"));
	toPlugin("c-secure", { event: "secretInfo", key: "token", settings: settingsOf["c-secure"].settings });
	check("panel is told no token is saved yet", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && /No token saved for 127\.0\.0\.1/.test(m.payload?.message ?? ""))));
	toPlugin("c-secure", { event: "secretSave", key: "token", value: `  ${TOKENS.jenkins}  `, settings: settingsOf["c-secure"].settings });
	check("token saved → panel confirms", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && /^Saved for 127\.0\.0\.1:\d+/.test(m.payload?.message ?? ""))));
	const slot = `jenkins|${ORIGIN}`;
	check("token stored in the plugin's vault, per server", typeof globalSettings.devopsSecrets?.[slot] === "string");
	check("token never stored as plain text in settings", !JSON.stringify(globalSettings).includes(TOKENS.jenkins) && !sent.some((m) => m.event === "setSettings" && JSON.stringify(m).includes(TOKENS.jenkins)));
	check("token used: private job now shows its running build", await waitImage("c-secure", "#7 4"), lastImage("c-secure").slice(-300));
	check("token never written to the log", !out.includes(TOKENS.jenkins));
	toPlugin("c-secure", { event: "secretSave", key: "token", value: "has space inside", settings: settingsOf["c-secure"].settings });
	check("a value with spaces is refused", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.error && /spaces/.test(m.payload.message))));
	toPlugin("c-file", { event: "secretSave", key: "token", value: "abc", settings: settingsOf["c-file"].settings });
	check("no token is saved before a server address is set", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.error && /server address/.test(m.payload.message))));

	// A panel that never saw the vault writes global settings without it: the plugin puts it back.
	const before = sent.filter((m) => m.event === "setGlobalSettings").length;
	globalSettings = { lookDefaults: { iconStyle: "vivid", at: 1 } };
	send({ event: "didReceiveGlobalSettings", payload: { settings: globalSettings } });
	await sleep(300);
	check("tokens survive another writer dropping them", sent.filter((m) => m.event === "setGlobalSettings").length > before && !!globalSettings.devopsSecrets?.[slot] && globalSettings.lookDefaults?.iconStyle === "vivid");

	// --- tap opens the page; hold starts a run
	const d1 = dry().length, posts1 = hits.filter((h) => h.method === "POST").length;
	await press("c-jenkins", 60);
	await sleep(300);
	const opened = dry().slice(d1).find((c) => c.command === "url");
	check("tap opens the last build's page", opened?.args[0] === `${ORIGIN}/job/app/job/main/128/`, JSON.stringify(opened));
	check("tap never starts a build", hits.filter((h) => h.method === "POST").length === posts1);

	toPlugin("c-gitlab", { event: "secretSave", key: "token", value: TOKENS.gitlab, settings: settingsOf["c-gitlab"].settings });
	await waitFor((m) => m.event === "sendToPropertyInspector" && /Saved for/.test(m.payload?.message ?? "") && sent.filter((x) => x.event === "sendToPropertyInspector" && /Saved for/.test(x.payload?.message ?? "")).length >= 2);

	// Jenkins job with parameters: hold 1.3 s.
	{
		const { id, settings } = settingsOf["c-jenkins"];
		ev("keyDown", id, "c-jenkins", settings);
		await sleep(650);
		check("hold: a red ring fills before anything starts", lastImage("c-jenkins").includes('stroke="#FF4D5E" stroke-width="7"') && !hits.some((h) => h.method === "POST" && h.path.includes("/job/app/")));
		await sleep(650);
		ev("keyUp", id, "c-jenkins", settings);
	}
	await sleep(500);
	const build = hits.find((h) => h.method === "POST" && h.path === "/job/app/job/main/buildWithParameters");
	check("hold 1 s: Jenkins build with parameters, using the saved token", build && build.search === "?BRANCH=main&ENV=staging" && build.headers.authorization?.startsWith("Basic "), JSON.stringify(build?.search));
	check("hold: key shows STARTING right away", lastImage("c-jenkins").includes("STARTING") || lastImage("c-jenkins").includes("#128"));
	check("hold: ✓ shown", sent.some((m) => m.event === "showOk" && m.context === "c-jenkins"));
	check("hold: the build is opened nowhere (no tap)", !dry().slice(d1 + 1).some((c) => c.command === "url" && c.args[0].includes("/job/app/")));

	// Short press shorter than the hold never triggers.
	const posts2 = hits.filter((h) => h.method === "POST").length;
	await press("c-gitlab", 500);
	await sleep(300);
	check("a half-second press doesn't run a pipeline", hits.filter((h) => h.method === "POST").length === posts2);
	await press("c-gitlab", 1300);
	await sleep(600);
	const pipe = hits.find((h) => h.method === "POST" && /\/pipeline$/.test(h.path));
	check("hold 1 s: GitLab pipeline on the chosen branch with PRIVATE-TOKEN", pipe && pipe.search === "?ref=main" && pipe.headers["private-token"] === TOKENS.gitlab, JSON.stringify(pipe?.search));

	// Hold-to-run switched off: hold does nothing.
	changeSettings("c-gha", { ...settingsOf["c-gha"].settings, run: false });
	await sleep(200);
	const posts3 = hits.filter((h) => h.method === "POST").length;
	await press("c-gha", 1300);
	await sleep(400);
	check("hold-to-run switched off → nothing starts", hits.filter((h) => h.method === "POST").length === posts3);
	changeSettings("c-gha", { ...settingsOf["c-gha"].settings, run: true });
	toPlugin("c-gha", { event: "secretSave", key: "token", value: TOKENS.github, settings: settingsOf["c-gha"].settings });
	await sleep(400);
	await press("c-gha", 1300);
	await sleep(600);
	const disp = hits.find((h) => h.method === "POST" && h.path.endsWith("/dispatches"));
	check("hold 1 s: GitHub workflow_dispatch on the branch", disp && JSON.parse(disp.body).ref === "main" && disp.headers.authorization === `Bearer ${TOKENS.github}`);

	// Pull requests and merge requests with tokens
	// The Actions key above saved a GitHub token for this server: Pull Requests on the same server reuses it.
	appear("ghprs", "c-prs2", { url: ORIGIN });
	toPlugin("c-prs2", { event: "secretInfo", key: "token", settings: { url: ORIGIN } });
	check("Pull Requests: panel says the same server's token is already saved", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && /A token is saved/.test(m.payload?.message ?? ""))));
	appear("ghprs", "c-prs-other", { url: "http://127.0.0.2:9" });
	check("Pull Requests: another server without a token → ADD TOKEN", await waitImage("c-prs-other", "ADD TOKEN"));
	check("Pull Requests: 12 waiting for review", await waitImage("c-prs2", "12 TO REVIEW"));
	const search = hits.find((h) => h.path === "/api/v3/search/issues");
	check("Pull Requests: searches open PRs requesting my review", search && decodeURIComponent(search.search).includes("review-requested:@me"));
	appear("gitlabmr", "c-mrs", { url: ORIGIN });
	check("Merge Requests: 3 waiting for review", await waitImage("c-mrs", "3 TO REVIEW"));
	check("Merge Requests: filters by my reviewer name", hits.some((h) => h.path === "/api/v4/merge_requests" && h.search.includes("reviewer_username=nikhil")));

	toPlugin("c-sonar", { event: "secretSave", key: "token", value: TOKENS.sonar, settings: settingsOf["c-sonar"].settings });
	check("Quality Gate: failed gate with coverage once the token is saved", await waitImage("c-sonar", "FAILED · 61.2%"), lastImage("c-sonar").slice(-300));
	toPlugin("c-awx", { event: "secretSave", key: "token", value: TOKENS.awx, settings: settingsOf["c-awx"].settings });
	check("Ansible: falls back to the AAP 2.5 API and shows the last job", await waitImage("c-awx", "#312 · 1m 12s"), lastImage("c-awx").slice(-300));
	await press("c-awx", 1300);
	await sleep(600);
	check("hold 1 s: Ansible template launched on the right API", hits.some((h) => h.method === "POST" && h.path === "/api/controller/v2/job_templates/7/launch/" && h.headers.authorization === `Bearer ${TOKENS.awx}`));

	// Clear a token: keys go back to asking for one.
	toPlugin("c-awx", { event: "secretClear", key: "token", settings: settingsOf["c-awx"].settings });
	check("token cleared → key asks for a token again", await waitImage("c-awx", "ADD TOKEN") && !globalSettings.devopsSecrets?.[`awx|${ORIGIN}`]);

	// Redirect to a sign-in page is not followed.
	appear("jenkins", "c-redirect", { url: `${ORIGIN}/redirect/job/x/` });
	check("a redirect to a sign-in page is not followed", (await waitImage("c-redirect", "CHECK TOKEN")) && !hits.some((h) => h.path === "/login"));

	// Settings panel preview still works.
	toPlugin("c-jenkins", { event: "getIcon", settings: settingsOf["c-jenkins"].settings });
	check("settings panel gets a preview image", !!(await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.event === "icon")));

	// Keys stop polling when they leave the screen.
	disappear("c-view");
	await sleep(200);
	const viewHits = hits.filter((h) => h.path === "/view/Team/api/json").length;
	await sleep(1500);
	check("keys stop reading when they leave the screen", hits.filter((h) => h.path === "/view/Team/api/json").length === viewHits);
	check("no plugin errors", !/TypeError|ReferenceError|Unhandled|ERROR/.test(out), out.split("\n").filter((l) => /Error|ERROR/.test(l)).slice(0, 3).join(" | "));
} catch (e) {
	check("harness", false, e.stack);
} finally {
	proc.kill();
	wss.close();
	server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
