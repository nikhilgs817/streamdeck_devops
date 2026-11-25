// DevOps Deck keys. One generic action class per row of features.json (generated from features.mjs).
// Each key polls its server while it is visible, draws the result with the art in fx.js, opens the page on a tap,
// and — for keys with `trigger` — starts a run after a 1-second hold (a red ring fills first).
import { action, type Action, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { DEFAULT_STYLE, ToolkitAction, log, type Appearance } from "../../../shared/base.js";
import { PRESET_ICONS, keySvg, svgDataUri } from "../../../shared/icons.js";
import { ps, type PsResult } from "../../../shared/ps.js";
import { STATE_THEME } from "../fx.js";
import { HttpError, getJson, http, webUrl, type Options } from "./http.js";
import { readSecret, slotOf } from "./secrets.js";

type Field = { key: string; label: string; type: string; def?: string | number | boolean };
export type Feature = { id: string; group: string; name: string; glyph: string; theme: string; label?: string; tip: string; secret?: string; trigger?: boolean; fields?: Field[] };
export type State = "ok" | "fail" | "warn" | "run" | "idle" | "off" | "auth" | "cert" | "setup";
type S = Appearance & JsonObject;
export type Data = { state?: State; line?: string; pct?: number; count?: number; counts?: Record<string, number>; notReady?: number; hold?: number; name?: string; open?: string; why?: string };
type KeyState = { data: Data; timer?: NodeJS.Timeout; busy?: boolean; fails: number; fastUntil?: number; downAt?: number; holdTimer?: NodeJS.Timeout; holdTick?: NodeJS.Timeout; held?: boolean; cache: Record<string, unknown>; poll?: () => void };

export const FEATURES: Feature[] = JSON.parse(readFileSync(new URL("../features.json", import.meta.url), "utf8"));
export const UUID = "com.windowstoolkit.devops";
const HOLD_MS = 1000, RING_AFTER_MS = 200;

/** A reason the key can't show a result yet (shown on the key, explained in the log). */
class Stop extends Error {
	constructor(readonly state: State, readonly line: string, message: string) { super(message); }
}
const ok = (message = ""): PsResult => ({ status: "ok", message });
const miss = (message: string): PsResult => ({ status: "miss", message });

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: unknown, def: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== "" ? Math.max(min, Math.min(max, n)) : def; };
/** "42s", "4m 12s", "1h 03m". */
export function dur(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
const withSlash = (u: URL) => { const c = new URL(u.href); c.search = ""; c.hash = ""; if (!c.pathname.endsWith("/")) c.pathname += "/"; return c; };
const join = (base: URL, rel: string) => new URL(rel, withSlash(base));

/* ---------------- settings helpers ---------------- */
function value(def: Feature, s: S, key: string): string {
	const v = str(s[key]);
	if (v) return v;
	const f = def.fields?.find((x) => x.key === key);
	return f?.def === undefined ? "" : String(f.def);
}
const flag = (def: Feature, s: S, key: string) => { const v = s[key]; if (typeof v === "boolean") return v; const f = def.fields?.find((x) => x.key === key); return f?.def === true; };

/** GitHub "owner/repo" or a github.com / GHE address → origin, owner, repo. */
export function ghRepo(raw: string): { origin: string; owner: string; repo: string } | undefined {
	const t = raw.trim().replace(/\.git$/, "");
	const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(t);
	if (short) return { origin: "https://github.com", owner: short[1], repo: short[2] };
	const u = webUrl(t);
	if (!u) return undefined;
	const m = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/|$)/.exec(u.pathname);
	return m ? { origin: ghWeb(u.origin), owner: m[1], repo: m[2].replace(/\.git$/, "") } : undefined;
}
/** github.com (and www.) → https://github.com; GitHub Enterprise Server keeps its own address. */
const ghWeb = (origin: string) => (/^https?:\/\/(www\.)?github\.com$/i.test(origin) ? "https://github.com" : origin.toLowerCase());
const ghApi = (origin: string) => (origin === "https://github.com" ? "https://api.github.com/" : `${origin}/api/v3/`);

/** GitLab project address → server origin and "group/sub/project". */
export function gitlabProject(raw: string): { origin: string; path: string } | undefined {
	const u = webUrl(raw);
	if (!u) return undefined;
	let p: string;
	try { p = decodeURIComponent(u.pathname); } catch { return undefined; }
	p = p.replace(/\/-\/.*$/, "").replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
	return p.includes("/") && /^[\w.\-/]+$/.test(p) ? { origin: u.origin, path: p } : undefined;
}

/** Jenkins job address → the job's base address (…/job/a/job/b/), or undefined. */
export function jenkinsJob(raw: string): URL | undefined {
	const u = webUrl(raw);
	const m = u && /^((?:.*?\/job\/[^/]+)+)/.exec(u.pathname);
	return u && m ? new URL(u.origin + m[1] + "/") : undefined;
}

