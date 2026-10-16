# SoftConnect architecture

SoftConnect is a macOS desktop application. React renders the interface inside Electron from a local build. It does not serve an HTTP page, use a remote account, or ship a USB driver.

## Runtime boundary

```text
React renderer (softconnect://app)
    |
    | narrow, allowlisted window.softconnect API
    v
Electron preload (context isolation)
    |
    v
Electron main process
    |                         \
    | read-only status          \ explicit user action
    v                            v
local process table       installed VirtualHere client -t command
                                    |
                                    v
                              official USB client/driver
```

The main process invokes only documented client API verbs with direct argument vectors. It validates fields, bounds output, applies a timeout, and never uses a shell to assemble commands. It serializes calls into the native client's shared IPC endpoint and coalesces repeated read requests. A renderer refresh is a single `snapshot` IPC call that returns installed components and the client's device list together. Once the client is found, the resolved install paths are cached for 30 seconds (dropped early when a spawn fails or an app is opened, and a failed spawn rediscovers the client within the same call); the `pgrep` server check is cached for 5 seconds. An explicit refresh from the user bypasses these caches.

The renderer polls every 8 seconds while the client is live and the window is focused, every 30 seconds otherwise, and not at all while hidden; it refreshes as soon as the window comes back. After the client accepts `USE` or `STOP USING`, the renderer re-reads `LIST` with waits of 0, 0.75, 1, 1.5 and 2.5 seconds between reads (never shorter than the 750 ms read cache) until ownership changes, showing that device as pending in the meantime. Other devices and controls stay usable. Device discovery and state polling are read-only. Use, release, auto-use, rename, and manual server changes require a direct UI action. The official client remains responsible for USB attachment, transport, and device drivers.

A successful `USE` reply means the native client accepted the request. SoftConnect reports local connection only after `LIST` confirms ownership. The app can open the exact official client download page in the system browser; the renderer cannot navigate to arbitrary network locations.

## Updates

The renderer's session cancels every HTTP and HTTPS request. Update traffic comes only from the main process, through a separate in-memory session, to `api.github.com/repos/mikkel32/SoftConnect/releases/latest` and to this repository's release download URLs (which GitHub redirects to its asset storage).

```text
GitHub release ──► softconnect-update.json + .sig ──► Ed25519 verify (public key in the app)
                                                        │
                   SoftConnect-<v>-mac-<arch>.zip ──────┴─► size + SHA-256 from the manifest
                                                              │
         <app folder>/.SoftConnect-update/SoftConnect.app ◄───┘ ditto -x -k
                    │  bundle id, version, codesign --verify --deep --strict
                    ▼
 will-quit or "Restart to update": rename installed → backup, staged → installed (rolled back on failure)
```

The release workflow signs the manifest with the `SOFTCONNECT_UPDATE_KEY` secret and refuses to publish if that key does not match the public key committed in `electron/update-key.cjs`, so a release can never be one the shipped apps reject. The updater installs only versions newer than its own, which blocks replaying an older signed release. Ad hoc signing gives no publisher identity, so the Ed25519 key is the trust root for updates; anyone who can both push to `main` and use the repository's Actions secrets can ship an update.

SoftConnect does not include VirtualHere binaries, credentials, configuration files, or copied application resources. The user installs the official software separately. The app stores no cloud account or telemetry.

## Evidence and implementation choices

REA 6.4.0 previously inventoried the official macOS server and client packages, their Mach-O architectures, signing metadata, and UI resources. That static evidence established native application structure, not the USB transport protocol or runtime equivalence. The [vendor client API](https://www.virtualhere.com/client_api) expressly supports custom GUIs and documents the `-t` command interface used here. The [client license](https://www.virtualhere.com/node/316) restricts decompilation and derivative works, so this repository contains original implementation code and public API integration only.

The downloaded official macOS client declares `com.apple.developer.usb.host-controller-interface` in its signing metadata. [Apple identifies this as a managed entitlement](https://developer.apple.com/forums/thread/802495). An independent macOS virtual USB host controller would require an approved entitlement and a separate native implementation. Electron packaging cannot provide that capability. The [Linux USB/IP protocol](https://docs.kernel.org/usb/usbip_protocol.html) is a documented possible basis for a separate Linux backend; SoftConnect does not claim one today.

## Verification boundary

The app can be verified against fixture `-t` responses without touching live USB sessions. Static package evidence, a passing React build, and fixture interactions do not prove native USB attachment. A real client session should be tested on a disposable device before making that claim for any release.
