const fs = require("fs");
const path = require("path");

// The release/ directory is gitignored, so it does not exist in a fresh
// clone. Create it first so the copies below don't fail with ENOENT.
fs.mkdirSync("./release", { recursive: true });

for (const [src, dest] of [
	["main.js", "./release/main.js"],
	["./src/styles.css", "./release/styles.css"],
	["manifest.json", "./release/manifest.json"],
]) {
	fs.copyFileSync(src, dest);
	console.log(`${path.basename(dest)} updated successfully!`);
}
