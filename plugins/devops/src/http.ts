// Small HTTP client for DevOps Deck: plain node:http(s), short timeouts, size cap, no redirects (a redirect is
// usually a sign-in page), and Windows' own trusted root certificates so company CAs work like in the browser.
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { ps } from "../../../shared/ps.js";

export type Reply = { status: number; headers: IncomingHttpHeaders; body: string };
/** off = can't reach the server, auth = token missing or refused, cert = certificate not trusted, http = any other error. */
export type Problem = "off" | "auth" | "cert" | "http" | "setup";
export class HttpError extends Error {
	constructor(readonly problem: Problem, message: string, readonly status?: number) { super(message); }
}

const MAX_BODY = 2 * 1024 * 1024;
const CERT = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME|DEPTH_ZERO|ERR_TLS/;
const OFFLINE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE"]);

/** Windows' trusted roots (LocalMachine + CurrentUser), read once from the PowerShell host. Node's own list is the fallback. */
let roots: Promise<string[] | undefined> | undefined;
function windowsRoots(): Promise<string[] | undefined> {
	if (process.platform !== "win32" || process.env.WINTOOLKIT_DRYRUN === "1") return Promise.resolve(undefined);
	roots ??= ps.run("rootcas", [], 20_000).then((r) => {
		if (r.status !== "ok" || !r.message) return undefined;
		const pems = r.message.split(/(?=-----BEGIN CERTIFICATE-----)/).map((p) => p.trim()).filter((p) => p.startsWith("-----BEGIN CERTIFICATE-----"));
		return pems.length ? [...new Set([...rootCertificates, ...pems])] : undefined;
	}).catch(() => undefined);
	return roots;
}

/** Only http(s) addresses with a host; anything else (file:, javascript:, UNC paths…) is refused. */
export function webUrl(raw: unknown): URL | undefined {
	const t = String(raw ?? "").trim();
	if (!t) return undefined;
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t);
		if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return undefined;
		return u;
	} catch { return undefined; }
}

export type Options = { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; insecure?: boolean; timeoutMs?: number };

export async function http(url: URL, o: Options = {}): Promise<Reply> {
	const https = url.protocol === "https:";
	const ca = https && !o.insecure ? await windowsRoots() : undefined;
	const headers: Record<string, string> = { "user-agent": "DevOps-Deck/1.0 (Stream Deck)", accept: "application/json", ...o.headers };
	if (o.body !== undefined) { headers["content-type"] ??= "application/json"; headers["content-length"] = String(Buffer.byteLength(o.body)); }
	return new Promise<Reply>((resolve, reject) => {
		const req = (https ? httpsRequest : httpRequest)(url, {
			method: o.method ?? "GET", headers, timeout: o.timeoutMs ?? 10_000,
			...(https ? { rejectUnauthorized: !o.insecure, ...(ca ? { ca } : {}) } : {}),
		}, (res) => {
			const chunks: Buffer[] = [];
			let size = 0;
			res.on("data", (c: Buffer) => {
				size += c.length;
				if (size > MAX_BODY) { req.destroy(new HttpError("http", "The server sent too much data.")); return; }
				chunks.push(c);
			});
			res.on("end", () => {
				const status = res.statusCode ?? 0, body = Buffer.concat(chunks).toString("utf8");
				if (status === 401 || status === 403) return reject(new HttpError("auth", status === 401 ? "The server wants a valid token." : "The token isn't allowed to do this.", status));
				if (status >= 300 && status < 400) return reject(new HttpError("auth", "The server sent a sign-in page. Add a token in the key's settings.", status));
				if (status === 404) return reject(new HttpError("setup", "Not found. Check the address in the key's settings.", status));
				if (status >= 400) return reject(new HttpError("http", `The server answered ${status}.`, status));
				resolve({ status, headers: res.headers, body });
			});
			res.on("error", (e) => reject(e instanceof HttpError ? e : new HttpError("off", e.message)));
		});
		req.on("timeout", () => req.destroy(new HttpError("off", "The server didn't answer in time.")));
		req.on("error", (e: NodeJS.ErrnoException) => {
			if (e instanceof HttpError) return reject(e);
			const code = e.code ?? "";
			if (CERT.test(code)) return reject(new HttpError("cert", "Windows doesn't trust this server's certificate."));
			if (OFFLINE.has(code)) return reject(new HttpError("off", `Can't reach ${url.host}.`));
			reject(new HttpError("off", e.message));
		});
		if (o.body !== undefined) req.write(o.body);
		req.end();
	});
}

/** GET and parse JSON. */
export async function getJson<T>(url: URL, o: Options = {}): Promise<{ json: T; headers: IncomingHttpHeaders }> {
	const r = await http(url, o);
	try { return { json: JSON.parse(r.body) as T, headers: r.headers }; } catch { throw new HttpError("auth", "The server didn't send data (a sign-in page?). Check the token."); }
}
