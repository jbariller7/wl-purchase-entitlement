import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_KIND = "wonderlang-rmmz-desktop-entitlement-test";
const BUILD_VERSION = 1;
const MARKER_FILENAME = ".wl-rmmz-test-build.json";
const DEFAULT_API_BASE_URL = "https://wl-purchase-entitlement.netlify.app";

const REQUIRED_SOURCE_FILES = [
  "index.html",
  "package.json",
  "js/plugins.js"
];

const ROOT_RUNTIME_FILES = [
  "index.html",
  "package.json",
  "game.rmmzproject",
  "rpg_map_data.json",
  "steam_api.dll",
  "steam_api64.dll",
  "steam_appid.txt",
  "NekoGakuen_SteamworksPlus.dll",
  "NekoGakuen_SteamworksPlus.dylib",
  "libsteam_api.dylib",
  "libsteam_api.so"
];

const LINKED_RUNTIME_DIRECTORIES = [
  "audio",
  "css",
  "data",
  "effects",
  "fonts",
  "icon",
  "img",
  "models",
  "movies",
  "texts",
  "AR",
  "DE",
  "EN",
  "ES",
  "EX",
  "FR",
  "HY",
  "IT",
  "JP",
  "KR",
  "NL",
  "PT",
  "PT PT",
  "RU",
  "SV",
  "US",
  "ZH"
];

const ACCOUNT_PLUGINS = [
  {
    name: "WonderLangDesktopAccountBridge",
    description: "Secure PC/Mac device-code sign-in bridge for WonderLang accounts (duplicate test integration)."
  },
  {
    name: "WonderLangAccountCloudSync",
    description: "WonderLang account UI, cross-platform entitlements, and conflict-safe cloud saves (test integration)."
  }
];

const RUNTIME_PROBE_PLUGIN = {
  name: "WonderLangDesktopRuntimeProbe",
  description: "Disposable isolated-build probe for the WonderLang PC/Mac account integration."
};

const TEST_BUILD_PLUGINS = [RUNTIME_PROBE_PLUGIN, ...ACCOUNT_PLUGINS];

function parseArguments(argv) {
  const result = { replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--replace") {
      result.replace = true;
      continue;
    }
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const equalsAt = item.indexOf("=");
    const key = item.slice(2, equalsAt === -1 ? undefined : equalsAt);
    const value = equalsAt === -1 ? argv[++index] : item.slice(equalsAt + 1);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    if (key === "source") result.source = value;
    else if (key === "target") result.target = value;
    else if (key === "api-base-url") result.apiBaseUrl = value;
    else if (key === "nwjs-runtime") result.nwjsRuntime = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  return result;
}

async function pathExists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function requireFile(pathname, label) {
  const value = await stat(pathname);
  if (!value.isFile()) throw new Error(`${label} is not a file: ${pathname}`);
}

async function requireDirectory(pathname, label) {
  const value = await stat(pathname);
  if (!value.isDirectory()) throw new Error(`${label} is not a directory: ${pathname}`);
}

async function resolveNwjsRuntime(explicitPath) {
  const candidates = explicitPath
    ? [assertAbsolutePath("NW.js runtime", explicitPath)]
    : process.platform === "win32"
      ? [
          join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam", "steamapps", "common", "RPG Maker MZ", "nwjs-win")
        ]
      : [];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue;
    const runtimeRoot = await realpath(candidate);
    try {
      await requireFile(join(runtimeRoot, "nw.exe"), "NW.js executable");
      await requireFile(join(runtimeRoot, "nw.dll"), "NW.js runtime DLL");
      await requireFile(join(runtimeRoot, "resources.pak"), "NW.js resources bundle");
      return runtimeRoot;
    } catch (error) {
      if (explicitPath) throw error;
    }
  }
  throw new Error("A complete Windows NW.js runtime was not found. Pass --nwjs-runtime with the absolute RPG Maker MZ nwjs-win directory.");
}

function normalizeApiBaseUrl(value) {
  const url = new URL(value || DEFAULT_API_BASE_URL);
  if (url.protocol !== "https:") throw new Error("The account API URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The account API URL cannot contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function assertAbsolutePath(label, value) {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an explicit absolute path.`);
  return resolve(value);
}

function assertInsideManagedStagingRoot(stagingRoot, targetRoot) {
  const relativeTarget = relative(stagingRoot, targetRoot);
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === ".." || isAbsolute(relativeTarget)) {
    throw new Error(`Target must be inside ${stagingRoot}.`);
  }
  if (!/^wl-rmmz-desktop-entitlement-test(?:-[a-z0-9-]+)?$/i.test(basename(targetRoot))) {
    throw new Error("Target directory name must start with wl-rmmz-desktop-entitlement-test.");
  }
}