/** SonarQube address → server base (keeps a context path like /sonar) and the project key from ?id=. */
export function sonarTarget(raw: string): { base: URL; key: string } | undefined {
	const u = webUrl(raw);
	if (!u) return undefined;
	const key = u.searchParams.get("id") ?? "";
	const path = u.pathname.replace(/\/(dashboard|project|summary|component_measures|code|security_hotspots|issues)(\/.*)?$/, "").replace(/\/+$/, "");
	return { base: new URL(u.origin + path + "/"), key };
}

/** AWX / AAP template address → origin and template id. */
export function awxTemplate(raw: string): { origin: string; id: string } | undefined {
	const u = webUrl(raw);
	const m = u && /job_templates?\/(\d+)/.exec(u.pathname + u.hash);
	return u && m ? { origin: u.origin, id: m[1] } : undefined;
}

/** Which saved token a key uses: kind of server + its address. Undefined until the address is set. */
export function secretSlot(def: Feature, s: S): string | undefined {
	if (!def.secret) return undefined;
	const url = value(def, s, "url");
	if (def.id === "dev-ghactions") { const r = ghRepo(url); return r ? slotOf("github", r.origin) : undefined; }
	const u = webUrl(url);
	if (!u) return undefined;
	return slotOf(def.secret, def.secret === "github" ? ghWeb(u.origin) : u.origin);
}
export const secretSlotFor = (manifestId: string, s: S) => { const def = FEATURES.find((f) => `${UUID}.${f.id.slice(4)}` === manifestId); return def ? secretSlot(def, s) : undefined; };

async function tokenFor(def: Feature, s: S): Promise<string | undefined> {
	const slot = secretSlot(def, s);
	return slot ? readSecret(slot) : undefined;
}

/* ---------------- command-line tools (kubectl, aws) ---------------- */
function cli(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 25_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: env ?? process.env }, (err, stdout, stderr) => {
			if (!err) return resolve(String(stdout));
			const e = err as NodeJS.ErrnoException & { killed?: boolean };
			if (e.code === "ENOENT") return reject(new Stop("setup", file === "aws" ? "INSTALL AWS CLI" : "INSTALL KUBECTL", `${file} isn't installed or isn't on PATH.`));
			const text = String(stderr || e.message).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "";
			if (e.killed) return reject(new Stop("off", "TIMED OUT", `${file} didn't finish in time.`));
			if (/Unable to locate credentials|ExpiredToken|expired|InvalidClientTokenId|UnrecognizedClient|sso|Unauthorized|forbidden|must be logged in|credentials/i.test(text)) return reject(new Stop("auth", "SIGN IN", text));
			reject(new Stop("off", "OFFLINE", text || `${file} failed.`));
		});
	});
}

/* ---------------- what each key reads ---------------- */
type Ctx = { def: Feature; s: S; k: KeyState; opt: Options };

async function read(def: Feature, s: S, k: KeyState): Promise<Data> {
	const opt: Options = { insecure: flag(def, s, "insecure") };
	const ctx: Ctx = { def, s, k, opt };
	switch (def.id) {
		case "dev-jenkins": return jenkins(ctx);
		case "dev-jenkinsview": return jenkinsView(ctx);
		case "dev-gitlab": return gitlab(ctx);
		case "dev-gitlabmr": return gitlabMrs(ctx);
		case "dev-ghactions": return ghActions(ctx);
		case "dev-ghprs": return ghPrs(ctx);
		case "dev-sonar": return sonar(ctx);
		case "dev-awx": return awx(ctx);
		case "dev-k8s": return pods(ctx);
		case "dev-awsalarms": return alarms(ctx);
	}
	throw new Stop("setup", "", `Unknown key ${def.id}`);
}

async function jenkinsAuth(c: Ctx): Promise<Record<string, string>> {
	const user = value(c.def, c.s, "user"), token = await tokenFor(c.def, c.s);
	return user && token ? { authorization: basic(user, token) } : {};
}

