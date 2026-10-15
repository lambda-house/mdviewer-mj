# Distribution roadmap

MDViewer builds for macOS, Windows and Linux on every `v*` tag, and that's where it stops: unsigned installers on a GitHub release page. That's fine for developers who know to right-click → Open, and a dead end for everyone else — Gatekeeper and SmartScreen greet them with "unidentified developer", and none of the places people actually install software from (Homebrew, winget, Flathub, the two app stores) list the app yet.

This document is the plan for getting from here to there, in the order that makes sense: first the things that cost nothing but a decision, then signing (which every later step depends on), then the cheap channels, and the two app stores last.

## Where we are

| | State |
|---|---|
| Latest release | v1.0.4. It has no updater, so its users install the next version by hand once |
| Next version | 1.1.0: privacy and access fixes, the agent workspace, and the new menu and search improvements |
| Build matrix | macOS arm64 and x86_64, Windows x86_64, Linux x86_64 (`.github/workflows/release.yml`) |
| Installers | `.dmg`, `.msi` and NSIS `.exe`, `.deb`, `.rpm` and `.AppImage` |
| Updater | Built in (`tauri-plugin-updater`, `latest.json` from the latest release). Release builds need `TAURI_SIGNING_PRIVATE_KEY` and `_PASSWORD`, and **neither secret is set**, so a tag would fail today |
| macOS signing | Wired up in the workflow, and turns on when the `APPLE_*` secrets exist. None exist |
| Windows signing | Wired up for Azure Trusted Signing (now called Artifact Signing), and turns on when the `AZURE_*` secrets exist. None exist |
| Bundle identifier | `com.mdviewer-mj` |

The pipeline is ready: what's missing is accounts, certificates and a few decisions.

## Phase 0: decisions before 1.1.0 (no cost)

These are cheap now and expensive later, because each one is visible to every installed copy.

### The bundle identifier

`com.mdviewer-mj` was a placeholder, and it's the one thing to settle before the app spreads. The identifier is the App ID in Apple's portal, the Flatpak app ID, and the folder where the webview keeps its storage. Changing it after the stores means a new app listing; changing it after 1.1.0 means every user loses their open tabs, workspaces and settings, which live in the webview's localStorage under that folder.

- **Pick a reverse-DNS name on a domain Lambda House controls**, e.g. `house.lambda.mdviewer`. Flathub verifies the app by that domain (a token under `/.well-known/`), and Apple and Microsoft only care that it's unique.
- **Or, with no domain to spare**, `io.github.lambda_house.MDViewer`. Flathub accepts it with GitHub verification (the hyphen in the org name becomes an underscore), and the other platforms don't mind.
- **Migrate once:** on first launch under the new identifier, the backend copies the old webview data folder (`~/Library/WebKit/com.mdviewer-mj` on macOS, `%LOCALAPPDATA%\com.mdviewer-mj` on Windows, `~/.local/share/com.mdviewer-mj` on Linux) before the webview starts. The backend's own config dir (`mdviewer`) doesn't depend on the identifier and stays put.

### The publisher

Everything below is enrolled by one legal entity, and its name is what users see in Gatekeeper, SmartScreen and both stores ("© 2026 Lambda House" today). Apple asks an organization for a D-U-N-S number, which is free but takes up to 5 business days. Azure Artifact Signing only serves organizations in certain countries (US, Canada, EU, UK and a handful of others), so check the publishing entity against that list before building the Windows plan on it.

### The updater key and release 1.1.0

The updater keypair already exists: the public key is in `tauri.conf.json`. Store the private key and its password in a password manager first, because losing them means no installed copy can ever update again. Then:

1. Set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as repository secrets.
2. Bump the version to 1.1.0 (`package.json`, `tauri.conf.json`, `Cargo.toml`) and move the CHANGELOG's "Unreleased" under it.
3. Tag `v1.1.0` and check that `latest.json` on the release lists all four platforms.
4. Say in the release notes that 1.0.4 users need to install 1.1.0 by hand once.

This release can ship unsigned: signing changes nothing in the app, so 1.1.1 can be the first signed one.

## Phase 1: signing

Every channel after this phase needs signed builds, or works much better with them. Homebrew announced it would drop casks that fail Gatekeeper from its main repository as of September 2026, the Microsoft Store wants signed Win32 installers, and an unsigned app on winget still trips SmartScreen.

### macOS: Developer ID and notarization

