const fs = require("fs");

fs.copyFile("main.js", "./obsidian-auto-filename/main.js", (err) => {
	if (err) throw err;
	console.log("main.js updated successfully!");
});

fs.copyFile(
	"manifest.json",
	"./obsidian-auto-filename/manifest.json",
	(err) => {
		if (err) throw err;
		console.log("manifest.json updated successfully!");
	}
);
