# SoftConnect

SoftConnect is a macOS desktop control center for shared USB devices. Its React interface runs inside a local Electron app, with a narrow native bridge to the [documented VirtualHere client API](https://www.virtualhere.com/client_api). There is no hosted website or localhost server. The app keeps itself up to date from this repository's signed releases.

![SoftConnect Preview workspace](docs/softconnect-preview.jpg)

## What it does

- Discover servers and devices through the installed native client, including who holds a device that is in use elsewhere.
- Search and filter available, connected, and occupied devices.
- Connect or release a device straight from any list. Each device shows its own progress ("Connecting…") until the client confirms the change, and the rest of the window stays usable.
- Inspect properties, rename a device, toggle auto use, and add a manual server through explicit actions.
- Show a window-local activity timeline and native integration status.
- Keyboard shortcuts: ⌘K or ⌘F search, ⌘R refresh, ⌘1–4 switch views, ⌘, settings, ↑/↓ move through devices. They also appear in the app's View menu.
- Explore the interface in a clearly labeled Preview mode that never touches USB hardware.
- Open the official client download page from the app when the native client is missing.
- Update itself: new versions download in the background, are signature-checked, and install when you quit (or right away with "Restart to update").

SoftConnect does not bundle VirtualHere or replace its USB driver. Install and run the [official macOS client](https://www.virtualhere.com/usb_client_software) to use real USB devices. A server is needed on the machine physically holding those devices. The app detects supported install locations and keeps real device actions unavailable until the client responds. A successful API response to Connect means the request was accepted; the device is shown as connected only when a later client state read confirms local ownership.

## Download and run

Download the macOS app archive from this repository's Releases page, unzip it, move `SoftConnect.app` to your Applications folder, and open it. The current build targets Apple silicon. It is ad hoc signed and not notarized; macOS may require the normal manual Open flow the first time. The app requires no browser tab or web server. From then on it updates itself (see below). Versions before 0.3 have no updater, so install the first 0.3 release by hand.

For development on macOS:

```sh
npm ci
npm test
npm start
```

To create the desktop bundle:

```sh
npm run pack:mac
```

Build output is written under `release/` and is excluded from Git. `npm run build` checks the React production bundle alone.

## Releases and automatic updates

Merging to `main` is the release process. When a merge changes the app, the [Release workflow](.github/workflows/release.yml) builds SoftConnect on a macOS runner, numbers it `<major>.<minor>.<run number>` (major and minor come from `package.json`), signs an update manifest, and publishes a GitHub release. Installed copies check for a new release 15 seconds after launch and every 4 hours, download it in the background, and install it when they quit. Settings → Updates shows progress, lets you check now, restart right away, or turn automatic installs off.

Electron's built-in updater (Squirrel.Mac) only accepts Developer ID-signed apps, so SoftConnect installs updates itself, with the same safeguards Sparkle uses:

- The release manifest is signed with an Ed25519 key. The app ships the public key (`electron/update-key.cjs`) and refuses any manifest whose signature does not verify.
- The download's size and SHA-256 must match the signed manifest, and only this repository's release download URLs are accepted.
- The unpacked app must have the SoftConnect bundle id and the expected version, and must pass `codesign --verify --deep --strict`.
- Only newer versions are installed, so an old signed release cannot be replayed to downgrade the app.
- The new app is staged next to the installed one and swapped in with two renames; if the second fails, the original is put back.

Updates install only into a writable copy in a normal folder such as Applications. A copy running from Downloads (macOS App Translocation), a disk image, or a development build still reports new versions but links to the release page instead of installing.

**One-time setup.** Releases need the signing key. On a Mac with the [GitHub CLI](https://cli.github.com) signed in to an account that can manage this repository's secrets, run:

```sh
npm run update-key
```

It creates a key pair, stores the private key as the `SOFTCONNECT_UPDATE_KEY` Actions secret (it is never printed), and writes the public key to `electron/update-key.cjs`. Commit and push that file. Until then, the Release workflow skips publishing with a notice, and builds cannot install updates.

Add `-- --backup ~/softconnect-update-key.pem` to also save the private key, then move that file into a password manager. Installed copies trust only the key they shipped with, so if the secret is ever lost, restore it from the backup (`gh secret set SOFTCONNECT_UPDATE_KEY < backup.pem`). Replacing the key (`npm run update-key -- --rotate`) cuts installed copies off from automatic updates until people install the first release signed with the new key by hand; the script refuses to do that without `--rotate`.

The workflow keeps the key away from build code: the macOS job that runs npm, tests and packaging never receives it; a separate job without npm signs the manifest and is the only one allowed to publish. Releases are cut only from the newest commit on `main`, and the packaged app is checked with the same bundle, version and `codesign` checks the installed app runs before anything is published.

## Architecture and trust boundary

The Electron renderer uses context isolation and cannot invoke Node.js directly. The preload exposes only selected SoftConnect methods. The main process invokes allowlisted `-t` commands with direct arguments and bounded output; no command shell is used. Each refresh is one IPC round trip. Repeated reads are coalesced, native commands are serialized, install paths and the server process check are briefly cached, and polling slows down in the background and pauses while the window is hidden. Network navigation is disabled inside the app; the official client page and this repository's release pages open in the system browser through fixed, allowlisted actions. The only network requests the app makes are update checks and downloads from this repository's GitHub releases, from the main process in a separate session. See [architecture](docs/ARCHITECTURE.md) for the runtime boundaries and research basis.

The official macOS client has Apple's managed USB host-controller entitlement. SoftConnect does not have that entitlement and does not claim a separate virtual USB transport. Real USB attachment remains provided by the installed client. The app contains no vendor code, binaries, icons, license keys, or decompiled resources. SoftConnect is an independent interface and is not endorsed by VirtualHere.

The Preview workspace is sample data. A successful UI build or preview interaction does not prove that a physical device was attached. Real client integration must be verified with a disposable USB device before claiming device-level compatibility on a given machine.
