// DevOps Deck key catalogue: one row per key. gen.mjs turns this into manifest actions, key art,
// the settings-panel fields (ui/features.js) and features.json for the plugin runtime (src/keys.ts).
// Keys only read status, except a 1-second hold on a key with `trigger`, which starts a run (can be switched off per key).

const insecure = { key: "insecure", label: "Self-signed OK", type: "check", def: false, hint: "Only for an internal server with its own certificate. Leave off when Windows already trusts the server." };
const every = { key: "every", label: "Check every (s)", type: "number", def: 60, min: 15, max: 3600 };
const hold = (what) => ({ key: "run", label: `Hold to ${what}`, type: "check", def: true, hint: `Hold the key for 1 second to ${what}. A tap only opens the page.` });
const token = (where, scope) => ({ key: "token", label: "Token", type: "secret", hint: `${where}. ${scope} Saved encrypted for your Windows account (per server), never in the key's settings.` });

export const GROUPS = [
	["ci", "Builds & Pipelines"],
	["review", "Reviews & Quality"],
	["ops", "Operations"],
];

export const FEATURES = [
	// ---------------- Builds & Pipelines
	{
		id: "dev-jenkins", group: "ci", name: "Jenkins Job", glyph: "dev-jenkins", theme: "slate", label: "Jenkins", secret: "jenkins", trigger: true,
		tip: "Last build of a Jenkins job, live. Tap: open the job. Hold 1 second: start a build.",
		fields: [
			{ key: "url", label: "Job page", type: "text", placeholder: "https://jenkins.example.com/job/app/job/main/", hint: "Copy the job's address from your browser." },
			{ key: "user", label: "User ID", type: "text", placeholder: "Your Jenkins user ID" },
			token("Jenkins › your name › Security › API Token", "Needed to start builds and for private jobs."),
			{ key: "params", label: "Parameters", type: "text", placeholder: "BRANCH=main&ENV=staging", hint: "Optional, for a parameterized job." },
			hold("start a build"), every, insecure,
		],
	},
	{
		id: "dev-jenkinsview", group: "ci", name: "Jenkins Health", glyph: "dev-jenkinsview", theme: "slate", label: "Jobs", secret: "jenkins",
		tip: "How many jobs in a Jenkins view are failing, unstable or running. Tap: open the view.",
		fields: [
			{ key: "url", label: "View page", type: "text", placeholder: "https://jenkins.example.com/view/Team/", hint: "A view, a folder or the Jenkins home page." },
			{ key: "user", label: "User ID", type: "text", placeholder: "Your Jenkins user ID" },
			token("Jenkins › your name › Security › API Token", "Only needed when the view is private."),
			every, insecure,
		],
	},
	{
		id: "dev-gitlab", group: "ci", name: "GitLab Pipeline", glyph: "dev-gitlab", theme: "slate", label: "Pipeline", secret: "gitlab", trigger: true,
		tip: "Latest pipeline of a GitLab project or branch, live. Tap: open the pipeline. Hold 1 second: run a new pipeline.",
		fields: [
			{ key: "url", label: "Project page", type: "text", placeholder: "https://gitlab.com/group/project", hint: "Works with gitlab.com and your own GitLab." },
			{ key: "branch", label: "Branch", type: "text", placeholder: "Leave empty for any branch" },
			token("GitLab › Preferences › Access tokens (read_api; api to run pipelines)", "Needed for private projects."),
			hold("run a pipeline"), every, insecure,
		],
	},
	{
		id: "dev-ghactions", group: "ci", name: "GitHub Actions", glyph: "dev-workflow", theme: "slate", label: "Actions", secret: "github", trigger: true,
		tip: "Latest GitHub Actions run of a repository or workflow, live. Tap: open the run. Hold 1 second: run the workflow (it needs a workflow_dispatch trigger).",
		fields: [
			{ key: "url", label: "Repository", type: "text", placeholder: "owner/repo or https://github.com/owner/repo" },
			{ key: "workflow", label: "Workflow file", type: "text", placeholder: "ci.yml", hint: "Optional for reading; needed to run it from the key." },
			{ key: "branch", label: "Branch", type: "text", placeholder: "Leave empty for any branch" },
			token("GitHub › Settings › Developer settings › Fine-grained token with Actions read (write to run)", "Needed for private repos and to run workflows."),
			hold("run the workflow"), every,
		],
	},
	// ---------------- Reviews & Quality
	{
		id: "dev-gitlabmr", group: "review", name: "Merge Requests", glyph: "dev-review", theme: "slate", label: "MRs", secret: "gitlab",
		tip: "Open GitLab merge requests waiting for you. Tap: open the list.",
		fields: [
			{ key: "url", label: "GitLab server", type: "text", def: "https://gitlab.com", placeholder: "https://gitlab.com" },
			{ key: "which", label: "Count", type: "select", def: "review", options: [["review", "Waiting for my review"], ["assigned", "Assigned to me"], ["mine", "Opened by me"]] },
			token("GitLab › Preferences › Access tokens (read_api)", "Required."),
			every, insecure,
		],
	},
	{
		id: "dev-ghprs", group: "review", name: "Pull Requests", glyph: "dev-review", theme: "slate", label: "PRs", secret: "github",
		tip: "Open GitHub pull requests waiting for you. Tap: open the list.",
		fields: [
			{ key: "url", label: "GitHub server", type: "text", def: "https://github.com", placeholder: "https://github.com", hint: "Change only for GitHub Enterprise Server." },
			{ key: "which", label: "Count", type: "select", def: "review", options: [["review", "Waiting for my review"], ["assigned", "Assigned to me"], ["mine", "Opened by me"]] },
			token("GitHub › Settings › Developer settings › Fine-grained token with Pull requests read", "Required."),
			every,
		],
	},
	{
		id: "dev-sonar", group: "review", name: "Quality Gate", glyph: "dev-sonar", theme: "slate", label: "Quality", secret: "sonar",
		tip: "SonarQube or SonarCloud quality gate and coverage of a project. Tap: open the project.",
		fields: [
			{ key: "url", label: "Project page", type: "text", placeholder: "https://sonar.example.com/dashboard?id=my-app", hint: "Paste the project's dashboard address, or the server address plus a project key." },
			{ key: "project", label: "Project key", type: "text", placeholder: "Taken from the address when empty" },
			{ key: "branch", label: "Branch", type: "text", placeholder: "Leave empty for the main branch" },
			token("SonarQube › My Account › Security › Generate token", "Needed for private projects."),
			every, insecure,
		],
	},
	// ---------------- Operations
	{
		id: "dev-awx", group: "ops", name: "Ansible Job", glyph: "dev-awx", theme: "slate", label: "Ansible", secret: "awx", trigger: true,
		tip: "Last run of an AWX or Ansible Automation Platform job template. Tap: open the job. Hold 1 second: launch the template.",
		fields: [
			{ key: "url", label: "Template page", type: "text", placeholder: "https://awx.example.com/#/templates/job_template/7/details", hint: "Copy the template's address from your browser." },
			token("AWX › your user › Tokens › Add (scope Write to launch)", "Required."),
			hold("launch the template"), every, insecure,
		],
	},
	{
		id: "dev-k8s", group: "ops", name: "Kubernetes Pods", glyph: "dev-pods", theme: "slate", label: "Pods",
		tip: "Ready pods in a Kubernetes namespace, read with your own kubectl. Red when a pod is crash-looping or can't pull its image.",
		fields: [
			{ key: "namespace", label: "Namespace", type: "text", def: "default", placeholder: "default", hint: "Type * for every namespace." },
			{ key: "context", label: "Context", type: "text", placeholder: "Leave empty for the current context" },
			every,
		],
	},
	{
		id: "dev-awsalarms", group: "ops", name: "CloudWatch Alarms", glyph: "dev-awsalarms", theme: "slate", label: "Alarms",
		tip: "CloudWatch alarms firing in one AWS region, read with your own AWS CLI. Tap: open the alarms page.",
		fields: [
			{ key: "region", label: "Region", type: "text", def: "us-east-1", placeholder: "us-east-1" },
			{ key: "profile", label: "AWS profile", type: "text", placeholder: "Leave empty for the default profile" },
			every,
		],
	},
];