async function jenkins(c: Ctx): Promise<Data> {
	const base = jenkinsJob(value(c.def, c.s, "url"));
	if (!base) throw new Stop("setup", "", "Paste the Jenkins job's address in the key's settings.");
	let name = base.pathname.split("/").filter(Boolean).pop() ?? "";
	try { name = decodeURIComponent(name); } catch { /* keep */ }
	const headers = await jenkinsAuth(c);
	type Build = { number: number; result: string | null; building: boolean; duration: number; estimatedDuration: number; timestamp: number; url?: string };
	let b: Build;
	try {
		b = (await getJson<Build>(join(base, "lastBuild/api/json?tree=number,result,building,duration,estimatedDuration,timestamp,url"), { ...c.opt, headers })).json;
	} catch (e) {
		if (e instanceof HttpError && e.status === 404) {
			await http(join(base, "api/json?tree=name"), { ...c.opt, headers }); // throws "not found" when the job itself is missing
			return { state: "idle", line: "NO BUILDS", name, open: base.href };
		}
		throw e;
	}
	const open = webUrl(b.url)?.origin === base.origin ? b.url : base.href;
	if (b.building) {
		const pct = b.estimatedDuration > 0 ? Math.min(0.99, (Date.now() - b.timestamp) / b.estimatedDuration) : undefined;
		return { state: "run", pct, line: `#${b.number} ${pct === undefined ? dur(Date.now() - b.timestamp) : Math.round(pct * 100) + "%"}`, name, open };
	}
	const state: State = b.result === "SUCCESS" ? "ok" : b.result === "FAILURE" ? "fail" : b.result === "UNSTABLE" ? "warn" : "idle";
	return { state, line: state === "idle" ? `#${b.number} ${str(b.result) || "NOT BUILT"}` : `#${b.number} · ${dur(b.duration)}`, name, open };
}

async function jenkinsView(c: Ctx): Promise<Data> {
	const u = webUrl(value(c.def, c.s, "url"));
	if (!u) throw new Stop("setup", "", "Paste the Jenkins view's address in the key's settings.");
	const base = withSlash(new URL(u.origin + u.pathname.replace(/\/(api|builds|newJob|configure)(\/.*)?$/, "")));
	const segs = base.pathname.split("/").filter(Boolean);
	let name = segs.length >= 2 ? segs[segs.length - 1] : "Jenkins";
	try { name = decodeURIComponent(name); } catch { /* keep */ }
	const { json } = await getJson<{ jobs?: { name: string; color?: string }[] }>(join(base, "api/json?tree=jobs[name,color]"), { ...c.opt, headers: await jenkinsAuth(c) });
	const counts = { fail: 0, warn: 0, run: 0, ok: 0 };
	for (const j of json.jobs ?? []) {
		const col = str(j.color);
		if (!col || /^(disabled|notbuilt|aborted)/.test(col)) continue;
		if (col.endsWith("_anime")) counts.run++;
		if (col.startsWith("red")) counts.fail++; else if (col.startsWith("yellow")) counts.warn++; else if (col.startsWith("blue")) counts.ok++;
	}
	const total = counts.fail + counts.warn + counts.ok;
	const state: State = counts.fail ? "fail" : counts.warn ? "warn" : counts.run ? "run" : total ? "ok" : "idle";
	const line = counts.fail ? `${counts.fail} FAILING` : counts.warn ? `${counts.warn} UNSTABLE` : counts.run ? `${counts.run} RUNNING` : total ? `${total} PASSING` : "NO JOBS";
	return { state, line, counts, name, open: base.href };
}

async function gitlabHeaders(c: Ctx): Promise<Record<string, string>> {
	const t = await tokenFor(c.def, c.s);
	return t ? { "private-token": t } : {};
}

async function gitlab(c: Ctx): Promise<Data> {
	const p = gitlabProject(value(c.def, c.s, "url"));
	if (!p) throw new Stop("setup", "", "Paste the GitLab project's address in the key's settings.");
	const branch = value(c.def, c.s, "branch"), headers = await gitlabHeaders(c);
	const api = `${p.origin}/api/v4/projects/${encodeURIComponent(p.path)}`;
	const name = p.path.split("/").pop() ?? p.path;
	type Pipe = { id: number; iid?: number; status: string; ref: string; web_url: string; created_at: string; updated_at: string; duration?: number | null };
	const { json } = await getJson<Pipe[]>(new URL(`${api}/pipelines?per_page=1${branch ? "&ref=" + encodeURIComponent(branch) : ""}`), { ...c.opt, headers });
	const pipe = json[0];
	if (!pipe) return { state: "idle", line: "NO PIPELINES", name, open: `${p.origin}/${p.path}/-/pipelines` };
	const n = `#${pipe.iid ?? pipe.id}`, open = webUrl(pipe.web_url)?.origin === p.origin ? pipe.web_url : `${p.origin}/${p.path}/-/pipelines`;
	const st = pipe.status;
	if (["running", "pending", "created", "preparing", "waiting_for_resource", "waiting_for_callback"].includes(st)) return { state: "run", line: `${n} ${dur(Date.now() - Date.parse(pipe.created_at))}`, name, open };
	if (st === "manual" || st === "scheduled") return { state: "warn", line: `${n} ${st.toUpperCase()}`, name, open };
	if (st !== "success" && st !== "failed") return { state: "idle", line: `${n} ${st.toUpperCase()}`, name, open };
	// Finished: read the duration once per pipeline.
	const key = `gl-dur-${pipe.id}`;
	if (c.k.cache[key] === undefined) {
		try { c.k.cache[key] = (await getJson<Pipe>(new URL(`${api}/pipelines/${pipe.id}`), { ...c.opt, headers })).json.duration ?? null; } catch { c.k.cache[key] = null; }
	}
	const secs = c.k.cache[key] as number | null;
	return { state: st === "success" ? "ok" : "fail", line: secs ? `${n} · ${dur(secs * 1000)}` : n, name, open };
}

