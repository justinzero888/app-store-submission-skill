import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs,
  readIfExists,
  writeJson,
  resolveAppRoot,
} from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const appRoot = resolveAppRoot(args);
const out = path.resolve(args.out || path.join(appRoot, 'release-ops/release-profile.draft.json'));
const warnings = [];

function match(text, expression) {
  return text?.match(expression)?.[1] || null;
}

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(path.join(appRoot, candidate))) || candidates[0];
}

function findArtifact(directory, extension) {
  const fullDirectory = path.join(appRoot, directory);
  if (!fs.existsSync(fullDirectory)) return null;
  return fs.readdirSync(fullDirectory, { withFileTypes: true }).find((entry) => entry.isFile() && entry.name.endsWith(extension))?.name || null;
}

const pubspecPath = 'pubspec.yaml';
const pubspec = readIfExists(path.join(appRoot, pubspecPath));
const androidManifestPath = firstExisting(['android/app/src/main/AndroidManifest.xml']);
const androidGradlePath = firstExisting(['android/app/build.gradle.kts', 'android/app/build.gradle']);
const iosInfoPath = firstExisting(['ios/Runner/Info.plist']);
const iosProjectPath = firstExisting(['ios/Runner.xcodeproj/project.pbxproj']);
const androidManifest = readIfExists(path.join(appRoot, androidManifestPath));
const androidGradle = readIfExists(path.join(appRoot, androidGradlePath));
const iosInfo = readIfExists(path.join(appRoot, iosInfoPath));
const iosProject = readIfExists(path.join(appRoot, iosProjectPath));
const keyPropertiesPath = 'android/key.properties';
const keyProperties = readIfExists(path.join(appRoot, keyPropertiesPath));
const adConfigPath = firstExisting(['lib/src/app/ad_mob_config.dart', 'lib/ad_mob_config.dart']);
const adConfig = readIfExists(path.join(appRoot, adConfigPath));
const hasAdMobDependency = /^\s+google_mobile_ads:/m.test(pubspec || '');
const hasIapDependency = /^\s+in_app_purchase:/m.test(pubspec || '');
const version = match(pubspec, /^version:\s*([^\s#]+)/m);
const displayName = match(iosInfo, /<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/) || null;
const iosBundleIds = [...(iosProject || '').matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map((entry) => entry[1].trim());
const iosBundleId = iosBundleIds.find((value) => !value.endsWith('.RunnerTests')) || iosBundleIds[0] || null;
const androidApplicationId = match(androidGradle, /applicationId\s*=\s*"([^"]+)"/) || match(androidGradle, /applicationId\s+"([^"]+)"/);
const iosAdMobApplicationId = match(iosInfo, /<key>GADApplicationIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
const androidAdMobApplicationId = match(androidManifest, /android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[\s\S]*?android:value="([^"]+)"/);
const iosProductionBannerUnitId = match(adConfig, /_iOSProductionBannerUnitId\s*=\s*'([^']+)'/);
const androidProductionBannerUnitId = match(adConfig, /_androidProductionBannerUnitId\s*=\s*'([^']+)'/);
const testBannerUnitId = match(adConfig, /_testBannerUnitId\s*=\s*'([^']+)'/);
const androidKeyAlias = match(keyProperties, /^keyAlias\s*=\s*(.+)$/m);
const androidStoreFile = match(keyProperties, /^storeFile\s*=\s*(.+)$/m);
const iosIpa = findArtifact('build/ios/ipa', '.ipa');
const androidAab = findArtifact('build/app/outputs/bundle/release', '.aab');

if (!pubspec) warnings.push('pubspec.yaml was not found; version and framework could not be inferred.');
if (!displayName) warnings.push('App display name was not inferred; replace the profile placeholder.');
if (!iosBundleId) warnings.push('iOS bundle ID was not inferred; confirm the Xcode project/profile.');
if (!androidApplicationId) warnings.push('Android application ID was not inferred; confirm the Gradle project/profile.');
if (hasAdMobDependency && (!iosAdMobApplicationId || !androidAdMobApplicationId)) warnings.push('AdMob dependency found but one or more application IDs were not inferred.');
if (hasIapDependency) warnings.push('IAP dependency found, but product IDs cannot be inferred from app code; add them manually to the profile.');
if (!fs.existsSync(path.join(appRoot, keyPropertiesPath))) warnings.push('Android key.properties is not present; this is expected until signing is configured.');

const profile = {
  schemaVersion: 1,
  app: {
    displayName: displayName || 'REPLACE WITH APP DISPLAY NAME',
    framework: pubspec ? 'flutter' : null,
    iosBundleId,
    androidApplicationId,
    supportUrl: null,
    privacyPolicyUrl: null,
    marketingUrl: null,
  },
  release: {
    versionSource: pubspecPath,
    discoveredVersion: version,
    buildNumberPolicy: 'one shared monotonically increasing integer',
    defaultChannel: 'internal',
  },
  paths: {
    pubspec: pubspecPath,
    iosInfo: iosInfoPath,
    iosProject: iosProjectPath,
    iosExportOptions: fs.existsSync(path.join(appRoot, 'ios/ExportOptions.plist')) ? 'ios/ExportOptions.plist' : null,
    androidManifest: androidManifestPath,
    androidGradle: androidGradlePath,
    androidKeyProperties: keyPropertiesPath,
    androidKeystore: androidStoreFile ? (path.isAbsolute(androidStoreFile) ? androidStoreFile : path.join('android', androidStoreFile)) : 'android/app/upload-keystore.jks',
    iosIpa: iosIpa ? path.join('build/ios/ipa', iosIpa) : 'build/ios/ipa/app.ipa',
    androidAab: androidAab ? path.join('build/app/outputs/bundle/release', androidAab) : 'build/app/outputs/bundle/release/app-release.aab',
  },
  signing: {
    android: { keyAlias: androidKeyAlias, secretKeys: ['storePassword', 'keyPassword'] },
    ios: { teamId: match(iosProject, /DEVELOPMENT_TEAM\s*=\s*([^;]+);/), exportMethod: 'app-store' },
  },
  monetization: {
    admob: {
      enabled: hasAdMobDependency || Boolean(iosAdMobApplicationId || androidAdMobApplicationId),
      applicationIds: { ios: iosAdMobApplicationId, android: androidAdMobApplicationId },
      bannerUnitIds: { ios: iosProductionBannerUnitId, android: androidProductionBannerUnitId },
      testBannerUnitId,
      gameplayAds: 'confirm from product behavior',
      noFillFallback: testBannerUnitId ? 'test unit per request, retry production on next request' : null,
      appAdsTxt: { publisherLine: null, host: null },
    },
    iap: { enabled: hasIapDependency, products: [] },
  },
  validation: {
    commands: fs.existsSync(path.join(appRoot, 'scripts/run_validation.sh')) ? ['scripts/run_validation.sh'] : [],
    requiresCleanTreeForProduction: true,
  },
  discovery: { warnings },
};

writeJson(out, profile);
console.log(`Wrote profile draft: ${out}`);
for (const warning of warnings) console.warn(`warning: ${warning}`);