- **Account:** Apple Developer Program as an organization, $99 a year.
- **Certificate:** "Developer ID Application", exported as a `.p12`.
- **Secrets:**
  - `APPLE_CERTIFICATE` (the `.p12`, base64) and `APPLE_CERTIFICATE_PASSWORD`;
  - `APPLE_SIGNING_IDENTITY`;
  - `APPLE_ID`, an app-specific `APPLE_PASSWORD` and `APPLE_TEAM_ID` for notarization.
- **Done when:** a downloaded `.dmg` opens with no warning, and `spctl -a -vv /Applications/MDViewer.app` says `accepted, source=Notarized Developer ID`.

The workflow already exports these and `tauri-action` notarizes on its own, so this step is mostly paperwork. The same account later covers the Mac App Store.

### Windows: Artifact Signing, or a certificate

- **Azure Artifact Signing** is the cheap option: $9.99 a month for 5,000 signatures, with no hardware token, and the workflow already uses it (`trusted-signing-cli`). It needs a paid Azure subscription and a publisher in an eligible country, and identity validation takes a few days. It's available to individual developers only in the US and Canada.
- **An OV code signing certificate** is the fallback when the publisher doesn't qualify: roughly $200–400 a year, with the key in a cloud HSM (SSL.com eSigner, DigiCert KeyLocker and others) since certificates can't be exported as files anymore. Its `signCommand` slots into the same place as the Azure one.
- **Either way:** SmartScreen reputation now attaches to the publisher's identity, so the warnings fade quickly instead of restarting with each release.

### Linux

Nothing to sign for the `.deb`/`.rpm`/`.AppImage` downloads. Flathub and the Snap Store sign their own packages.

## Phase 2: package managers (cheap reach)

People install developer tools from package managers, and that's exactly who MDViewer's agent workspace is for. Each manager below is a manifest that points at the release assets; the first three can be updated automatically after each release.

### Homebrew

- **Own tap first:** `lambda-house/homebrew-tap` with `Casks/mdviewer.rb`, installed with `brew install --cask lambda-house/tap/mdviewer`. This works today, unsigned builds included, but only for people who find the tap.
- **Then the main repository:** once builds are notarized, a PR to `homebrew/cask` gets plain `brew install --cask mdviewer`. The name is free. Homebrew's bots then pick up new versions on their own.
- **Release automation:** a job after `updater-manifest` updates the tap's version and `sha256` (e.g. with `brew bump-cask-pr` or a small script).

### winget

- **Manifest:** a PR to `microsoft/winget-pkgs` with `LambdaHouse.MDViewer`, made with `wingetcreate new <msi url>`.
- **Updates:** `wingetcreate update` runs in the release workflow with a token.
- **Signing:** unsigned installers are accepted, but they still show SmartScreen warnings after install, so this step makes most sense after phase 1.

### AUR

`mdviewer-bin`, a `PKGBUILD` that repackages the release `.deb`. It's an hour of work and reaches Arch users, a crowd that overlaps heavily with people running coding agents. A maintainer account is needed to keep it updated.

### Flathub

This is the most effort in this phase. The reward is every Linux distribution with a software center, so it's worth doing, but after the others.

- **Offline build:** Flathub builds from source with no network, so the manifest vendors the dependencies: crates via `flatpak-cargo-generator`, npm packages via `flatpak-node-generator`. Both are generated files committed to the Flathub repository and regenerated on each release.
- **Sandbox and the access model:**
  - The folder picker and drag & drop go through the file chooser and document portals, so opened folders arrive as portal paths. The access list stores those paths as it gets them, and that needs testing.
  - The agent workspace reads `~/.claude`, `~/.codex` and `~/.gemini`, which needs `--filesystem=~/.claude:ro` (and the same for the other two) in the manifest. Reviewers ask about home folder access, so the manifest should explain it.
- **Metadata:** a MetaInfo file (`<id>.metainfo.xml`) with screenshots and release notes, and a `.desktop` file.
- **App ID:** see phase 0; verification follows from it.

### Snap (optional)

`snapcraft.yaml` with the same files as the `.deb`. Its confinement has the same home folder question as Flathub (`personal-files` interface for `~/.claude`). Do it only if there's demand: Ubuntu users already have the `.deb`.

## Phase 3: Microsoft Store

- **Account:** Partner Center. Registration is free for individuals, and since May 2026 for companies too, if you start at storedeveloper.microsoft.com (older pages still mention a one-time $99 fee).
- **Option 1, the Win32 installer:**
  - List the signed NSIS `.exe` or `.msi` by its release URL.
  - It's the least work and reuses phase 1's signing.
  - The installer must install silently (`/S` for NSIS).
  - Win32 listings may update themselves, but updates should come from one place, so the Store build turns the updater off anyway.
