const fs = require("fs");

fs.mkdir("./release", { recursive: true }, (err) => {
	if (err) throw err;
	console.log("created release folder!");
});

fs.copyFile("main.js", "./release/main.js", (err) => {
	if (err) throw err;
	console.log("main.js updated successfully!");
});

fs.copyFile("./src/styles.css", "./release/styles.css", (err) => {
	if (err) throw err;
	console.log("style.css updated successfully!");
});

fs.copyFile("manifest.json", "./release/manifest.json", (err) => {
	if (err) throw err;
	console.log("manifest.json updated successfully!");
});