async function gitlabMrs(c: Ctx): Promise<Data> {
	const u = webUrl(value(c.def, c.s, "url"));
	if (!u) throw new Stop("setup", "", "Type your GitLab server's address in the key's settings.");
	const headers = await gitlabHeaders(c);
	if (!headers["private-token"]) throw new Stop("auth", "ADD TOKEN", "Save a GitLab token in the key's settings.");
	const which = value(c.def, c.s, "which");
	const userKey = `gl-user-${u.origin}`;
	if (!c.k.cache[userKey]) c.k.cache[userKey] = (await getJson<{ username: string }>(new URL(`${u.origin}/api/v4/user`), { ...c.opt, headers })).json.username;
	const user = encodeURIComponent(String(c.k.cache[userKey]));
	const q = which === "assigned" ? `scope=assigned_to_me` : which === "mine" ? `scope=created_by_me` : `scope=all&reviewer_username=${user}`;
	const r = await getJson<unknown[]>(new URL(`${u.origin}/api/v4/merge_requests?state=opened&per_page=1&${q}`), { ...c.opt, headers });
	const n = Number(r.headers["x-total"] ?? (Array.isArray(r.json) ? r.json.length : 0)) || 0;
	const view = which === "assigned" ? `assignee_username=${user}` : which === "mine" ? `author_username=${user}` : `reviewer_username=${user}`;
	return { state: n ? "warn" : "ok", count: n, line: n ? (which === "review" ? `${n} TO REVIEW` : `${n} OPEN`) : "ALL CLEAR", open: `${u.origin}/dashboard/merge_requests?${view}` };
}

async function ghHeaders(c: Ctx): Promise<Record<string, string>> {
	const t = await tokenFor(c.def, c.s);
	return { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(t ? { authorization: `Bearer ${t}` } : {}) };
}
const WORKFLOW = /^([A-Za-z0-9_.-]+\.ya?ml|\d+)$/;

async function ghActions(c: Ctx): Promise<Data> {
	const r = ghRepo(value(c.def, c.s, "url"));
	if (!r) throw new Stop("setup", "", "Type the repository as owner/repo in the key's settings.");
	const wf = value(c.def, c.s, "workflow"), branch = value(c.def, c.s, "branch");
	if (wf && !WORKFLOW.test(wf)) throw new Stop("setup", "CHECK WORKFLOW", "The workflow should be a file name like ci.yml.");
	const api = ghApi(r.origin), repo = `repos/${r.owner}/${r.repo}/actions/`;
	type Run = { run_number: number; status: string; conclusion: string | null; html_url: string; run_started_at?: string; created_at: string; updated_at: string };
	const path = (wf ? `workflows/${encodeURIComponent(wf)}/runs` : "runs") + `?per_page=1${branch ? "&branch=" + encodeURIComponent(branch) : ""}`;
	const { json } = await getJson<{ workflow_runs: Run[] }>(new URL(repo + path, api), { ...c.opt, headers: await ghHeaders(c) });
	const run = json.workflow_runs?.[0];
	const web = `${r.origin}/${r.owner}/${r.repo}/actions`;
	if (!run) return { state: "idle", line: "NO RUNS", name: r.repo, open: web };
	const n = `#${run.run_number}`, open = webUrl(run.html_url)?.origin === r.origin ? run.html_url : web;
	const started = Date.parse(run.run_started_at ?? run.created_at);
	if (run.status !== "completed") return { state: "run", line: `${n} ${dur(Date.now() - started)}`, name: r.repo, open };
	const cc = run.conclusion ?? "";
	const state: State = cc === "success" ? "ok" : ["failure", "timed_out", "startup_failure"].includes(cc) ? "fail" : cc === "action_required" ? "warn" : "idle";
	return { state, line: state === "idle" ? `${n} ${cc.toUpperCase()}`.slice(0, 16) : `${n} · ${dur(Date.parse(run.updated_at) - started)}`, name: r.repo, open };
}

async function ghPrs(c: Ctx): Promise<Data> {
	const u = webUrl(value(c.def, c.s, "url"));
	if (!u) throw new Stop("setup", "", "Type your GitHub address in the key's settings.");
	const origin = ghWeb(u.origin), headers = await ghHeaders(c);
	if (!headers.authorization) throw new Stop("auth", "ADD TOKEN", "Save a GitHub token in the key's settings.");
	const which = value(c.def, c.s, "which");
	const who = which === "assigned" ? "assignee:@me" : which === "mine" ? "author:@me" : "review-requested:@me";
	const { json } = await getJson<{ total_count: number }>(new URL(`search/issues?per_page=1&q=${encodeURIComponent(`is:pr is:open archived:false ${who}`)}`, ghApi(origin)), { ...c.opt, headers });
	const n = Number(json.total_count) || 0;
	return { state: n ? "warn" : "ok", count: n, line: n ? (which === "review" ? `${n} TO REVIEW` : `${n} OPEN`) : "ALL CLEAR", open: `${origin}/pulls${which === "assigned" ? "/assigned" : which === "mine" ? "" : "/review-requested"}` };
}

