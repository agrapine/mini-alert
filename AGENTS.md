# Preferences
Skip testing yourself in the browser, I'll validate myself.

Record major features / changes in the cha changelog.md under a "current" release (add one at top if doesn't exist yet).

Prefer using shared code for services that need to happen both server side and client side. Especially considering the network pushes minimal updates and both server and client will continue simulating under the same rules. E.g. unit moving every tick is calculated by both server/client and occasional snapshots only adjust items.

Bump MAP_VERSION when making changes to game structure (save game). No need to provide legacy / import.

# Runtime performance
## Prefer int values over strings for enums
Use `const enums`. JS will be much faster with ints.


