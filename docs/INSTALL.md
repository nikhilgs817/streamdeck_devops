# Install DevOps Deck

## Recommended: double-click installer

1. Download **DevOpsDeck-Installer-1.0.0.0.zip** from [GitHub Releases](https://github.com/nikhilgs817/streamdeck_devops/releases/latest).
2. Right-click the ZIP and choose **Extract All**. Open the extracted **DevOpsDeck-Installer** folder.
3. Double-click **Install-DevOpsDeck.cmd**. Keep the other files in that folder.
4. Wait for **Installed DevOps Deck 1.0.0.0**. Stream Deck closes briefly and opens again automatically.
5. In Stream Deck, find **DevOps Deck** in the action list. On a 15-key deck you can also choose **DevOps** from the profile dropdown for the ready-made layout.

No Git, Node.js, npm, developer mode or build commands are needed. Run the installer as your normal Windows user. If Stream Deck is missing or too old, the script asks first, then can install or update the official **Elgato.StreamDeck** package through Windows Package Manager; Windows may ask for administrator approval for that. If Windows Package Manager is unavailable, install Stream Deck from [Elgato Downloads](https://www.elgato.com/downloads), then run this installer again.

DevOps Deck doesn't need Windows Toolkit. It works on its own and also next to Windows Toolkit and the other Windows Toolkit plugins.

## What happens automatically

- Checks Windows 10/11 64-bit and Stream Deck 7.1 or later. Stream Deck supplies the plugin's Node runtime.
- Verifies the package checksum, plugin identity, version and files before changing anything.
- Backs up the current plugin and Stream Deck profiles under `%LOCALAPPDATA%\DevOpsDeck\Backups`.
- Installs DevOps Deck for the current user. On an update it keeps your keys, their settings and your saved tokens.
- Adds the **DevOps** profile for decks that match the 15-key layout. Existing profiles are never replaced or duplicated.
- Restarts Stream Deck and confirms the plugin starts. If anything fails, it restores the previous plugin and removes only the profiles it added.

The installer doesn't sign in anywhere, create tokens, or install kubectl or the AWS CLI.

## After installing

1. Drag a key onto your deck (or pick the **DevOps** profile).
2. In its settings, paste the page address from your browser: the Jenkins job, GitLab project, GitHub repository, SonarQube project or AWX template.
3. For a private server, create a token where the settings say, paste it in **Token** and press **Save**. It's encrypted for your Windows account and saved per server, so other keys on the same server use it too.
4. For **Kubernetes Pods** and **CloudWatch Alarms**, install `kubectl` or the AWS CLI and sign in once in a terminal. The keys use that sign-in; DevOps Deck stores nothing for them.

Tap a key to open its page. Hold a key for 1 second to start a run (Jenkins, GitLab, GitHub Actions and Ansible keys; you can switch this off in each key's settings).

## Update or reinstall

Download the newer installer ZIP, extract it, and run its CMD launcher. You don't need to uninstall first. Running the same installer again repairs its files and keeps your settings. An older installer won't replace a newer installed version.

Saved tokens stay with your Windows account. After moving to a new PC or a new Windows user, paste each token again.

## If installation doesn't finish

- **Missing files or checksum failure:** extract a fresh copy of the whole ZIP; don't run it from inside the ZIP or move only the CMD file.
- **Stream Deck not found:** install or update it from Elgato Downloads, then run the installer again. A custom installation path can be given with the PowerShell option below.
- **Windows policy blocks a script or install:** use your organization's approved method, or the manual package below. The installer doesn't change PowerShell or Windows security settings.
- **No DevOps profile appears:** connect your deck and run the installer again. The keys work on every Stream Deck model; the layout targets a 15-key deck.
- **Startup failed:** the previous plugin is restored automatically. Keep the log shown in the window.

Installer logs: `%LOCALAPPDATA%\DevOpsDeck\Logs`. Plugin logs: `%APPDATA%\Elgato\StreamDeck\Plugins\com.windowstoolkit.devops.sdPlugin\logs`. Tokens never appear in either. Backups stay on your PC and aren't uploaded.

## Manual alternative

Install Stream Deck 7.1+, open **com.windowstoolkit.devops.streamDeckPlugin** from the release, and accept the install in Stream Deck. Accept the bundled profile when offered.

## Advanced options

Run these from the extracted folder if needed; double-clicking the CMD file is enough for normal use.

```powershell
# Check compatibility and the package without changing anything.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install-Plugin.ps1 -CheckOnly

# Use a custom Stream Deck location.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install-Plugin.ps1 -StreamDeckPath "D:\Apps\Elgato\StreamDeck.exe"
```

For manual recovery, exit Stream Deck completely, copy the backup's **Plugin** folder to `%APPDATA%\Elgato\StreamDeck\Plugins\com.windowstoolkit.devops.sdPlugin`, then reopen Stream Deck.
