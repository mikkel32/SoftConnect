import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packager } from "@electron/packager";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = join(root, "src/assets/softconnect-icon.svg");
const icon = join(root, "assets/SoftConnect.icns");
const release = process.env.SOFTCONNECT_PACKAGE_OUT || join(root, "release");
const iconSizes = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
];

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
  await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const info = await readFile(join(appPath, "Contents/Info.plist"));
  if (!info.includes(Buffer.from("SoftConnect"))) throw new Error("Packaged app identity could not be verified");
  process.stdout.write(`${appPath}\n`);
}
