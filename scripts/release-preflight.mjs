import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  gitSnapshot,
  normalizeProfile,
  parseArgs,
  parsePubspec,
  readIfExists,
  resolveAppRoot,
  resolvePath,
  resolveProfile,
} from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const appRoot = resolveAppRoot(args);
const resolved = resolveProfile(args, appRoot);
const profile = normalizeProfile(resolved.value, resolved.path);
const channel = args.channel || profile.release?.defaultChannel || 'internal';
const version = args.version || profile.release?.discoveredVersion || '0.0.0';
const build = String(args.build || '1');
const errors = [];
const warnings = [];
const appCheck = Boolean(args['app-root'] || fs.existsSync(resolvePath(appRoot, profile.paths?.pubspec || 'pubspec.yaml')));

function checkFile(relativePath, label, strict = false) {
  if (relativePath && fs.existsSync(resolvePath(appRoot, relativePath))) return;
  const message = `${label} is missing: ${relativePath || '(not configured)'}`;
  (strict ? errors : warnings).push(message);
}

function checkText(relativePath, expected, label) {
  const text = relativePath ? readIfExists(resolvePath(appRoot, relativePath)) : null;
  assert(text?.includes(expected), `${label} does not contain expected value: ${expected}`, errors);
}

assert(/^\d+\.\d+\.\d+$/.test(version), `version must be semver-like, got ${version}`, errors);
assert(/^\d+$/.test(build) && Number(build) > 0, `build must be a positive integer, got ${build}`, errors);
assert(['internal', 'beta', 'production'].includes(channel), `unsupported channel: ${channel}`, errors);
assert(profile.app?.iosBundleId || profile.app?.androidApplicationId, 'profile must contain at least one platform identifier', errors);

const admob = profile.monetization?.admob;
if (admob?.enabled) {
  for (const [platform, id] of Object.entries(admob.applicationIds || {})) {
    assert(typeof id === 'string' && id.includes('ca-app-pub-') && id.includes('~'), `missing/invalid AdMob ${platform} application ID`, errors);
  }
  for (const [platform, id] of Object.entries(admob.bannerUnitIds || {})) {
    assert(typeof id === 'string' && id.includes('ca-app-pub-') && id.includes('/'), `missing/invalid AdMob ${platform} banner unit ID`, errors);
    assert(id !== admob.testBannerUnitId, `${platform} production AdMob unit equals the test unit`, errors);
  }
  assert(typeof admob.testBannerUnitId === 'string' && admob.testBannerUnitId.includes('/'), 'AdMob is enabled but no test banner unit is configured', errors);
}

const products = profile.monetization?.iap?.products || [];
const productIds = new Set();
for (const product of products) {
  assert(!productIds.has(product.productId), `duplicate IAP product ID: ${product.productId}`, errors);
  productIds.add(product.productId);
  assert(typeof product.productId === 'string' && /^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)+$/.test(product.productId), `invalid IAP product ID: ${product.productId}`, errors);
  assert(['planned', 'active', 'retired'].includes(product.status), `invalid IAP status: ${product.productId}`, errors);
  if (args['iap-enabled'] && product.status !== 'active') errors.push(`IAP enabled but ${product.productId} is ${product.status}`);
}
if (args['iap-enabled']) assert(profile.monetization?.iap?.enabled === true, 'IAP was requested but profile.monetization.iap.enabled is false', errors);

if (appCheck) {
  checkFile(profile.paths.pubspec, 'pubspec', true);
  const pubspec = parsePubspec(appRoot, profile.paths.pubspec);
  if (pubspec?.version) assert(pubspec.version.split('+')[0] === version, `pubspec version ${pubspec.version} does not match ${version}`, errors);
  if (profile.app.androidApplicationId) checkText(profile.paths.androidGradle, profile.app.androidApplicationId, 'Android build config');
  if (profile.app.iosBundleId) checkText(profile.paths.iosProject, `PRODUCT_BUNDLE_IDENTIFIER = ${profile.app.iosBundleId};`, 'iOS Xcode project');
  if (admob?.enabled) {
    checkText(profile.paths.androidManifest, admob.applicationIds.android, 'Android AdMob manifest');
    checkText(profile.paths.iosInfo, admob.applicationIds.ios, 'iOS AdMob Info.plist');
    checkText(profile.paths.iosInfo, 'NSUserTrackingUsageDescription', 'iOS ATT metadata');
  }
  const strictSigning = channel === 'production' || Boolean(args['verify-signing']);
  checkFile(profile.paths.androidKeyProperties, 'Android key.properties', strictSigning);
  checkFile(profile.paths.androidKeystore, 'Android upload keystore', strictSigning);
  if (strictSigning) checkFile(profile.paths.iosExportOptions, 'iOS export options', true);
  if (profile.paths.androidKeyProperties && profile.signing?.android?.keyAlias) checkText(profile.paths.androidKeyProperties, `keyAlias=${profile.signing.android.keyAlias}`, 'Android key.properties');
  const gradle = readIfExists(resolvePath(appRoot, profile.paths.androidGradle));
  if (channel === 'production') {
    assert(!/else\s*\{\s*signingConfigs\.getByName\(["']debug["']\)/s.test(gradle || ''), 'Android release build silently falls back to debug signing', errors);
  }
}

const git = gitSnapshot(appRoot);
if (args['require-clean'] || (channel === 'production' && profile.validation?.requiresCleanTreeForProduction !== false)) assert(!git.dirty, 'app repository has uncommitted changes', errors);

console.log(`Release preflight: ${profile.app.displayName || 'Unnamed app'} ${channel} ${version} (${build})`);
console.log(`Profile: ${resolved.path}`);
if (git.commit) console.log(`Commit: ${git.commit}${git.dirty ? ' (dirty)' : ''}`);
console.log(`AdMob: ${admob?.enabled ? 'enabled' : 'disabled/not configured'}`);
console.log(`IAP: ${profile.monetization?.iap?.enabled ? `${products.length} product(s)` : 'disabled/not configured'}`);
for (const warning of [...(profile.discovery?.warnings || []), ...warnings]) console.warn(`warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log('PASS: profile and release preflight checks passed.');
}
