import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const skillRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const equals = key.indexOf('=');
    if (equals >= 0) {
      args[key.slice(0, equals)] = key.slice(equals + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

export function resolveAppRoot(args) {
  return path.resolve(args['app-root'] || process.cwd());
}

export function resolveProfile(args, appRoot) {
  const candidates = [
    args.profile,
    path.join(appRoot, 'release-ops/release-profile.json'),
    path.join(appRoot, 'release-ops/release-config.json'),
  ].filter(Boolean).map((value) => path.resolve(value));
  const selected = candidates.find((value) => fs.existsSync(value));
  if (!selected) throw new Error('No release profile found. Pass --profile or create release-ops/release-profile.json.');
  return { path: selected, value: readJson(selected) };
}

export function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout?.trim() || '', stderr: result.stderr?.trim() || '' };
}

export function gitSnapshot(appRoot) {
  const commit = run('git', ['rev-parse', 'HEAD'], appRoot);
  const status = run('git', ['status', '--porcelain'], appRoot);
  return { commit: commit.status === 0 ? commit.stdout : null, dirty: status.status === 0 && Boolean(status.stdout), changes: status.stdout.split('\n').filter(Boolean) };
}

export function parsePubspec(appRoot, relativePath = 'pubspec.yaml') {
  const filePath = path.join(appRoot, relativePath);
  const text = readIfExists(filePath);
  if (!text) return null;
  return { version: text.match(/^version:\s*([^\s#]+)/m)?.[1] || null, name: text.match(/^name:\s*([^\s#]+)/m)?.[1] || null };
}

export function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

export function normalizeProfile(profile, profilePath) {
  if (profile.paths) return profile;
  const siblingIap = path.join(path.dirname(profilePath), 'iap-catalog.json');
  const iap = fs.existsSync(siblingIap) ? readJson(siblingIap) : { products: [] };
  const legacyAdmob = profile.admob || {};
  const legacyAdmobEnabled = legacyAdmob.enabled ?? Boolean(legacyAdmob.applicationIds || legacyAdmob.bannerUnitIds);
  return {
    schemaVersion: 1,
    app: profile.app,
    release: { versionSource: 'pubspec.yaml', buildNumberPolicy: profile.release?.buildNumberPolicy, defaultChannel: profile.release?.defaultChannel || 'internal' },
    paths: {
      pubspec: 'pubspec.yaml',
      iosInfo: 'ios/Runner/Info.plist',
      iosProject: 'ios/Runner.xcodeproj/project.pbxproj',
      iosExportOptions: profile.signing?.ios?.exportOptionsPlist || 'ios/ExportOptions.plist',
      androidManifest: 'android/app/src/main/AndroidManifest.xml',
      androidGradle: 'android/app/build.gradle.kts',
      androidKeyProperties: profile.signing?.android?.keyPropertiesPath || 'android/key.properties',
      androidKeystore: profile.signing?.android?.keystorePath || 'android/app/upload-keystore.jks',
      iosIpa: 'build/ios/ipa/orbace_sudoku.ipa',
      androidAab: 'build/app/outputs/bundle/release/app-release.aab',
    },
    signing: profile.signing,
    store: profile.store || { appleAppId: null, playPackageName: null, urls: {} },
    monetization: { admob: { ...legacyAdmob, enabled: legacyAdmobEnabled }, iap: { enabled: Boolean(iap.products?.length), products: iap.products || [] } },
    validation: { commands: profile.validation?.requiredCommands || [], requiresCleanTreeForProduction: true },
  };
}

export function resolvePath(appRoot, value) {
  return path.isAbsolute(value) ? value : path.join(appRoot, value);
}
