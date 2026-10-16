"use strict";

// Ed25519 public key that verifies SoftConnect update manifests. The matching private key exists only as
// the repository's SOFTCONNECT_UPDATE_KEY Actions secret. Create both with `npm run update-key`.
// While this is null the app cannot verify updates, so it never installs one, and releases are skipped.
const UPDATE_PUBLIC_KEY = null;

module.exports = { UPDATE_PUBLIC_KEY };