async function sonar(c: Ctx): Promise<Data> {
	const t = sonarTarget(value(c.def, c.s, "url"));
	const key = value(c.def, c.s, "project") || t?.key || "";
	if (!t || !key) throw new Stop("setup", "", "Paste the project's SonarQube dashboard address in the key's settings.");
	const token = await tokenFor(c.def, c.s), branch = value(c.def, c.s, "branch");
	const headers: Record<string, string> = token ? { authorization: basic(token, "") } : {};
	const q = `${encodeURIComponent(key)}${branch ? "&branch=" + encodeURIComponent(branch) : ""}`;
	const { json } = await getJson<{ projectStatus?: { status?: string } }>(join(t.base, `api/qualitygates/project_status?projectKey=${q}`), { ...c.opt, headers });
	const st = json.projectStatus?.status;
	const state: State = st === "OK" ? "ok" : st === "ERROR" ? "fail" : st === "WARN" ? "warn" : "idle";
	let cov: string | undefined;
	try {
		const m = (await getJson<{ component?: { measures?: { metric: string; value?: string }[] } }>(join(t.base, `api/measures/component?metricKeys=coverage&component=${q}`), { ...c.opt, headers })).json;
		const v = Number(m.component?.measures?.find((x) => x.metric === "coverage")?.value);
		if (Number.isFinite(v)) cov = `${Math.round(v * 10) / 10}%`;
	} catch { /* coverage is optional */ }
	const word = state === "ok" ? "PASSED" : state === "fail" ? "FAILED" : state === "warn" ? "WARNING" : "NO GATE";
	return { state, line: cov ? `${word === "PASSED" ? "OK" : word} · ${cov}` : word, name: key.split(/[:/]/).pop(), open: join(t.base, `dashboard?id=${q}`).href };
}

async function awx(c: Ctx): Promise<Data> {
	const t = awxTemplate(value(c.def, c.s, "url"));
	if (!t) throw new Stop("setup", "", "Paste the job template's address in the key's settings.");
	const token = await tokenFor(c.def, c.s);
	if (!token) throw new Stop("auth", "ADD TOKEN", "Save an AWX token in the key's settings.");
	const headers = { authorization: `Bearer ${token}` };
	type Job = { id: number; status: string; elapsed?: number; name?: string; started?: string | null };
	const prefixes = c.k.cache.awxApi ? [String(c.k.cache.awxApi)] : ["/api/v2/", "/api/controller/v2/"];
	let jobs: Job[] | undefined;
	for (const pre of prefixes) {
		try {
			jobs = (await getJson<{ results: Job[] }>(new URL(`${t.origin}${pre}job_templates/${t.id}/jobs/?order_by=-id&page_size=1`), { ...c.opt, headers })).json.results;
			c.k.cache.awxApi = pre;
			break;
		} catch (e) { if (!(e instanceof HttpError && e.status === 404) || pre === prefixes[prefixes.length - 1]) throw e; }
	}
	const job = jobs?.[0];
	const page = value(c.def, c.s, "url");
	if (!job) return { state: "idle", line: "NO RUNS", open: page };
	const aap = c.k.cache.awxApi === "/api/controller/v2/";
	const open = `${t.origin}${aap ? "/execution/jobs/playbook/" : "/#/jobs/playbook/"}${job.id}/output`;
	const name = job.name;
	if (["new", "pending", "waiting", "running"].includes(job.status)) return { state: "run", line: `#${job.id} ${job.started ? dur(Date.now() - Date.parse(job.started)) : job.status.toUpperCase()}`, name, open };
	const state: State = job.status === "successful" ? "ok" : job.status === "failed" || job.status === "error" ? "fail" : "idle";
	return { state, line: state === "idle" ? `#${job.id} ${job.status.toUpperCase()}` : `#${job.id} · ${dur((job.elapsed ?? 0) * 1000)}`, name, open };
}

