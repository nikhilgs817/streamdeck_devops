# Changelog

## 1.0.0.0 (2026-11-25)

First release.

- Ten live keys: Jenkins Job, Jenkins Health, GitLab Pipeline, GitHub Actions, Merge Requests, Pull Requests, Quality Gate (SonarQube / SonarCloud), Ansible Job (AWX and Automation Platform 2.5), Kubernetes Pods and CloudWatch Alarms.
- Tap opens the page; holding a key for 1 second starts a Jenkins build, GitLab pipeline, GitHub workflow or Ansible template, with a filling ring and the option to switch it off per key.
- Status colours and animated art in the Glass look by default, with all Windows Toolkit looks available.
- API tokens encrypted with Windows DPAPI, bound to one server, kept out of key settings, profiles and logs, and sent only to that server. Redirects are never followed.
- Works with GitHub Enterprise Server and self-managed GitLab, and with servers signed by a company certificate authority that Windows trusts.
- Kubernetes and CloudWatch use your own kubectl and AWS CLI sign-in; no credentials are stored.
- Backs off when a server is down (up to 15 minutes) and reads every 10 seconds while a run is in progress.
- Bundled **DevOps** layout for 15-key decks and a double-click installer.
