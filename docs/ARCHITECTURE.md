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

The main process invokes only documented client API verbs with direct argument vectors. It validates fields, bounds output, applies a timeout, and never uses a shell to assemble commands. Device discovery and state polling are read-only. Use, release, auto-use, rename, and manual server changes require a direct UI action. The official client remains responsible for USB attachment, transport, and device drivers.

SoftConnect does not include VirtualHere binaries, credentials, configuration files, or copied application resources. The user installs the official software separately. The app stores no cloud account or telemetry.

## Evidence and implementation choices

REA 6.4.0 previously inventoried the official macOS server and client packages, their Mach-O architectures, signing metadata, and UI resources. That static evidence established native application structure, not the USB transport protocol or runtime equivalence. The [vendor client API](https://www.virtualhere.com/client_api) expressly supports custom GUIs and documents the `-t` command interface used here. The [client license](https://www.virtualhere.com/node/316) restricts decompilation and derivative works, so this repository contains original implementation code and public API integration only.

The downloaded official macOS client declares `com.apple.developer.usb.host-controller-interface` in its signing metadata. [Apple identifies this as a managed entitlement](https://developer.apple.com/forums/thread/802495). An independent macOS virtual USB host controller would require an approved entitlement and a separate native implementation. Electron packaging cannot provide that capability. The [Linux USB/IP protocol](https://docs.kernel.org/usb/usbip_protocol.html) is a documented possible basis for a separate Linux backend; SoftConnect does not claim one today.

## Verification boundary

The app can be verified against fixture `-t` responses without touching live USB sessions. Static package evidence, a passing React build, and fixture interactions do not prove native USB attachment. A real client session should be tested on a disposable device before making that claim for any release.
