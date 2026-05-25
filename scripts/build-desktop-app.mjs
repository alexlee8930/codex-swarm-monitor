#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const target = args.target;
const standaloneName = `codex-swarm-monitor-${target}`;
const distRoot = join(root, "dist");
const standaloneRoot = join(distRoot, standaloneName);
const stageRoot = join(distRoot, `desktop-app-${target}`);
const appBundle = join(stageRoot, "Codex Swarm Monitor.app");
const contentsRoot = join(appBundle, "Contents");
const macosRoot = join(contentsRoot, "MacOS");
const resourcesRoot = join(contentsRoot, "Resources");
const embeddedStandaloneRoot = join(resourcesRoot, standaloneName);
const appExecutableName = "Codex Swarm Monitor";

if (!target.startsWith("darwin-")) {
  throw new Error(`Desktop .app wrapper currently supports darwin targets only, received ${target}`);
}

if (args.buildStandalone || !existsSync(join(standaloneRoot, "manifest.json"))) {
  const buildArgs = ["scripts/build-standalone.mjs", "--target", target];
  if (args.nodeRuntime) buildArgs.push("--node-runtime", args.nodeRuntime);
  const manifest = JSON.parse(execFileSync(process.execPath, buildArgs, { cwd: root, encoding: "utf8" }));
  assert.equal(manifest.target, target);
}

const standaloneManifest = JSON.parse(readFileSync(join(standaloneRoot, "manifest.json"), "utf8"));
assert.equal(standaloneManifest.target, target);

