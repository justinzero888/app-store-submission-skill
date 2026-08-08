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
  const isGoogleTestId = (value) => typeof value === 'string' && value.startsWith('ca-app-pub-3940256099942544');
  for (const [platform, id] of Object.entries(admob.applicationIds || {})) {
    assert(typeof id === 'string' && id.includes('ca-app-pub-') && id.includes('~'), `missing/invalid AdMob ${platform} application ID`, errors);
  }
  for (const [platform, id] of Object.entries(admob.bannerUnitIds || {})) {
    assert(typeof id === 'string' && id.includes('ca-app-pub-') && id.includes('/'), `missing/invalid AdMob ${platform} banner unit ID`, errors);
    assert(id !== admob.testBannerUnitId, `${platform} production AdMob unit equals the test unit`, errors);
  }
  assert(typeof admob.testBannerUnitId === 'string' && admob.testBannerUnitId.includes('/'), 'AdMob is enabled but no test banner unit is configured', errors);
  if (channel === 'production') {
    for (const [platform, id] of Object.entries(admob.applicationIds || {})) {
      if (isGoogleTestId(id)) errors.push(`production channel still uses the Google test AdMob ${platform} application ID: ${id}`);
    }
    for (const [platform, id] of Object.entries(admob.bannerUnitIds || {})) {
      if (isGoogleTestId(id)) errors.push(`production channel still uses a Google test AdMob ${platform} banner unit: ${id}`);
    }
  }
}

const products = profile.monetization?.iap?.products || [];
const productIds = new Set();
const entitlements = new Set();
for (const product of products) {
  assert(!productIds.has(product.productId), `duplicate IAP product ID: ${product.productId}`, errors);
  productIds.add(product.productId);
  assert(typeof product.productId === 'string' && /^[A-Za-z0-9]+(?:\.[A-Za-z0-9_-]+)+$/.test(product.productId), `invalid IAP product ID: ${product.productId}`, errors);
  assert(['consumable', 'non_consumable', 'subscription'].includes(product.kind), `invalid IAP kind for ${product.productId}: ${product.kind}`, errors);
  assert(['planned', 'active', 'retired'].includes(product.status), `invalid IAP status: ${product.productId}`, errors);
  const productEntitlements = Array.isArray(product.entitlements)
    ? product.entitlements
    : (product.entitlement ? [product.entitlement] : []);
  assert(productEntitlements.length > 0, `IAP product ${product.productId} has no entitlements`, errors);
  for (const entitlement of productEntitlements) {
    if (product.status === 'active' && entitlements.has(entitlement)) warnings.push(`IAP entitlement '${entitlement}' is shared by more than one active product; confirm this is intended`);
    entitlements.add(entitlement);
  }
  if (product.kind === 'subscription') {
    const sub = product.subscription;
    const onIos = !product.platforms || product.platforms.includes('ios');
    const onAndroid = !product.platforms || product.platforms.includes('android');
    assert(sub && /^(\d+)(w|m|y)$/.test(sub.duration || ''), `subscription ${product.productId} needs a duration (1w/1m/3m/6m/1y)`, errors);
    assert(sub?.iosGroup || !onIos, `subscription ${product.productId} is on iOS but has no App Store Connect subscription group (iosGroup)`, errors);
    assert(sub?.androidBasePlanId || !onAndroid, `subscription ${product.productId} is on Android but has no Google Play base plan (androidBasePlanId)`, errors);
  }
  if (args['iap-enabled'] && product.status !== 'active') errors.push(`IAP enabled but ${product.productId} is ${product.status}`);
}
if (args['iap-enabled']) assert(profile.monetization?.iap?.enabled === true, 'IAP was requested but profile.monetization.iap.enabled is false', errors);

