import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packager } from "@electron/packager";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = packageMetadata.version;
const svg = join(root, "src/assets/softconnect-icon.svg");
const icon = join(root, "assets/SoftConnect.icns");
const release = process.env.SOFTCONNECT_PACKAGE_OUT || join(root, "release", `v${version}`);
const iconSizes = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
];

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.platform !== "darwin") throw new Error("The macOS app must be packaged on macOS");
await Promise.all([access(svg), access(join(root, "dist/index.html"))]);
await mkdir(join(root, "assets"), { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "softconnect-icon-"));
try {
  const iconset = join(temporary, "SoftConnect.iconset");
  await mkdir(iconset);
  for (const [size, name] of iconSizes) {
    await exec("/usr/bin/sips", ["-s", "format", "png", "-z", String(size), String(size), svg, "--out", join(iconset, name)]);
  }
  await exec("/usr/bin/iconutil", ["--convert", "icns", "--output", icon, iconset]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const appPaths = await packager({
  dir: root,
  name: "SoftConnect",
  executableName: "SoftConnect",
  appBundleId: "app.softconnect.desktop",
  appCategoryType: "public.app-category.utilities",
  platform: "darwin",
  arch: process.arch,
  electronVersion: "44.7.2",
  out: release,
  overwrite: false,
  asar: true,
  prune: true,
  icon,
  ignore: [
    /^\/\.github($|\/)/,
    /^\/\.gitignore$/,
    /^\/README\.md$/,
    /^\/docs($|\/)/,
    /^\/src($|\/)/,
    /^\/scripts($|\/)/,
    /^\/tests($|\/)/,
    /^\/assets($|\/)/,
    /^\/release($|\/)/,
    /^\/\.git($|\/)/,
    /^\/package-lock\.json$/,
    /^\/index\.html$/,
    /^\/vite\.config\.js$/,
  ],
});

for (const packageDirectory of appPaths) {
  const appPath = join(packageDirectory, "SoftConnect.app");
  await access(appPath);
  const plistPath = join(appPath, "Contents/Info.plist");
  const unusedPermissionKeys = [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSAppTransportSecurity",
  ];
  for (const key of unusedPermissionKeys) {
    await exec("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plistPath]);
  }
  await exec("/usr/bin/plutil", ["-lint", plistPath]);
  const { stdout } = await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath]);
  const plist = JSON.parse(stdout);
  if (plist.CFBundleDisplayName !== "SoftConnect" || plist.CFBundleShortVersionString !== version) {
    throw new Error("Packaged app name or version did not match the source package");
  }
  if (plist.LSApplicationCategoryType !== "public.app-category.utilities") {
    throw new Error("Packaged app category was not Utilities");
  }
  if (unusedPermissionKeys.some((key) => Object.hasOwn(plist, key))) {
    throw new Error("Packaged app still declares an unused permission or transport exception");
  }
  if (await sha256(icon) !== await sha256(join(appPath, "Contents/Resources", plist.CFBundleIconFile))) {
    throw new Error("Packaged icon does not match the original SoftConnect icon");
  }
  await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const archive = join(release, `SoftConnect-${version}-mac-${process.arch}.zip`);
  try {
    await access(archive);
    throw new Error(`Release archive already exists: ${archive}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await exec("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archive]);
  await exec("/usr/bin/unzip", ["-tq", archive]);
  process.stdout.write(`${appPath}\n${archive}\nSHA-256 ${await sha256(archive)}\n`);
}