const CRASH = /CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|InvalidImageName|RunContainerError/;
async function pods(c: Ctx): Promise<Data> {
	const ns = value(c.def, c.s, "namespace") || "default", ctx = value(c.def, c.s, "context");
	if (ns !== "*" && !/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(ns)) throw new Stop("setup", "CHECK NAMESPACE", "That isn't a valid namespace name.");
	if (ctx && !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,252}$/.test(ctx)) throw new Stop("setup", "CHECK CONTEXT", "That isn't a valid context name.");
	const args = ["get", "pods", "-o", "json", "--request-timeout=10s", ...(ns === "*" ? ["--all-namespaces"] : ["--namespace", ns]), ...(ctx ? ["--context", ctx] : [])];
	type Pod = { status?: { phase?: string; containerStatuses?: { ready?: boolean; state?: { waiting?: { reason?: string } } }[] } };
	let items: Pod[];
	try { items = (JSON.parse(await cli("kubectl", args)) as { items?: Pod[] }).items ?? []; } catch (e) { if (e instanceof Stop) throw e; throw new Stop("off", "BAD REPLY", "kubectl sent something unexpected."); }
	let total = 0, ready = 0, crashing = 0;
	for (const p of items) {
		const phase = p.status?.phase ?? "";
		if (phase === "Succeeded") continue;
		total++;
		const cs = p.status?.containerStatuses ?? [];
		if (phase === "Failed" || cs.some((x) => CRASH.test(str(x.state?.waiting?.reason)))) crashing++;
		else if (phase === "Running" && cs.length && cs.every((x) => x.ready)) ready++;
	}
	const notReady = total - ready;
	const name = ns === "*" ? "All pods" : ns;
	if (!total) return { state: "idle", line: "NO PODS", name, notReady: 0 };
	return { state: crashing ? "fail" : notReady ? "warn" : "ok", line: crashing ? `${crashing} CRASHING` : `${ready}/${total} READY`, name, notReady };
}

async function alarms(c: Ctx): Promise<Data> {
	const region = value(c.def, c.s, "region") || "us-east-1", profile = value(c.def, c.s, "profile");
	if (!/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(region)) throw new Stop("setup", "CHECK REGION", "That isn't an AWS region like us-east-1.");
	if (profile && !/^[A-Za-z0-9_.+=,@-]{1,64}$/.test(profile)) throw new Stop("setup", "CHECK PROFILE", "That isn't a valid AWS profile name.");
	const args = ["cloudwatch", "describe-alarms", "--state-value", "ALARM", "--region", region, "--output", "json", "--query", "[length(MetricAlarms), length(CompositeAlarms)]", ...(profile ? ["--profile", profile] : [])];
	let n: number;
	try { const v = JSON.parse(await cli("aws", args, { ...process.env, AWS_PAGER: "" })) as number[]; n = (Number(v[0]) || 0) + (Number(v[1]) || 0); }
	catch (e) { if (e instanceof Stop) throw e; throw new Stop("off", "BAD REPLY", "The AWS CLI sent something unexpected."); }
	return { state: n ? "fail" : "ok", count: n, line: n ? `${n} FIRING` : "ALL OK", name: region, open: `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:` };
}

/* ---------------- what a 1-second hold starts ---------------- */
async function trigger(def: Feature, s: S, k: KeyState): Promise<PsResult> {
	const opt: Options = { method: "POST", insecure: flag(def, s, "insecure") };
	switch (def.id) {
		case "dev-jenkins": {
			const base = jenkinsJob(value(def, s, "url"));
			if (!base) return miss("Paste the Jenkins job's address first.");
			const headers = await jenkinsAuth({ def, s, k, opt });
			if (!headers.authorization) return miss("Add your Jenkins user ID and API token to start builds.");
			const raw = value(def, s, "params");
			let rel = "build";
			if (raw) {
				if (/[\r\n]/.test(raw)) return miss("Parameters must be on one line, like BRANCH=main&ENV=staging.");
				rel = "buildWithParameters?" + new URLSearchParams(raw).toString();
			}
			await http(join(base, rel), { ...opt, headers });
			return ok("build queued");
		}
		case "dev-gitlab": {
			const p = gitlabProject(value(def, s, "url"));
			if (!p) return miss("Paste the GitLab project's address first.");
			const headers = await gitlabHeaders({ def, s, k, opt });
			if (!headers["private-token"]) return miss("Save a GitLab token with the api scope to run pipelines.");
			const api = `${p.origin}/api/v4/projects/${encodeURIComponent(p.path)}`;
			const ref = value(def, s, "branch") || (await getJson<{ default_branch?: string }>(new URL(api), { insecure: opt.insecure, headers })).json.default_branch;
			if (!ref) return miss("The project has no default branch; set a branch in the key's settings.");
			await http(new URL(`${api}/pipeline?ref=${encodeURIComponent(ref)}`), { ...opt, headers });
			return ok("pipeline created");
		}
		case "dev-ghactions": {
			const r = ghRepo(value(def, s, "url")), wf = value(def, s, "workflow");
			if (!r) return miss("Type the repository as owner/repo first.");
			if (!wf || !WORKFLOW.test(wf)) return miss("Set the workflow file (like ci.yml) to run it from the key.");
			const headers = await ghHeaders({ def, s, k, opt });
			if (!headers.authorization) return miss("Save a GitHub token with Actions write access to run workflows.");
			const api = ghApi(r.origin);
			const ref = value(def, s, "branch") || (await getJson<{ default_branch?: string }>(new URL(`repos/${r.owner}/${r.repo}`, api), { headers })).json.default_branch;
			if (!ref) return miss("Set a branch in the key's settings.");
			await http(new URL(`repos/${r.owner}/${r.repo}/actions/workflows/${encodeURIComponent(wf)}/dispatches`, api), { ...opt, headers, body: JSON.stringify({ ref }) });
			return ok("workflow started");
		}
		case "dev-awx": {
			const t = awxTemplate(value(def, s, "url"));
			if (!t) return miss("Paste the job template's address first.");
			const token = await tokenFor(def, s);
			if (!token) return miss("Save an AWX token (Write scope) to launch templates.");
			const pre = String(k.cache.awxApi ?? "/api/v2/");
			try { await http(new URL(`${t.origin}${pre}job_templates/${t.id}/launch/`), { ...opt, headers: { authorization: `Bearer ${token}` }, body: "{}" }); }
			catch (e) { if (e instanceof HttpError && e.status === 400) return miss("This template asks questions at launch. Launch it from its page instead."); throw e; }
			return ok("job launched");
		}
	}
	return miss("This key has nothing to start.");
}