async function sha256File(pathname) {
  return createHash("sha256").update(await readFile(pathname)).digest("hex");
}

async function configureTestPackage(packagePath) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.name = "wonderlang-entitlement-test";
  packageJson.window = {
    ...(packageJson.window || {}),
    title: "WonderLang — Entitlement Test"
  };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return { name: packageJson.name, title: packageJson.window.title };
}

function updatePluginConfiguration(sourceText, apiBaseUrl) {
  const arrayStart = sourceText.indexOf("[");
  const arrayEnd = sourceText.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd <= arrayStart) throw new Error("RPG Maker plugins.js array was not found.");

  let entries;
  try {
    entries = JSON.parse(sourceText.slice(arrayStart, arrayEnd + 1));
  } catch (error) {
    throw new Error(`RPG Maker plugins.js is not a JSON-compatible plugin array: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error("RPG Maker plugins.js did not contain an array.");

  const testPluginNames = new Set(TEST_BUILD_PLUGINS.map(plugin => plugin.name));
  const filtered = entries.filter(entry => !testPluginNames.has(String(entry?.name || "")));
  filtered.unshift({
    name: RUNTIME_PROBE_PLUGIN.name,
    status: true,
    description: RUNTIME_PROBE_PLUGIN.description,
    parameters: { ApiBaseUrl: apiBaseUrl, ExitWhenDone: "true" }
  });
  for (const plugin of ACCOUNT_PLUGINS) {
    filtered.push({
      name: plugin.name,
      status: true,
      description: plugin.description,
      parameters: { ApiBaseUrl: apiBaseUrl }
    });
  }

  const configuredNames = filtered.map(entry => String(entry?.name || ""));
  const bridgeIndex = configuredNames.indexOf("WonderLangDesktopAccountBridge");
  const cloudIndex = configuredNames.indexOf("WonderLangAccountCloudSync");
  if (bridgeIndex === -1 || cloudIndex !== bridgeIndex + 1) {
    throw new Error("Account plugins were not configured in the required order.");
  }

  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const body = filtered.map(entry => JSON.stringify(entry)).join(`,${newline}`);
  return `${sourceText.slice(0, arrayStart)}[${newline}${body}${newline}]${sourceText.slice(arrayEnd + 1)}`;
}

async function readManagedMarker(targetRoot) {
  const markerPath = join(targetRoot, MARKER_FILENAME);
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`Existing target is not a managed WonderLang test build: ${error.message}`);
  }
  if (marker?.kind !== BUILD_KIND || marker?.version !== BUILD_VERSION) {
    throw new Error("Existing target has an unexpected or unsupported build marker.");
  }
  return marker;
}

async function prepareTarget({ sourceRoot, targetRoot, replace }) {
  if (!(await pathExists(targetRoot))) return;
  if (!replace) throw new Error("Target already exists. Pass --replace only for a previously managed test build.");

  const targetInfo = await lstat(targetRoot);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
    throw new Error("Refusing to replace a target that is not a normal directory.");
  }
  const marker = await readManagedMarker(targetRoot);
  if (resolve(marker.sourceRoot || "") !== sourceRoot || resolve(marker.targetRoot || "") !== targetRoot) {
    throw new Error("Existing build marker paths do not match this source and target.");
  }
  await rm(targetRoot, { recursive: true, force: false, maxRetries: 3 });
}

export async function prepareDesktopTestBuild(options) {
  const sourceInput = assertAbsolutePath("Source", options.source);
  const sourceRoot = await realpath(sourceInput);
  const stagingRoot = await realpath(join(sourceRoot, ".codex-tmp"));
  const targetRoot = assertAbsolutePath("Target", options.target);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const nwjsRuntimeRoot = await resolveNwjsRuntime(options.nwjsRuntime);

  assertInsideManagedStagingRoot(stagingRoot, targetRoot);
  if (sourceRoot === targetRoot) throw new Error("Source and target cannot be the same directory.");
  for (const required of REQUIRED_SOURCE_FILES) {
    await requireFile(join(sourceRoot, required), `Required source file ${required}`);
  }
  for (const required of ["js", "audio", "data", "img"]) {
    await requireDirectory(join(sourceRoot, required), `Required source directory ${required}`);
  }

  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const canonicalPluginDirectory = join(repositoryRoot, "integrations", "rmmz");
  for (const plugin of TEST_BUILD_PLUGINS) {
    await requireFile(join(canonicalPluginDirectory, `${plugin.name}.js`), `Canonical plugin ${plugin.name}`);
  }

  const sourcePluginConfigPath = join(sourceRoot, "js", "plugins.js");
  const sourcePluginConfigHashBefore = await sha256File(sourcePluginConfigPath);
  await prepareTarget({ sourceRoot, targetRoot, replace: Boolean(options.replace) });
  await mkdir(targetRoot, { recursive: false });

  const copiedRootFiles = [];
  for (const filename of ROOT_RUNTIME_FILES) {
    const sourcePath = join(sourceRoot, filename);
    if (!(await pathExists(sourcePath))) continue;
    await requireFile(sourcePath, `Runtime file ${filename}`);
    await copyFile(sourcePath, join(targetRoot, filename));
    copiedRootFiles.push(filename);
  }
  const testPackage = await configureTestPackage(join(targetRoot, "package.json"));

  await cp(join(sourceRoot, "js"), join(targetRoot, "js"), {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true
  });

  const linkedDirectories = [];
  for (const directory of LINKED_RUNTIME_DIRECTORIES) {
    const sourcePath = join(sourceRoot, directory);
    if (!(await pathExists(sourcePath))) continue;
    await requireDirectory(sourcePath, `Runtime directory ${directory}`);
    await symlink(sourcePath, join(targetRoot, directory), process.platform === "win32" ? "junction" : "dir");
    linkedDirectories.push({ directory, sourcePath });
  }

  await mkdir(join(targetRoot, "save"));
  await mkdir(join(targetRoot, "achievement_shares"));
  const launcherFilename = "Run-WonderLang-Entitlement-Test.cmd";
  const launcherPath = join(targetRoot, launcherFilename);
  const nwjsExecutablePath = join(nwjsRuntimeRoot, "nw.exe");
  await writeFile(
    launcherPath,
    `@echo off\r\ncd /d "%~dp0"\r\n"${nwjsExecutablePath}" "%~dp0."\r\n`,
    "utf8"
  );

  const pluginManifest = [];
  for (const plugin of TEST_BUILD_PLUGINS) {
    const filename = `${plugin.name}.js`;
    const canonicalPath = join(canonicalPluginDirectory, filename);
    const targetPath = join(targetRoot, "js", "plugins", filename);
    await copyFile(canonicalPath, targetPath);
    pluginManifest.push({
      name: plugin.name,
      sha256: await sha256File(targetPath)
    });
  }

  const targetPluginConfigPath = join(targetRoot, "js", "plugins.js");
  const targetPluginConfigSource = await readFile(targetPluginConfigPath, "utf8");
  await writeFile(
    targetPluginConfigPath,
    updatePluginConfiguration(targetPluginConfigSource, apiBaseUrl),
    "utf8"
  );

  const sourcePluginConfigHashAfter = await sha256File(sourcePluginConfigPath);
  if (sourcePluginConfigHashAfter !== sourcePluginConfigHashBefore) {
    throw new Error("Production js/plugins.js changed while preparing the test build.");
  }

  const marker = {
    kind: BUILD_KIND,
    version: BUILD_VERSION,
    createdAt: new Date().toISOString(),
    sourceRoot,
    targetRoot,
    apiBaseUrl,
    copiedRootFiles,
    copiedCodeDirectory: "js",
    isolatedWritableDirectories: ["save", "achievement_shares"],
    linkedDirectories,
    accountPluginOrder: ACCOUNT_PLUGINS.map(plugin => plugin.name),
    testPluginOrder: TEST_BUILD_PLUGINS.map(plugin => plugin.name),
    plugins: pluginManifest,
    sourcePluginConfigSha256: sourcePluginConfigHashBefore,
    targetPluginConfigSha256: await sha256File(targetPluginConfigPath),
    nwjsRuntime: {
      root: nwjsRuntimeRoot,
      executable: nwjsExecutablePath,
      executableSha256: await sha256File(nwjsExecutablePath),
      runtimeDllSha256: await sha256File(join(nwjsRuntimeRoot, "nw.dll")),
      resourcesSha256: await sha256File(join(nwjsRuntimeRoot, "resources.pak"))
    },
    launcher: launcherFilename,
    isolatedApplicationIdentity: testPackage,
    productionFilesModified: false,
    warnings: [
      "Disposable test build only; do not publish it.",
      "Linked asset directories point at the source project and must be treated as read-only.",
      "Launch through Run-WonderLang-Entitlement-Test.cmd; the source WonderLang.exe is intentionally not copied without its NW.js runtime.",
      "Real account sign-in remains fail-closed until the staging backend feature switch and Firebase credentials are configured."
    ]
  };
  await writeFile(join(targetRoot, MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.source || !options.target) {
    throw new Error("Usage: node scripts/prepare-rmmz-desktop-test-build.mjs --source <absolute-game-root> --target <absolute-test-root> [--api-base-url <https-url>] [--nwjs-runtime <absolute-nwjs-win-root>] [--replace]");
  }
  const result = await prepareDesktopTestBuild(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
}
