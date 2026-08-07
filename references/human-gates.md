# Human gates

The skill can inspect local evidence and prepare actions. It cannot safely replace ownership, legal, credential, or approval decisions.

| Gate | Human action | Skill action |
|---|---|---|
| Store identity | Confirm the existing App Store/Play records and account ownership | Compare identifiers and report drift |
| Signing | Create/back up Apple signing access and Android upload key; protect passwords | Check paths, aliases, and debug-signing fallback |
| AdMob | Create/link app and units, verify publisher ownership, publish `app-ads.txt` | Validate IDs and explain runtime no-fill behavior |
| IAP | Create products, prices, availability, review metadata, and support path | Validate catalog and lifecycle state |
| Compliance | Answer privacy, data safety, age-rating, export, and advertising declarations | Produce a binary-specific checklist |
| Device QA | Install store-delivered builds and test permissions, ads, purchase, restore, and persistence | Record the requested evidence and stop on missing confirmation |
| Submission | Upload, submit, and promote the exact artifact in the intended account/track | Generate the packet and require explicit confirmation |

Ask for human input only when local evidence cannot resolve the choice. Ask one focused question at a time, showing the exact value or action that needs confirmation.

Never ask the human to paste passwords, private keys, API secrets, or MFA codes into chat. Ask them to configure the environment or complete the console action and report the result.