rmSync(stageRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
mkdirSync(macosRoot, { recursive: true });
mkdirSync(resourcesRoot, { recursive: true });
cpSync(standaloneRoot, embeddedStandaloneRoot, { recursive: true, dereference: true });

writeInfoPlist();
writePkgInfo();
writeLauncher();
writeReadme();

const manifestBase = {
  name: "codex-swarm-monitor-desktop-app",
  version: packageJson.version,
  target,
  bundle: "Codex Swarm Monitor.app",
  stage: relative(root, appBundle),
  archive: relative(root, join(distRoot, `${standaloneName}.app.tar.gz`)),
  checksumFile: relative(root, join(distRoot, `${standaloneName}.app.tar.gz.sha256`)),
  embeddedStandalone: standaloneName,
  executable: `Contents/MacOS/${appExecutableName}`,
  shellOpensBrowser: false,
  nativeWebView: true
};
writeFileSync(join(resourcesRoot, "desktop-manifest.json"), `${JSON.stringify(manifestBase, null, 2)}\n`);

const archive = join(distRoot, `${standaloneName}.app.tar.gz`);
rmSync(archive, { force: true });
execFileSync("tar", ["-czf", archive, "-C", stageRoot, "Codex Swarm Monitor.app"], { stdio: "pipe" });
assert.ok(statSync(archive).size > 1_000_000, "desktop app archive should include the standalone runtime");
const checksum = sha256(archive);
writeFileSync(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);

const manifest = {
  ...manifestBase,
  checksum
};

assert.equal(existsSync(join(appBundle, manifest.executable)), true);
assert.equal(existsSync(join(embeddedStandaloneRoot, standaloneManifest.entrypoint)), true);
assert.equal(existsSync(join(contentsRoot, "Info.plist")), true);
console.log(JSON.stringify(manifest, null, 2));

function parseArgs(argv) {
  const options = {
    target: `${process.platform}-${process.arch}`,
    nodeRuntime: "",
    buildStandalone: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = normalizeTarget(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = normalizeTarget(arg.slice("--target=".length));
    } else if (arg === "--node-runtime") {
      options.nodeRuntime = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--node-runtime=")) {
      options.nodeRuntime = arg.slice("--node-runtime=".length);
    } else if (arg === "--build-standalone") {
      options.buildStandalone = true;
    } else if (arg === "--no-build-standalone") {
      options.buildStandalone = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!/^darwin-(arm64|x64)$/.test(options.target)) {
    throw new Error(`Invalid desktop app target: ${options.target}`);
  }
  if (options.nodeRuntime && !existsSync(options.nodeRuntime)) {
    throw new Error(`Node runtime not found: ${options.nodeRuntime}`);
  }
  return options;
}

function normalizeTarget(value) {
  return String(value || "").replace(/^codex-swarm-monitor-/, "");
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Codex Swarm Monitor</string>
  <key>CFBundleExecutable</key>
  <string>${appExecutableName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.codexswarm.monitor</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Codex Swarm Monitor</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${packageJson.version}</string>
  <key>CFBundleVersion</key>
  <string>${packageJson.version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright Codex Swarm Monitor contributors</string>
</dict>
</plist>
`;
  writeFileSync(join(contentsRoot, "Info.plist"), plist);
}

function writePkgInfo() {
  writeFileSync(join(contentsRoot, "PkgInfo"), "APPL????");
}

function writeLauncher() {
  if (process.platform !== "darwin") {
    throw new Error("The native macOS desktop app can only be built on macOS.");
  }

  const launcher = join(macosRoot, appExecutableName);
  const source = join(stageRoot, "CodexSwarmMonitorApp.swift");
  writeFileSync(source, swiftLauncherSource());
  const swiftc = execFileSync("xcrun", ["-find", "swiftc"], { encoding: "utf8" }).trim();
  const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).trim();
  const arch = target.endsWith("-x64") ? "x86_64" : "arm64";
  execFileSync(
    swiftc,
    [
      "-O",
      "-target",
      `${arch}-apple-macos12.0`,
      "-sdk",
      sdk,
      "-framework",
      "Cocoa",
      "-framework",
      "WebKit",
      source,
      "-o",
      launcher
    ],
    { stdio: "pipe" }
  );
  execFileSync("chmod", ["755", launcher]);
}

function writeReadme() {
  writeFileSync(
    join(resourcesRoot, "README-DESKTOP-APP.md"),
    `# Codex Swarm Monitor.app

Open \`Codex Swarm Monitor.app\` to start the bundled local monitor inside a native macOS WebKit window.

The app embeds the standalone runtime under \`Contents/Resources/${standaloneName}\`.
It does not install hooks into \`$HOME\` automatically. Pick or connect the real Codex workspace from the UI, or run the embedded launcher with \`--workspace /path/to/project --connect --open\`.

Logs are written to \`~/Library/Logs/Codex Swarm Monitor/app.log\`.
`
  );
}

function swiftLauncherSource() {
  return `import Cocoa
import WebKit
import Foundation

let standaloneName = "${standaloneName}"

func resourcesURL() -> URL {
  if let resourceURL = Bundle.main.resourceURL {
    return resourceURL
  }
  let executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
  return executableURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
}

func embeddedLauncherURL() -> URL {
  return resourcesURL().appendingPathComponent(standaloneName).appendingPathComponent("bin").appendingPathComponent("codex-swarm-monitor")
}

if CommandLine.arguments.count > 1 {
  let process = Process()
  process.executableURL = embeddedLauncherURL()
  process.arguments = Array(CommandLine.arguments.dropFirst())
  process.standardOutput = FileHandle.standardOutput
  process.standardError = FileHandle.standardError
  try process.run()
  process.waitUntilExit()
  exit(process.terminationStatus)
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var monitorProcess: Process?
  private var outputBuffer = ""
  private let logURL: URL = {
    let logs = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library")
      .appendingPathComponent("Logs")
      .appendingPathComponent("Codex Swarm Monitor")
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    return logs.appendingPathComponent("app.log")
  }()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    buildMenu()
    buildWindow()
    startMonitor()
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    monitorProcess?.terminate()
  }

  private func buildMenu() {
    let mainMenu = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Quit Codex Swarm Monitor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    mainMenu.addItem(appItem)
    NSApp.mainMenu = mainMenu
  }

  private func buildWindow() {
    let config = WKWebViewConfiguration()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.setValue(false, forKey: "drawsBackground")

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.title = "Codex Swarm Monitor"
    window.titlebarAppearsTransparent = true
    window.isMovableByWindowBackground = false
    window.minSize = NSSize(width: 980, height: 680)
    window.center()
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)

    renderLoading("Starting local monitor...")
  }

  private func startMonitor() {
    let process = Process()
    process.executableURL = embeddedLauncherURL()
    process.arguments = ["--workspace", FileManager.default.homeDirectoryForCurrentUser.path, "--port", "0"]
    process.environment = ProcessInfo.processInfo.environment.merging(["CODEX_SWARM_DESKTOP_APP": "1"]) { _, new in new }

    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
      self?.appendLog(text)
      self?.consumeOutput(text)
    }

    process.terminationHandler = { [weak self] terminated in
      if terminated.terminationStatus != 0 {
        DispatchQueue.main.async {
          self?.renderLoading("The local monitor stopped. Check ~/Library/Logs/Codex Swarm Monitor/app.log.")
        }
      }
    }

    do {
      try process.run()
      monitorProcess = process
    } catch {
      renderLoading("Could not start bundled monitor: \\(error.localizedDescription)")
    }
  }

  private func appendLog(_ text: String) {
    if !FileManager.default.fileExists(atPath: logURL.path) {
      FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    if let data = text.data(using: .utf8), let handle = try? FileHandle(forWritingTo: logURL) {
      defer { try? handle.close() }
      try? handle.seekToEnd()
      try? handle.write(contentsOf: data)
    }
  }

  private func consumeOutput(_ text: String) {
    outputBuffer += text
    if let url = firstMonitorURL(in: outputBuffer) {
      DispatchQueue.main.async { [weak self] in
        self?.webView.load(URLRequest(url: url))
      }
    }
  }

  private func firstMonitorURL(in text: String) -> URL? {
    guard let range = text.range(of: #"http://(127\\.0\\.0\\.1|localhost):[0-9]+"#, options: .regularExpression) else {
      return nil
    }
    return URL(string: String(text[range]))
  }

  private func renderLoading(_ message: String) {
    let html = """
    <!doctype html>
    <html>
      <head>
        <meta charset=\\"utf-8\\">
        <style>
          body {
            margin: 0;
            height: 100vh;
            display: grid;
            place-items: center;
            background: #f7f7f4;
            color: #24292f;
            font: 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
          }
          main {
            width: min(520px, calc(100vw - 48px));
            padding: 28px;
            border: 1px solid #d8d4cb;
            border-radius: 18px;
            background: #fffefb;
            box-shadow: 0 18px 45px rgba(27, 31, 36, .08);
          }
          h1 { margin: 0 0 10px; font-size: 18px; }
          p { margin: 0; color: #6e7781; line-height: 1.5; }
        </style>
      </head>
      <body>
        <main>
          <h1>Codex Swarm Monitor</h1>
          <p>\\(escapeHTML(message))</p>
        </main>
      </body>
    </html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  private func escapeHTML(_ value: String) -> String {
    return value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\\"", with: "&quot;")
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
`;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