const store = profile.store;
if (store) {
  if (store.playPackageName && profile.app?.androidApplicationId && store.playPackageName !== profile.app.androidApplicationId) {
    errors.push(`store-record drift: Play package '${store.playPackageName}' does not match Android application id '${profile.app.androidApplicationId}'`);
  }
  if (store.appleAppId && profile.app?.iosBundleId) {
    const urls = store.urls || {};
    if (urls.ios && !urls.ios.includes(store.appleAppId)) errors.push(`store-record drift: iOS store URL does not contain the declared Apple App ID ${store.appleAppId}`);
    if (urls.android && !urls.android.includes(store.playPackageName || profile.app.androidApplicationId || 'no-package')) errors.push('store-record drift: Android store URL does not contain the declared Play package name');
  }
}

if (appCheck) {
  checkFile(profile.paths.pubspec, 'pubspec', true);
  const pubspec = parsePubspec(appRoot, profile.paths.pubspec);
  if (pubspec?.version) assert(pubspec.version.split('+')[0] === version, `pubspec version ${pubspec.version} does not match ${version}`, errors);
  if (profile.app.androidApplicationId) checkText(profile.paths.androidGradle, profile.app.androidApplicationId, 'Android build config');
  if (profile.app.iosBundleId) checkText(profile.paths.iosProject, `PRODUCT_BUNDLE_IDENTIFIER = ${profile.app.iosBundleId};`, 'iOS Xcode project');
  if (admob?.enabled) {
    checkText(profile.paths.androidManifest, admob.applicationIds.android, 'Android AdMob manifest');
    checkText(profile.paths.iosInfo, admob.applicationIds.ios, 'iOS AdMob Info.plist');
    const attPlist = readIfExists(resolvePath(appRoot, profile.paths.iosInfo));
    const attText = attPlist?.match(/<key>NSUserTrackingUsageDescription<\/key>\s*<string>([^<]*)<\/string>/)?.[1]?.trim();
    assert(typeof attText === 'string' && attText.length > 0, 'iOS ATT usage description is missing or empty in Info.plist', errors);
    if (attText) warnings.push('Confirm the iOS ATT usage-description copy matches the privacy policy and review requirements.');
  }
  const strictSigning = channel === 'production' || Boolean(args['verify-signing']);
  checkFile(profile.paths.androidKeyProperties, 'Android key.properties', strictSigning);
  checkFile(profile.paths.androidKeystore, 'Android upload keystore', strictSigning);
  if (strictSigning && profile.paths.iosExportOptions) checkFile(profile.paths.iosExportOptions, 'iOS export options', true);
  if (profile.paths.androidKeyProperties && profile.signing?.android?.keyAlias) checkText(profile.paths.androidKeyProperties, `keyAlias=${profile.signing.android.keyAlias}`, 'Android key.properties');
  const gradle = readIfExists(resolvePath(appRoot, profile.paths.androidGradle));
  if (channel === 'production') {
    const gradleText = gradle || '';
    const releaseSigningPattern = /signingConfig\s*=\s*(signingConfigs\.getByName\(["']release["']\)|["']release["']|if\s*\()/;
    const debugSigningPattern = /signingConfig\s*=\s*(signingConfigs\.getByName\(["']debug["']\)|["']debug["'])/;
    const conditionalFallback = /if\s*\([^)]*\.exists\(\)\)[\s\S]*?signingConfigs\.getByName\(["']debug["']\)/.test(gradleText);
    const keyMaterialPresent = Boolean(
      profile.paths.androidKeyProperties && fs.existsSync(resolvePath(appRoot, profile.paths.androidKeyProperties)) &&
      profile.paths.androidKeystore && fs.existsSync(resolvePath(appRoot, profile.paths.androidKeystore)),
    );
    if (debugSigningPattern.test(gradleText) && !releaseSigningPattern.test(gradleText) && !conditionalFallback) {
      errors.push('Android release build is configured to use debug signing');
    } else if (conditionalFallback && !keyMaterialPresent) {
      errors.push('Android release build falls back to debug signing but release key material is missing');
    } else if (conditionalFallback) {
      warnings.push('Android release signing uses a conditional debug fallback; release signing is active because key material exists');
    }
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