- **Option 2, MSIX:**
  - The Store signs the package, so phase 1 isn't needed for it.
  - Tauri doesn't produce MSIX itself, so that means a packaging step (e.g. the MSIX Packaging Tool or `makeappx` on the built app), with WebView2 declared as a dependency.
  - It gives cleaner installs and uninstalls and automatic updates through the Store.
- **Recommendation:** option 1, as soon as Windows signing works.
- **Listing:** a privacy policy URL (MDViewer collects nothing, which makes it short), screenshots, the age rating questionnaire. Certification takes 1–3 days.

The updater switch is a build-time setting: a `tauri.store.conf.json` overlay without `plugins.updater` and with `createUpdaterArtifacts` off, plus a Cargo feature that leaves `tauri-plugin-updater` out, so the Store build never tries to replace itself.

## Phase 4: Mac App Store

This comes last because it's the only channel that changes how the app works. The App Store requires the App Sandbox, and the sandbox breaks three things MDViewer relies on.

- **Opened folders across restarts.** Today `access.json` stores plain paths. In the sandbox, a path the user picked is readable only for that session, unless the app saves a _security-scoped bookmark_ and resolves it on the next launch. The access list has to store bookmarks next to paths (macOS only) and start accessing them at startup.
- **"Open linked file?"** The native confirm dialog isn't enough anymore: the sandbox only grants what the user picks in an open panel. The store build shows an `NSOpenPanel` preselected on the linked file instead.
- **The agent workspace.** `~/.claude` is out of reach until the user picks it in an open panel, with hidden files shown since it's a dot-folder. The bookmark then persists like any opened folder.

Beyond the sandbox:

- **Separate build:** a `tauri.mas.conf.json` overlay with the sandbox entitlements (`com.apple.security.app-sandbox`, `files.user-selected.read-write`, `files.bookmarks.app-scope`), the provisioning profile under `bundle > macOS > files` as `embedded.provisionprofile`, an `Info.plist` with `ITSAppUsesNonExemptEncryption = false`, and the updater turned off as for the Microsoft Store.
- **Certificates:** "Apple Distribution" and "Mac Installer Distribution", plus a Mac App Store provisioning profile for the App ID. The same $99 account covers it.
- **Package:** a universal binary (`--target universal-apple-darwin`), wrapped with `productbuild` and uploaded with Transporter or `xcrun altool`. Review takes 1–3 days, longer for the first submission.
- **Name:** App Store names are unique. If "MDViewer" is taken, the listing needs a subtitle-style name (the bundle's `productName` can stay).

The direct download keeps the full features (no sandbox), and the App Store version is the convenient one: two builds from one codebase, which is what most developer tools on the Mac do.

## Smaller items along the way

- **Architectures:** add `aarch64-pc-windows-msvc` (Windows on ARM laptops) and `aarch64-unknown-linux-gnu` to the release matrix. GitHub has ARM runners for both.
- **Intel Macs:** keep `x86_64-apple-darwin` for now, since macOS Tahoe is the last release that supports Intel. Dropping it is a later decision.
- **Store screenshots:** one set of light and dark screenshots (document, agent workspace, Mermaid, search) serves all listings.
- **Privacy policy:** one page on the website or in the repository ("MDViewer collects nothing, and talks to the network only to check for updates and to load images you allowed"), linked from every listing.

## Summary

| Phase | What | Cost | Blocked on |
|---|---|---|---|
| 0 | Identifier, publisher, updater secrets, release 1.1.0 | Free | Decisions |
| 1 | macOS Developer ID + notarization | $99/year | Apple enrollment (D-U-N-S) |
| 1 | Windows signing | $9.99/month (Artifact Signing) or ~$200–400/year (OV) | Publisher eligibility |
| 2 | Homebrew tap → homebrew/cask | Free | Notarization, for the main repository |
| 2 | winget, AUR | Free | Windows signing (winget, preferably) |
| 2 | Flathub | Free | Identifier, sandbox testing |
| 3 | Microsoft Store (Win32 listing) | Free | Windows signing |
| 4 | Mac App Store | Covered by the $99 | Sandbox work: bookmarks, open panels |

In short: one week of paperwork (Apple enrollment, Windows signing), one afternoon per package manager, a few days for Flathub, a day for the Microsoft Store, and a proper sprint for the Mac App Store.
