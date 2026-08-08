---
name: app-store-submission-skill
description: App-agnostic release preparation for iOS App Store and Google Play submissions. Use when Codex needs to inspect a mobile app, discover or validate store identifiers and signing configuration, prepare AdMob or IAP release gates, run release preflight, verify IPA/AAB artifacts, generate a submission packet, or identify the exact human actions still required before upload or review.
---

# App store submission

Use this skill to turn a mobile app repository into a traceable, human-approved release candidate. Treat the app repository's release profile as the source of app-specific truth; never invent bundle IDs, product IDs, ad IDs, team IDs, key paths, prices, or store metadata.

## Operating modes

Choose the smallest mode that satisfies the request:

- **Discover**: inspect the repository and create a profile draft with unknowns clearly marked.
- **Preflight**: run read-only consistency checks and report blockers, warnings, and human actions.
- **Build packet**: generate exact validation/build commands, artifact paths, provenance, and manual handoffs.
- **Verify artifacts**: inspect IPA/AAB metadata and signatures after the app build exists.
- **Guided submission**: pause at every credential, store-console, irreversible upload, purchase, or review decision and ask the human to complete/confirm it.

Do not upload, submit, promote, create store products, rotate keys, or change prices without explicit human confirmation immediately before the action.

## Profile discovery

First look for an app profile at `release-ops/release-profile.json`, then `release-ops/release-config.json`. Accept an explicit `--profile` when the app uses another path. If no profile exists, run the bundled discovery script and write a draft outside the app repository or to a human-approved path:

```sh
node <skill>/scripts/discover-profile.mjs \
  --app-root /path/to/app \
  --out /tmp/release-profile.json
```

Review every `null`, warning, and inferred value with the human. Discovery is evidence gathering, not authorization.

The profile should contain:

- App display name, framework, iOS bundle ID, Android application ID, and version source.
- Artifact paths and validation commands.
- Android key-properties/keystore paths and alias; never passwords or private keys.
- iOS team/export configuration references; never signing certificates or credentials.
- Store-record identifiers (`store.appleAppId`, `store.playPackageName`, store URLs) used to detect drift between the build identifiers and the live store listing — essential when the same repo builds both a live v1 and an unreleased v2 app.
- Optional AdMob application IDs, banner units, test units, consent/ATT rules, and app-ads.txt host.
- Optional IAP products, entitlement names, platform coverage, and lifecycle status.
- Store metadata URLs and a human handoff list.

Use [`references/profile-schema.md`](references/profile-schema.md) for the schema and [`references/human-gates.md`](references/human-gates.md) for the ownership boundary.

## Standard workflow

1. Resolve the profile and app root. Confirm the target is an app update rather than a new store app.
2. Capture git commit and working-tree state. Require a clean commit for production unless the human explicitly accepts a beta exception.
3. Run profile and repository preflight:

   ```sh
   node <skill>/scripts/release-preflight.mjs \
     --app-root /path/to/app \
     --profile /path/to/release-profile.json \
     --channel beta \
     --version 2.0.0 \
     --build 1
   ```

4. Run the app's configured validation commands. Do not claim they passed if a command was skipped or unavailable.
5. Build both platform artifacts from the same commit and shared build number, using the profile's commands.
6. Verify IPA/AAB metadata and signing:

   ```sh
   node <skill>/scripts/verify-artifacts.mjs \
     --app-root /path/to/app \
     --profile /path/to/release-profile.json \
     --version 2.0.0 \
     --build 1
   ```

7. Generate a release packet with artifact paths, provenance, checks, AdMob/IAP status, and manual handoffs:

   ```sh
   node <skill>/scripts/generate-packet.mjs \
     --app-root /path/to/app \
     --profile /path/to/release-profile.json \
     --version 2.0.0 \
     --build 1 \
     --out /tmp/release-packet
   ```

8. Have the human install the store-delivered internal/beta builds on physical devices. Cover first launch, permissions/consent, gameplay, persistence, ads, and IAP restore if enabled.
9. Present the remaining human gates. Stop before upload, submission, promotion, product activation, or price changes until the human confirms the exact target app, account, artifact, track, and action.

## Monetization gates

### AdMob

If AdMob is enabled:

- Debug uses Google test units; release tries the platform production unit first.
- Preflight blocks the production channel if `applicationIds`/`bannerUnitIds` still use Google's test prefix (`ca-app-pub-3940256099942544`) and fails if iOS `NSUserTrackingUsageDescription` is missing or empty.
- A production no-fill may use a Google test creative for that request, then a fresh request retries production. This lets one binary transition from pre-approval/no-fill to live fill without rebuilding.
- UMP consent and iOS ATT must complete before ad requests. Active gameplay must remain ad-free if the profile says so.
- The human creates/links AdMob app and ad units, owns the publisher account, publishes `app-ads.txt`, and aligns the verified website URL across stores.
- Never treat a test fallback as evidence that production monetization is live. Never click ads during testing.

### IAP

If IAP is enabled:

- Use product IDs only from the profile; never hardcode a new ID in UI code.
- Products support `consumable`, `non_consumable`, and `subscription` kinds. Subscriptions must declare a duration, an App Store Connect subscription group (`iosGroup`), and a Google Play base plan (`androidBasePlanId`); all auto-renewable tiers of one product share a group.
- One product can gate several entitlements (e.g. `ads_removed` + `premium`); list them in `entitlements`. Keep products `planned` until both stores, implementation, restore, and physical-device tests are complete; preflight rejects non-`active` products under `--iap-enabled`.
- Human creates products, prices, availability, review metadata, and support paths in each store.
- The app must handle unavailable, pending, cancelled, failed, purchased, restored, and already-owned states.
- Verify the transaction, finish/acknowledge it, and recompute entitlements on app start and restore. A local entitlement cache is not proof of ownership.
- Keep the app usable when stores are unavailable. Do not tie competition fairness or ranked eligibility to purchase ownership.

## Signing and safety

- Never copy secrets into the profile, packet, skill directory, or source control.
- Require Android release signing material and reject release configurations that fall back to the debug key.
- Treat Apple signing access, App Store Connect API keys, Play service credentials, MFA, and store uploads as human-controlled.
- Treat store metadata, pricing, legal answers, and review notes as human-owned declarations.
- Report missing tools such as Flutter, Xcode, Java, `bundletool`, or `jarsigner` separately from app failures.

## Result format

End every run with:

1. **Status**: pass, blocked, or needs human action.
2. **Evidence**: commit, version/build, commands run, artifacts checked, and warnings.
3. **Human actions**: exact console, credential, key, device, purchase, or approval steps.
4. **Next safe command**: the next read-only or reversible action.

Do not report a store submission as complete merely because local artifacts built successfully.
