# Release profile schema

The release profile is app-owned configuration. Keep it small, explicit, and free of secrets. Values that are unknown must be `null` or an empty list, not guessed.

> Preflight behavior notes:
> - AdMob `applicationIds`/`bannerUnitIds` are compared against Google's well-known
>   test prefix (`ca-app-pub-3940256099942544`) and **block the production channel**
>   if the app still points at test IDs.
> - iOS AdMob requires a **non-empty** `NSUserTrackingUsageDescription` string in
>   `Info.plist`; preflight fails if the key or its copy is missing.
> - Android release signing is accepted when the standard Flutter conditional fallback
>   (`if (keystorePropertiesFile.exists()) release else debug`) is present **and**
>   the keystore + `key.properties` actually exist; only an unconditional debug
>   signingConfig (or a fallback with missing key material) blocks production.
> - `paths.iosExportOptions` is **optional**: set it to the `ExportOptions.plist`
>   path only when the app manages its own export options. Leave it `null` for
>   `flutter build ipa` automatic signing; preflight then skips the export-options
>   file check.

```json
{
  "schemaVersion": 1,
  "app": {
    "displayName": "Example App",
    "framework": "flutter",
    "iosBundleId": "com.example.app",
    "androidApplicationId": "com.example.app",
    "supportUrl": "https://example.com/support",
    "privacyPolicyUrl": "https://example.com/privacy",
    "marketingUrl": "https://example.com"
  },
  "release": {
    "versionSource": "pubspec.yaml",
    "buildNumberPolicy": "one shared monotonically increasing integer",
    "defaultChannel": "internal"
  },
  "paths": {
    "pubspec": "pubspec.yaml",
    "iosInfo": "ios/Runner/Info.plist",
    "iosProject": "ios/Runner.xcodeproj/project.pbxproj",
    "iosExportOptions": "ios/ExportOptions.plist",
    "androidManifest": "android/app/src/main/AndroidManifest.xml",
    "androidGradle": "android/app/build.gradle.kts",
    "androidKeyProperties": "android/key.properties",
    "androidKeystore": "android/app/upload-keystore.jks",
    "iosIpa": "build/ios/ipa/app.ipa",
    "androidAab": "build/app/outputs/bundle/release/app-release.aab"
  },
  "signing": {
    "android": {
      "keyAlias": "upload-key-alias",
      "secretKeys": ["storePassword", "keyPassword"]
    },
    "ios": {
      "teamId": "TEAMID",
      "exportMethod": "app-store"
    }
  },
  "store": {
    "appleAppId": "id6782447247",
    "playPackageName": "com.example.app",
    "urls": {
      "ios": "https://apps.apple.com/us/app/example/id6782447247",
      "android": "https://play.google.com/store/apps/details?id=com.example.app"
    }
  },
  "monetization": {
    "admob": {
      "enabled": false,
      "applicationIds": {"ios": null, "android": null},
      "bannerUnitIds": {"ios": null, "android": null},
      "testBannerUnitId": null,
      "gameplayAds": "disabled",
      "noFillFallback": "test unit per request, retry production on next request",
      "appAdsTxt": {"publisherLine": null, "host": null}
    },
    "iap": {
      "enabled": false,
      "products": []
    }
  },  "validation": {
    "commands": [],
    "requiresCleanTreeForProduction": true
  },
  "buildCommands": {
    "ios": null,
    "android": null
  }
}
```

IAP product entries use:

```json
{
  "productId": "com.example.app.remove_ads",
  "kind": "non_consumable",
  "entitlements": ["ads_removed"],
  "status": "planned",
  "platforms": ["ios", "android"]
}
```

`kind` is one of `consumable`, `non_consumable`, or `subscription`. Subscriptions carry an
extra `subscription` object:

```json
{
  "productId": "com.example.app.premium",
  "kind": "subscription",
  "entitlements": ["ads_removed", "premium"],
  "status": "planned",
  "platforms": ["ios", "android"],
  "subscription": {
    "duration": "1m",
    "iosGroup": "premium",
    "androidBasePlanId": "premium_monthly"
  }
}
```

- `duration`: `1w`, `1m`, `3m`, `6m`, `1y`.
- `iosGroup`: App Store Connect subscription group id (all auto-renewable tiers for the same
  product must share a group).
- `androidBasePlanId`: Google Play base plan id; purchase option (offer) ids use hyphens, never
  underscores.

A single subscription product may gate multiple entitlements (e.g. `ads_removed` + `premium`),
so `entitlements` is a list. Legacy `entitlement` (singular string) is still accepted and
normalized to `[entitlement]`.

Use `planned`, `active`, or `retired`. `--iap-enabled` must reject any non-`active` product.

### Store records (multi-app / v1+v2)

The `store` block declares the *store-record* identifiers — the Apple App ID (with `id` prefix)
and the Play package name that the app is published under. This lets one machine hold profiles
for several apps (e.g. a live v1 and an unreleased v2) and preflight detects **store-record
drift**: a profile whose `store.playPackageName` disagrees with `app.androidApplicationId`, or
store URLs that point at a different app's listing, is flagged so a release is never pushed to
the wrong store record.
