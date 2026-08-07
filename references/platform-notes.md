# Platform notes

Keep current policy and SDK details out of the core skill. Before giving current platform-specific advice, consult authoritative Apple, Google Play, Google AdMob, and framework documentation.

Stable workflow principles:

- Build iOS IPA and Android AAB from one committed source checkpoint and shared build number.
- Verify signed release behavior, not only debug behavior.
- Keep production AdMob IDs separate from test IDs and use runtime no-fill fallback only as a QA continuity mechanism.
- Request ATT before iOS ad requests and gate ad requests on consent state.
- Keep digital goods on the platform billing system and restore non-consumables.
- Treat store website URLs and `app-ads.txt` hosting as one ownership chain.
