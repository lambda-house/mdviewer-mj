# MDViewer 1.1.0 release plan

This plan separates the first signed GitHub release from later store listings. The release tag is the publishing step: pushing `v1.1.0` starts the public GitHub Release workflow. Do not push it until the checks below pass.

## 1. Fix the publisher and application identity

- Choose the legal publisher name for both Apple and Microsoft. The names shown on the signatures must match the enrolled legal entity.
- Finalize the Tauri bundle identifier before creating Apple's App ID. `com.mdviewer-mj` is still in test builds. If Lambda House controls `lambdahouse.cc`, use `cc.lambdahouse.mdviewer` for the production builds. There are no users whose app state needs migration.
- Register that identifier in Apple's Certificates, Identifiers & Profiles once the developer membership is active.

## 2. Updater signing (done)

- The existing local private key, password and configured public key match. A local signing probe passes.
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are GitHub Actions repository secrets.
- Keep an independent secure backup of the private key and password. A lost key means installed versions cannot verify future updater packages.

## 3. macOS signing and notarization

The publisher enrolls in the [Apple Developer Program](https://developer.apple.com/help/account/membership/program-enrollment/). An organization needs a legal entity, D-U-N-S number, work-domain email and public website; an individual enrolls under their legal name. The same membership can later be used for the Mac App Store.

After enrollment:

1. Create a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) for direct-download `.app` and `.dmg` builds. Export it with its private key as a password-protected `.p12`.
2. Create an app-specific Apple Account password for [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), and record the Team ID and signing identity.
3. Add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` as GitHub Actions secrets.
4. Build the signed macOS arm64 and x86_64 packages. Verify the signatures, notarization and clean-machine launch of the downloaded DMGs.

No usable Developer ID identity is installed on the current Mac yet.

## 4. Windows signing

For public Windows downloads, set up [Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) with an eligible Azure subscription, completed publisher identity validation and a **Public Trust** certificate profile. Public Trust is available to organizations in the EU, among other regions; individual eligibility is limited to the US and Canada. If the publisher cannot use Artifact Signing, acquire a publicly trusted code-signing certificate and adapt the workflow's signing command.

After identity validation:

1. Create the Artifact Signing account and Public Trust certificate profile.
2. Create an Azure app registration/service principal with the certificate profile signer role for CI.
3. Add `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, and `AZURE_SIGNING_PROFILE` as GitHub Actions secrets.
4. Build and verify signed MSI and NSIS installers on a clean Windows x64 machine.

No Azure signing credentials are configured yet.

## 5. Linux packages and cross-platform checks

Direct GitHub Linux downloads (`.deb`, `.rpm`, `.AppImage`) need no separate signing account. Run the manual Release workflow on `main` to build macOS arm64/x86_64, Windows x64 and Linux x64 before tagging. For each installed build, test:

- Launch and open a folder containing Markdown; only relevant subfolders should appear.
- Switch the Files column between its Files and Agents filters, and expand/hide the Global agent files root.
- Open `.md` and `.markdown` through the operating system's file association. Registration does not necessarily override an existing user default; record what each installer actually does.
- Open a Markdown file from Finder, Windows Explorer or a Linux file manager while MDViewer is already running.
- Confirm update package signatures and, after release, `latest.json` entries for all four targets.

The automated tests and the local macOS build pass. Manual install checks on Windows and Linux are still needed.

## 6. Publish

The release workflow now checks every signing credential before a tagged build starts. It keeps the release as a draft until all four target builds succeed and `latest.json` is attached. Once signing and smoke checks pass, push `v1.1.0`, then check that the installers, signatures and `latest.json` are attached to the published GitHub Release. Test an update to the next version before relying on the updater for users.

## Later distribution channels

- **Mac App Store:** use the Apple Developer membership above, then prepare a separate sandboxed build and App Store Connect listing. The sandbox work described in [DISTRIBUTION.md](DISTRIBUTION.md) is still outstanding.
- **Microsoft Store:** register a [Partner Center developer account](https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account), then create the listing and submit a Store-specific signed package or installer.
- **Homebrew and winget:** contribute manifests with the existing GitHub account after the signed downloads are public.
- **Flathub:** submit a Flatpak build, verify control of the app ID and handle its sandbox and portal access. This is a separate packaging project.
