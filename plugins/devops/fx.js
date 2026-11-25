// DevOps Deck artwork. Original, generic glyphs (no product logos) drawn from white shapes in the 144×144 key box,
// like Windows Toolkit's feature art: the key renderer recolours white per look; status colours stay as they are.
// Each glyph gets (ink, P, D): ink = cut-out colour, P = animation phase 0…1, D = live data { state, line, … }.
const W = "#fff", OK = "#2BD67B", BAD = "#FF4D5E", WARN = "#F5A524", RUN = "#4DA3FF", DIM = "#9AA3B2";
const T = Math.PI * 2, f = (n) => n.toFixed(2), wave = (p) => (1 - Math.cos(p * T)) / 2;
const st = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const txt = (x, y, t, sz, ink = W, w = 900) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${sz}" font-weight="${w}" fill="${ink}">${esc(t)}</text>`;

/** States every DevOps key can be in. */
export const STATES = ["ok", "fail", "warn", "run", "idle", "off", "auth", "cert", "setup"];
export const WORD = { ok: "PASSED", fail: "FAILED", warn: "UNSTABLE", run: "RUNNING", idle: "NO RUNS", off: "OFFLINE", auth: "SIGN IN", cert: "CERTIFICATE", setup: "SET UP" };
/** Key colour theme per state (used when the key has no theme or colours of its own). */
export const STATE_THEME = { ok: "emerald", fail: "crimson", warn: "amber", run: "azure", idle: "slate", off: "graphite", auth: "graphite", cert: "graphite", setup: "slate" };
export const colour = (s) => ({ ok: OK, fail: BAD, warn: WARN, run: RUN })[s] ?? DIM;

/** Status line under the art: the key's own reading, else the state word. Kept short so it fits. */
const foot = (D) => txt(72, 106, String(D.line ?? WORD[D.state] ?? "").slice(0, 16), 15);
const quiet = (D) => !D.state || ["idle", "off", "auth", "cert", "setup"].includes(D.state);

/** A small status mark: ✓, ✕, !, or a spinning arc while running. */
function mark(cx, cy, r, s, P) {
	if (s === "run") return `<circle cx="${cx}" cy="${cy}" r="${r}" ${st(W, 4)} opacity=".25"/><circle cx="${cx}" cy="${cy}" r="${r}" ${st(RUN, 4.5)} stroke-dasharray="${f(r * 2.2)} ${f(r * 8)}" transform="rotate(${f(P * 720)} ${cx} ${cy})"/>`;
	const c = colour(s);
	const body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
	const k = r * 0.45;
	if (s === "ok") return body + `<path d="M${f(cx - k)} ${f(cy)}l${f(k * 0.7)} ${f(k * 0.7)}l${f(k * 1.3)} ${f(-k * 1.4)}" ${st("#0B0D14", 3.5)}/>`;
	if (s === "fail") return body + `<path d="M${f(cx - k)} ${f(cy - k)}l${f(2 * k)} ${f(2 * k)}M${f(cx + k)} ${f(cy - k)}l${f(-2 * k)} ${f(2 * k)}" ${st("#0B0D14", 3.5)}/>`;
	if (s === "warn") return body + `<path d="M${cx} ${f(cy - k)}v${f(k * 1.1)}" ${st("#0B0D14", 3.5)}/><circle cx="${cx}" cy="${f(cy + k * 0.95)}" r="1.9" fill="#0B0D14"/>`;
	return `<circle cx="${cx}" cy="${cy}" r="${r}" ${st(W, 4)} opacity=".45"/>`;
}

