// Placeholder: download and unpack Trino server + JRE into resources/.
// This is intentionally left manual to avoid network access in CI by default.
// Expected layout:
// - resources/trino/bin/launcher (or launcher.bat on Windows)
// - resources/trino/lib/trino-server-<version>.jar
// - resources/jre/bin/java
console.log('Populate resources/trino and resources/jre with Trino + JRE before packaging.');