/* ---------------- the key classes ---------------- */
const LIVE = new Set<() => void>();
const BY_FAMILY = new Map<() => void, string | undefined>();
/** Re-reads every visible key now (after a token was saved), or only the keys of one kind of server. */
export function pollNow(family?: string): void { for (const p of LIVE) if (!family || BY_FAMILY.get(p) === family) p(); }

/** The page a tap opens before the key has read anything (or while it can't). */
function pageFor(def: Feature, s: S): string | undefined {
	const url = value(def, s, "url");
	if (def.id === "dev-ghactions") { const r = ghRepo(url); return r ? `${r.origin}/${r.owner}/${r.repo}/actions` : undefined; }
	if (def.id === "dev-awsalarms") { const region = value(def, s, "region"); return /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(region) ? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:` : undefined; }
	return webUrl(url)?.href;
}

function problem(e: unknown): Data {
	if (e instanceof Stop) return { state: e.state, line: e.line || undefined, why: e.message };
	if (e instanceof HttpError) {
		const state: State = e.problem === "http" ? "off" : e.problem;
		const line = e.problem === "http" && e.status ? `HTTP ${e.status}` : e.problem === "setup" ? "NOT FOUND" : e.problem === "auth" ? "CHECK TOKEN" : e.problem === "cert" ? "CERTIFICATE" : undefined;
		return { state, line, why: e.message };
	}
	return { state: "off", why: (e as Error).message };
}

export function makeKeys(): (new () => ToolkitAction<S>)[] {
	const classes: (new () => ToolkitAction<S>)[] = [];
	for (const def of FEATURES) {
		PRESET_ICONS[def.id] = { glyph: def.glyph, theme: def.theme, label: def.label ?? def.name, style: "glass" };
		const canTrigger = (s: S) => !!def.trigger && flag(def, s, "run");

		@action({ UUID: `${UUID}.${def.id.slice(4)}` })
		class DevKey extends ToolkitAction<S> {
			protected readonly kind = def.id;
			#keys = new Map<string, KeyState>();
			#paintingFor = "";

			#state(id: string): KeyState { let k = this.#keys.get(id); if (!k) this.#keys.set(id, (k = { data: {}, fails: 0, cache: {} })); return k; }

			protected override dynamicLabel(): string | undefined {
				const n = this.#keys.get(this.#paintingFor)?.data.name;
				return n ? n.slice(0, 16) : undefined;
			}

			override imageNow(s: S, id?: string): { image: string; pending?: undefined } {
				if (typeof s.iconImage === "string" && s.iconImage.startsWith("data:image/")) return super.imageNow(s, id) as { image: string };
				const look = this.look(s), data = this.#keys.get(this.#paintingFor)?.data ?? {};
				// Status colours the key unless the owner picked a colour themselves.
				if (!s.iconTheme && !s.iconColours && data.state) look.theme = STATE_THEME[data.state] ?? look.theme;
				const style = look.style === "real" ? DEFAULT_STYLE : look.style;
				return { image: svgDataUri(keySvg({ ...look, style, motion: this.motion(s), press: this.pressPhase(id ?? this.#paintingFor), data })) };
			}
			protected override async paint(a: Action<S>, s: S): Promise<void> { this.#paintingFor = a.id; await super.paint(a, s); }
			async #repaint(a: Action<S>): Promise<void> { try { await this.paint(a, await a.getSettings()); } catch { /* key gone */ } }

			#schedule(a: Action<S>, k: KeyState, ms: number): void {
				clearTimeout(k.timer);
				k.timer = setTimeout(() => void this.#poll(a, k), ms);
			}
			async #poll(a: Action<S>, k: KeyState): Promise<void> {
				if (k.busy || this.#keys.get(a.id) !== k) return;
				k.busy = true;
				let s: S;
				try { s = await a.getSettings(); } catch { k.busy = false; return; }
				const before = k.data.why;
				try { k.data = { ...(await read(def, s, k)), hold: k.data.hold }; k.fails = 0; }
				catch (e) { k.data = { ...problem(e), name: k.data.name, open: k.data.open ?? pageFor(def, s), hold: k.data.hold }; if (k.data.state !== "setup") k.fails++; }
				finally { k.busy = false; }
				if (this.#keys.get(a.id) !== k) return;
				if (k.data.why && k.data.why !== before) log.warn(`${def.id}: ${k.data.why}`);
				await this.#repaint(a);
				const every = num(s.every, 60, 15, 3600) * 1000;
				let next = k.data.state === "run" || Date.now() < (k.fastUntil ?? 0) ? Math.min(every, 10_000) : every;
				if (k.fails) next = Math.min(15 * 60_000, every * 2 ** Math.min(4, k.fails));
				this.#schedule(a, k, next);
			}

			override async onWillAppear(ev: WillAppearEvent<S>): Promise<void> {
				const k = this.#state(ev.action.id);
				await super.onWillAppear(ev);
				if (k.poll) LIVE.delete(k.poll);
				k.poll = () => this.#schedule(ev.action, k, 0);
				LIVE.add(k.poll); BY_FAMILY.set(k.poll, def.secret);
				this.#schedule(ev.action, k, 0);
			}
			override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): Promise<void> {
				await super.onDidReceiveSettings(ev);
				const k = this.#state(ev.action.id);
				k.fails = 0; k.cache = {}; k.data = { ...k.data, open: undefined };
				this.#schedule(ev.action, k, 700); // settings typed in the panel: read again shortly
			}
			override onWillDisappear(ev: WillDisappearEvent<S>): void {
				const k = this.#keys.get(ev.action.id);
				if (k) { clearTimeout(k.timer); clearTimeout(k.holdTimer); clearInterval(k.holdTick); if (k.poll) { LIVE.delete(k.poll); BY_FAMILY.delete(k.poll); } }
				this.#keys.delete(ev.action.id);
				super.onWillDisappear(ev);
			}

			override async onKeyDown(ev: KeyDownEvent<S>): Promise<void> {
				const k = this.#state(ev.action.id), s = ev.payload.settings;
				k.downAt = Date.now(); k.held = false;
				clearTimeout(k.holdTimer); clearInterval(k.holdTick);
				if (!canTrigger(s)) return;
				// Starting a run is deliberate: a red ring fills while the key is held and it starts only after 1 second.
				k.holdTick = setInterval(() => {
					const t = Date.now() - (k.downAt ?? Date.now());
					if (t < RING_AFTER_MS) return;
					k.data.hold = Math.min(1, (t - RING_AFTER_MS) / (HOLD_MS - RING_AFTER_MS));
					void this.#repaint(ev.action);
				}, 60);
				k.holdTimer = setTimeout(async () => {
					clearInterval(k.holdTick); k.held = true; k.data.hold = 0;
					await this.#repaint(ev.action);
					let r: PsResult;
					try { r = await trigger(def, s, k); } catch (e) { r = { status: "err", message: problem(e).why ?? (e as Error).message }; }
					if (r.status === "ok") {
						log.info(`${def.id}: ${r.message}`);
						k.data = { ...k.data, state: "run", line: "STARTING", pct: 0 };
						k.fastUntil = Date.now() + 3 * 60_000;
						await this.#repaint(ev.action);
						this.#schedule(ev.action, k, 4000);
					}
					await this.feedback(ev.action, r);
				}, HOLD_MS);
			}
			override async onKeyUp(ev: KeyUpEvent<S>): Promise<void> {
				const k = this.#state(ev.action.id);
				clearTimeout(k.holdTimer); clearInterval(k.holdTick);
				if (k.held) return; // the hold already started a run
				if (k.data.hold) { k.data.hold = 0; await this.#repaint(ev.action); }
				// Tap: open the page for what the key shows, and read again.
				this.#schedule(ev.action, k, 0);
				const url = webUrl(k.data.open);
				if (!url) {
					if (def.id === "dev-k8s" && k.data.state && k.data.state !== "setup") return; // nothing to open: the tap just refreshes
					log.warn(`${def.id}: ${k.data.why ?? "nothing to open yet; check the key's settings"}`);
					await ev.action.showAlert();
					return;
				}
				await this.feedback(ev.action, await ps.run("url", [url.href]), false);
			}
		}
		classes.push(DevKey);
	}
	return classes;
}
