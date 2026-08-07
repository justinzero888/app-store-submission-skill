import fs from 'node:fs';
import path from 'node:path';
import {
  gitSnapshot,
  normalizeProfile,
  parseArgs,
  resolveAppRoot,
  resolvePath,
  resolveProfile,
  writeJson,
} from './common.mjs';

const args = parseArgs(process.argv.slice(2));
const appRoot = resolveAppRoot(args);
const resolved = resolveProfile(args, appRoot);
const profile = normalizeProfile(resolved.value, resolved.path);
const version = args.version || profile.release?.discoveredVersion || '0.0.0';
const build = String(args.build || '1');
const channel = args.channel || profile.release?.defaultChannel || 'internal';
const output = path.resolve(args.out || path.join(appRoot, 'release-ops/generated'));
const git = gitSnapshot(appRoot);
fs.mkdirSync(output, { recursive: true });
const buildCommands = profile.buildCommands || (profile.app?.framework === 'flutter' ? {
  ios: `flutter build ipa --release --build-name=${version} --build-number=${build}`,
  android: `flutter build appbundle --release --build-name=${version} --build-number=${build}`,
} : { ios: null, android: null });
const packet = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  appRoot,
  profile: resolved.path,
  app: profile.app,
  release: { version, build, channel, commit: git.commit, dirty: git.dirty },
  artifacts: {
    iosIpa: profile.paths?.iosIpa ? resolvePath(appRoot, profile.paths.iosIpa) : null,
    androidAab: profile.paths?.androidAab ? resolvePath(appRoot, profile.paths.androidAab) : null,
  },
  validation: profile.validation?.commands || [],
  buildCommands,
  monetization: profile.monetization || {},
  humanGates: [
    'Confirm the target App Store Connect and Google Play app records and account ownership.',
    'Create/protect signing keys and confirm the release artifact is signed by the intended identity.',
    'Complete AdMob/app-ads.txt setup and privacy/consent declarations when advertising is enabled.',
    'Create and configure IAP products in every enabled store; test purchase and restore before activation.',
    'Install the internal/beta builds on physical devices and confirm the release smoke checklist.',
    'Upload, complete store forms, submit, and promote only after human confirmation of the exact account, track, and artifact.',
  ],
};
const lines = [
  `# ${profile.app?.displayName || 'App'} release packet`, '',
  `- Channel: ${channel}`, `- Version/build: ${version} (${build})`, `- Commit: ${git.commit || 'unknown'}`,
  `- Working tree: ${git.dirty ? 'DIRTY — do not upload' : 'clean'}`, `- Profile: ${resolved.path}`, '',
  '## Artifacts', '', `- iOS IPA: ${packet.artifacts.iosIpa || 'not configured'}`, `- Android AAB: ${packet.artifacts.androidAab || 'not configured'}`, '',
  '## Validation commands', '', ...packet.validation.map((command) => `- \`${command}\``), '',
  '## Build commands', '', `- iOS: ${packet.buildCommands.ios || 'not configured'}`, `- Android: ${packet.buildCommands.android || 'not configured'}`, '',
  '## Human gates', '', ...packet.humanGates.map((gate) => `- [ ] ${gate}`), '',
];
writeJson(path.join(output, `release-${version}-${build}.json`), packet);
fs.writeFileSync(path.join(output, `release-${version}-${build}.md`), `${lines.join('\n')}\n`);
console.log(`Wrote packet to ${output}`);
