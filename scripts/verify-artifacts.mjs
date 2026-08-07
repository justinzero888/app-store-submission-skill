import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  normalizeProfile,
  parseArgs,
  resolveAppRoot,
  resolvePath,
  resolveProfile,
  run,
} from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const appRoot = resolveAppRoot(args);
const resolved = resolveProfile(args, appRoot);
const profile = normalizeProfile(resolved.value, resolved.path);
const version = args.version || profile.release?.discoveredVersion || '0.0.0';
const build = String(args.build || '1');
const errors = [];
const warnings = [];
const ipaPath = resolvePath(appRoot, profile.paths.iosIpa);
const aabPath = resolvePath(appRoot, profile.paths.androidAab);

assert(fs.existsSync(ipaPath), `iOS IPA is missing: ${ipaPath}`, errors);
assert(fs.existsSync(aabPath), `Android AAB is missing: ${aabPath}`, errors);

if (fs.existsSync(ipaPath)) {
  const listing = run('unzip', ['-Z1', ipaPath], appRoot);
  assert(listing.status === 0, `could not list IPA: ${listing.stderr}`, errors);
  const plistEntry = listing.stdout.split('\n').find((entry) => /Payload\/[^/]+\.app\/Info\.plist$/.test(entry));
  assert(Boolean(plistEntry), 'IPA does not contain an app Info.plist', errors);
  if (plistEntry) {
    const plist = run('sh', ['-c', `unzip -p "$1" "$2" | plutil -p -`, 'verify-artifacts', ipaPath, plistEntry], appRoot);
    assert(plist.status === 0, `could not decode IPA Info.plist: ${plist.stderr}`, errors);
    if (profile.app.iosBundleId) assert(plist.stdout.includes(profile.app.iosBundleId), 'IPA bundle ID does not match profile', errors);
    assert(plist.stdout.includes(version), `IPA does not contain version ${version}`, errors);
    assert(plist.stdout.includes(`"CFBundleVersion" => "${build}"`), `IPA does not contain build ${build}`, errors);
    if (profile.monetization?.admob?.enabled && profile.monetization.admob.applicationIds?.ios) assert(plist.stdout.includes(profile.monetization.admob.applicationIds.ios), 'IPA AdMob application ID does not match profile', errors);
  }
}

if (fs.existsSync(aabPath)) {
  const listing = run('unzip', ['-Z1', aabPath], appRoot);
  assert(listing.status === 0, `could not list AAB: ${listing.stderr}`, errors);
  assert(listing.stdout.includes('base/manifest/AndroidManifest.xml'), 'AAB does not contain the base Android manifest', errors);
  const jarsigner = run('jarsigner', ['-verify', '-verbose', '-certs', aabPath], appRoot);
  if (jarsigner.status !== 0 && /not found|No such file|Unable to locate a Java Runtime|No Java runtime/i.test(jarsigner.stderr)) warnings.push('jarsigner/Java is unavailable; AAB signature was not verified locally.');
  else assert(jarsigner.status === 0, `AAB signature verification failed: ${jarsigner.stderr || jarsigner.stdout}`, errors);
}

console.log(`Artifact verification: ${profile.app?.displayName || 'app'} ${version} (${build})`);
for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else console.log('PASS: basic IPA/AAB metadata and signature checks passed.');