export const DEVOPS_FX = {
	/** Jenkins job: three pipeline stages that fill as the build runs; the last stage takes the result colour. */
	"dev-jenkins": (ink, P, D = {}) => {
		const s = D.state, k = s === "run" ? Math.max(0, Math.min(1, D.pct ?? wave(P))) : 1;
		let out = `<path d="M44 46h14M86 46h14" ${st(W, 5)} opacity=".55"/>`;
		[16, 58, 100].forEach((x, i) => {
			const done = s === "run" ? k >= (i + 1) / 3 - 1e-6 : !quiet(D);
			const active = s === "run" && !done && k >= i / 3;
			const fill = i === 2 && (s === "fail" || s === "warn") ? colour(s) : done ? W : active ? RUN : "none";
			out += `<rect x="${x}" y="32" width="28" height="28" rx="7" fill="${fill}" fill-opacity="${active ? f(0.45 + 0.55 * wave(P * 2)) : fill === "none" ? 0 : 1}" stroke="${fill === W || fill === "none" ? W : fill}" stroke-width="4"/>`;
		});
		if (s === "run") out += `<rect x="16" y="72" width="112" height="6" rx="3" fill="${W}" opacity=".2"/><rect x="16" y="72" width="${f(112 * k)}" height="6" rx="3" fill="${RUN}"/>`;
		else out += `<g>${mark(72, 78, 9, s, P)}</g>`;
		return out + foot(D);
	},

	/** Jenkins health: a grid of jobs; failing ones red, unstable amber, running blue. */
	"dev-jenkinsview": (ink, P, D = {}) => {
		const c = D.counts ?? {}, cells = [];
		for (let i = 0; i < (c.fail ?? 0); i++) cells.push(BAD);
		for (let i = 0; i < (c.warn ?? 0); i++) cells.push(WARN);
		for (let i = 0; i < (c.run ?? 0); i++) cells.push(RUN);
		let out = "";
		for (let i = 0; i < 9; i++) {
			const x = 32 + (i % 3) * 28, y = 18 + Math.floor(i / 3) * 26, col = cells[i] ?? W;
			const pulse = col === RUN ? f(0.45 + 0.55 * wave(P * 2 + i * 0.1)) : col === W ? (quiet(D) ? ".25" : ".5") : "1";
			out += `<rect x="${x}" y="${y}" width="22" height="20" rx="5" fill="${col}" fill-opacity="${pulse}"/>`;
		}
		return out + foot(D);
	},

	/** GitLab pipeline: stage circles joined by a line; the running stage spins. */
	"dev-gitlab": (ink, P, D = {}) => {
		const s = D.state, k = s === "run" ? wave(P) : 1;
		let out = `<path d="M38 50h68" ${st(W, 5)} opacity=".5"/>`;
		[[30, 0], [72, 1], [114, 2]].forEach(([cx, i]) => {
			const last = i === 2;
			if (s === "run" && i === Math.min(2, Math.floor(k * 3))) out += mark(cx, 50, 14, "run", P);
			else if (last && !quiet(D)) out += mark(cx, 50, 14, s, P);
			else out += `<circle cx="${cx}" cy="50" r="14" fill="${W}" fill-opacity="${quiet(D) ? ".2" : "1"}" stroke="${W}" stroke-width="4"/>` + (!quiet(D) ? `<path d="M${cx - 6} 50l4 4l8-8" ${st(ink, 3.5)}/>` : "");
		});
		return out + foot(D);
	},

	/** Merge or pull requests waiting for you: two branches joining, with the count. */
	"dev-review": (ink, P, D = {}) => {
		const n = Number(D.count ?? 0), has = !quiet(D) && n > 0;
		const t = wave(P);
		const dot = `<circle cx="${f(96 - 50 * t)}" cy="${f(22 + 40 * t * t)}" r="4" fill="${W}" opacity="${has ? 1 : 0.3}"/>`;
		return `<path d="M44 18v54" ${st(W, 7)}/><path d="M96 24c0 26-52 20-52 40" ${st(W, 7)}/><circle cx="44" cy="16" r="9" fill="${W}"/><circle cx="44" cy="76" r="9" fill="${W}"/><circle cx="96" cy="20" r="9" fill="${ink}" stroke="${W}" stroke-width="5"/>` +
			dot + (quiet(D) ? "" : `<circle cx="100" cy="64" r="18" fill="${has ? WARN : W}"/>` + txt(100, 71, n > 99 ? "99+" : String(n), n > 9 ? 16 : 20, "#0B0D14")) + foot(D);
	},

	/** Code quality gate: a shield with the gate result. */
	"dev-sonar": (ink, P, D = {}) => {
		const s = D.state;
		const shield = `<path d="M72 14l34 11v28c0 21-15 35-34 42c-19-7-34-21-34-42V25Z" fill="${W}" fill-opacity=".16" stroke="${W}" stroke-width="5" stroke-linejoin="round"/>`;
		const sweep = `<path d="M44 ${f(30 + 56 * P)}h56" ${st(W, 3)} opacity="${f(0.15 + 0.35 * wave(P))}"/>`;
		return shield + sweep + (quiet(D) ? "" : mark(72, 54, 16, s, P)) + foot(D);
	},

	/** Ansible automation job: a play button in a hexagon; a ring fills while the job runs. */
	"dev-awx": (ink, P, D = {}) => {
		const s = D.state, pts = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * T - T / 4; return `${f(72 + 36 * Math.cos(a))} ${f(52 + 36 * Math.sin(a))}`; }).join(" ");
		const tri = s === "fail" || s === "warn" ? colour(s) : W;
		let out = `<polygon points="${pts}" fill="${W}" fill-opacity=".14" stroke="${W}" stroke-width="5" stroke-linejoin="round"/><path d="M62 36l26 16l-26 16Z" fill="${tri}"/>`;
		if (s === "run") { const C = 2 * Math.PI * 41; out += `<circle cx="72" cy="52" r="41" ${st(RUN, 5)} stroke-dasharray="${f(C * 0.28)} ${f(C)}" transform="rotate(${f(P * 720)} 72 52)"/>`; }
		else if (s === "ok") out += mark(104, 22, 10, "ok", P);
		return out + foot(D);
	},

	/** Cloud alarms: a beacon that flashes red while any alarm fires. */
	"dev-awsalarms": (ink, P, D = {}) => {
		const n = Number(D.count ?? 0), firing = !quiet(D) && n > 0, on = firing && P % 0.5 < 0.25;
		const rays = firing ? [-1, 1].map((d) => `<path d="M${72 + d * 40} 34l${d * 12} -8M${72 + d * 44} 56h${d * 14}" ${st(BAD, 5)} opacity="${on ? 1 : 0.35}"/>`).join("") : "";
		return `<path d="M46 80V58a26 26 0 0 1 52 0v22Z" fill="${firing ? BAD : W}" fill-opacity="${firing ? (on ? 1 : 0.7) : 0.9}"/><rect x="36" y="80" width="72" height="12" rx="4" fill="${W}"/>` + rays +
			(quiet(D) ? "" : txt(72, 74, n > 99 ? "99+" : String(n), n > 9 ? 18 : 24, firing ? W : ink)) + foot(D);
	},

	/** Workflow run: one trigger fans out to two jobs that join again; a dot travels the graph while it runs. */
	"dev-workflow": (ink, P, D = {}) => {
		const s = D.state, path = "M30 52C50 52 50 30 72 30S94 52 114 52M30 52C50 52 50 74 72 74S94 52 114 52";
		let out = `<path d="${path}" ${st(W, 5)} opacity="${quiet(D) ? 0.35 : 0.6}"/>`;
		out += `<circle cx="30" cy="52" r="10" fill="${W}"/><circle cx="72" cy="30" r="9" fill="${W}"/><circle cx="72" cy="74" r="9" fill="${W}"/>`;
		if (s === "run") {
			const t = P, up = t < 0.5, k = (up ? t : t - 0.5) * 2, x = 30 + 84 * k, y = 52 + (up ? -1 : 1) * 22 * Math.sin(Math.PI * k);
			out += `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="${RUN}"/>` + mark(114, 52, 12, "run", P);
		} else out += quiet(D) ? `<circle cx="114" cy="52" r="12" ${st(W, 4)} opacity=".45"/>` : mark(114, 52, 12, s, P);
		return out + foot(D);
	},

	/** Kubernetes pods: three pods; each turns amber or red when not ready. */
	"dev-pods": (ink, P, D = {}) => {
		const bad = D.state === "fail" ? BAD : WARN, n = Number(D.notReady ?? 0);
		return [[50, 26], [94, 26], [72, 62]].map(([x, y], i) => {
			const sick = !quiet(D) && i < Math.min(3, n), c = sick ? bad : W;
			const beat = sick ? f(0.55 + 0.45 * wave(P * 2 + i / 3)) : quiet(D) ? ".3" : "1";
			return `<rect x="${x - 17}" y="${y - 15}" width="34" height="30" rx="8" fill="${c}" fill-opacity="${beat}"/><path d="M${x - 9} ${y - 3}h18M${x - 9} ${y + 5}h11" ${st(c === W ? ink : "#0B0D14", 3.5)} opacity=".8"/>`;
		}).join("") + foot(D);
	},
};
