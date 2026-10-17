import { Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface PluginSettings {
	includeFolders: string[];
	useHeader: boolean;
	useFirstLine: boolean;
	isTitleHidden: boolean;
	supportYAML: boolean;
	includeEmojis: boolean;
	charCount: number;
	checkInterval: number;
	illegalCharReplacement: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	includeFolders: [],
	useHeader: true,
	useFirstLine: false,
	isTitleHidden: true,
	supportYAML: true,
	includeEmojis: true,
	charCount: 50,
	checkInterval: 500,
	illegalCharReplacement: " ",
};

// Global variables for "Rename all files" setting
let renamedFileCount = 0;
let tempNewPaths: string[] = [];

// Variables for debounce
let onTimeout = true;
let timeout: number;
let previousFile: string;

function normalizeFolderEntry(entry: string): string {
	// Strip Windows carriage returns / surrounding whitespace, drop trailing
	// slashes (except root "/"), and NFC-normalize so non-ASCII names
	// (e.g. Chinese) compare equal regardless of OS normalization.
	let folder = entry.replace(/\r/g, "").trim();
	if (folder.length > 1) folder = folder.replace(/\/+$/, "");
	return folder.normalize("NFC");
}

function inTargetFolder(file: TFile, settings: PluginSettings): boolean {
	if (settings.includeFolders.length === 0) return false; // False if user has no target folder selected

	const filePath = file.parent?.path;
	if (!filePath) return false;
	const normPath = filePath.normalize("NFC");

	for (const rawFolder of settings.includeFolders) {
		const folder = normalizeFolderEntry(rawFolder);
		if (!folder) continue;

		// Support "**" to match all folders in the vault
		if (folder === "**") {
			return true;
		}
		// Support recursive matching with POSIX-style "/**" suffix
		// e.g. "Notes/**" matches "Notes" and all nested subfolders
		// (including non-ASCII ones like "temp/**" covering "temp/\u811a\u672c")
		if (folder.endsWith("/**")) {
			const baseFolder = folder
				.slice(0, -3) // Remove "/**"
				.replace(/\/+$/, "")
				.normalize("NFC");
			// Match the base folder itself or any subfolder
			if (
				normPath === baseFolder ||
				normPath.startsWith(baseFolder + "/")
			) {
				return true;
			}
		} else {
			// Exact match (original behavior)
			if (normPath === folder) {
				return true;
			}
		}
	}

	return false; // False if all checks fail
}

// Frontmatter keys that opt an individual file out of auto-rename.
// Usage in a note's Properties / frontmatter:
// ---
// auto-filename-ignore: true
// ---
const IGNORE_KEYS = ["auto-filename-ignore", "auto_filename_ignore"];
const OPT_OUT_KEYS = ["auto-filename", "auto_filename"];
const OPT_OUT_VALUES = new Set([
	"ignore",
	"ignored",
	"disable",
	"disabled",
	"off",
	"false",
	"no",
	"0",
]);

function isOptedOut(
	frontmatter: Record<string, unknown> | undefined,
): boolean {
	if (!frontmatter) return false;

	for (const key of IGNORE_KEYS) {
		const value = frontmatter[key];
		if (value === true) return true;
		if (typeof value === "number" && value !== 0) return true;
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (
				normalized !== "" &&
				!OPT_OUT_VALUES.has(normalized)
			) {
				// e.g. "true", "yes", "1" (anything truthy)
				return true;
			}
		}
	}

	for (const key of OPT_OUT_KEYS) {
		const value = frontmatter[key];
		if (value === false) return true;
		if (typeof value === "string") {
			const normalized = value
				.trim()
				.toLowerCase()
				.replace(/^["']|["']$/g, "");
			if (OPT_OUT_VALUES.has(normalized)) return true;
		}
	}

	return false;
}

// Fallback parser for when metadataCache isn't ready yet (e.g. right after
// typing frontmatter). Operates on the raw file content.
function hasIgnoreFlagInContent(content: string): boolean {
	if (!content.startsWith("---")) return false;
	const end = content.indexOf("---", 3);
	if (end === -1) return false;
	const yaml = content.slice(3, end);

	if (/auto[-_]filename[-_]ignore\s*:\s*(true|yes|1)\b/i.test(yaml))
		return true;

	const match = yaml.match(/auto[-_]filename\s*:\s*([^\n#]+)/i);
	if (match) {
		const normalized = match[1]
			.trim()
			.toLowerCase()
			.replace(/^["']|["']$/g, "");
		if (OPT_OUT_VALUES.has(normalized)) return true;
	}

	return false;
}

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	// Function for renaming files
	async renameFile(file: TFile, noDelay = false): Promise<void> {
		// Only process markdown notes. Skips Canvas (.canvas), images,
		// audio/video, PDFs, and other non-markdown files so their content
		// (e.g. Canvas JSON starting with "{") is never used as a filename
		// and they are never converted to .md.
		if (file.extension !== "md") return;

		if (!inTargetFolder(file, this.settings)) return; // Return if file is not within the target folder/s

		// Per-file opt-out via frontmatter cache (fast path, no IO).
		// Allows manually-renamed files to be excluded with:
		// ---
		// auto-filename-ignore: true
		// ---
		try {
			const frontmatter = this.app.metadataCache.getFileCache(file)
				?.frontmatter as Record<string, unknown> | undefined;
			if (isOptedOut(frontmatter)) return;
		} catch {
			// Ignore cache errors and fall through to content check below.
		}

		// Debounce to avoid performance issues if noDelay is disabled or checkInterval is 0
		if (noDelay === false) {
			if (onTimeout) {
				// Clear timeout only if renameFile is called on the same file.
				if (previousFile == file.path) {
					activeWindow.clearTimeout(timeout);
				}

				previousFile = file.path;

				timeout = activeWindow.setTimeout(() => {
					onTimeout = false;
					void this.renameFile(file);
				}, this.settings.checkInterval);

				return;
			}

			onTimeout = true;
		}

		let content: string = await this.app.vault.cachedRead(file);

		// Per-file opt-out via raw frontmatter (fallback when cache is stale).
		// This also covers the "Rename all files" bulk action since it
		// routes through this same function.
		if (hasIgnoreFlagInContent(content)) return;

		// Supports YAML depending on user preference
		if (this.settings.supportYAML && content.startsWith("---")) {
			const index = content.indexOf("---", 3); // returns -1 if none
			if (index != -1) content = content.slice(index + 3).trimStart(); // Add 3 to cover "---" || Cleanup white spaces and newlines at start
		}

		// Defer rename while unresolved Templater tags (e.g. `<% tp.file.cursor(1) %>`)
		// are still in the filename-relevant portion. Templater replaces them on
		// execution (which fires another modify/create event), so renaming now would
		// briefly produce garbage like "<% tp.file.cursor(1) %>" or "Untitled".
		// Frontmatter Templater dates are already stripped above, so only body tags matter.
		{
			let relevant = content.slice(0, Number(this.settings.charCount));
			if (this.settings.useFirstLine) {
				const nl = relevant.indexOf("\n");
				if (nl !== -1) relevant = relevant.slice(0, nl);
			}
			if (
				relevant.includes("<%") &&
				/<%[\s\S]*?%>/.test(content)
			)
				return;
		}

		// Use the header as filename depending on user preference
		if (this.settings.useHeader && content[0] == "#") {
			const headerArr: string[] = [
				"# ",
				"## ",
				"### ",
				"#### ",
				"##### ",
				"###### ",
			];
			for (let i = 0; i < headerArr.length; i++) {
				if (content.startsWith(headerArr[i])) {
					const index = content.indexOf("\n");
					if (index != -1) content = content.slice(i + 2, index);
					break;
				}
			}
		}

		const illegalChars = '\\/:*?"<>|#^[]'; // Characters that should be avoided in filenames
		const illegalNames: string[] = [
			"CON",
			"PRN",
			"AUX",
			"NUL",
			"COM1",
			"COM2",
			"COM3",
			"COM4",
			"COM5",
			"COM6",
			"COM7",
			"COM8",
			"COM9",
			"COM0",
			"LPT1",
			"LPT2",
			"LPT3",
			"LPT4",
			"LPT5",
			"LPT6",
			"LPT7",
			"LPT8",
			"LPT9",
			"LPT0",
		]; // Special filenames that are illegal in some OSs
		let newFileName = "";

		// Takes the first n characters of the file and uses it as part of the filename.
		for (let i = 0; i < content.length; i++) {
			// Adds "..." after the last character if file characters > n
			if (i >= Number(this.settings.charCount)) {
				newFileName = newFileName.trimEnd();
				newFileName += "...";
				break;
			}
			const char = content[i];

			if (char === "\n") {
				// Ignore succeeding lines of text when determining filename depending on user preference.
				if (this.settings.useFirstLine) {
					newFileName = newFileName.trimEnd();
					newFileName += "..."; // Adds "..." at the end to indicate there might be more text.
					break;
				}
			}

			// Replace illegal characters in filenames with the user-configured
			// replacement (default: space) instead of deleting them, so
			// e.g. "3/7/9" becomes "3 7 9" instead of "379".
			// An empty replacement preserves the old strip behavior.
				if (!illegalChars.includes(char)) {
					newFileName += char;
				} else {
					newFileName += this.settings.illegalCharReplacement ?? " ";
				}
		}

		// Remove emojis as set by user
		if (!this.settings.includeEmojis) {
			newFileName = newFileName.replace(
				/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
				"",
			);
		}

		newFileName = newFileName
			.trim() // Trim white spaces
			.replace(/\s+/g, " "); // Replace consecutive whitespace characters with a space

		// Remove all leading "." to avoid naming issues.
		while (newFileName[0] == ".") {
			newFileName = newFileName.slice(1);
		}

		// Change to Untitled if newFileName outputs to nothing, or if it matches any of the illegal names.
		const isIllegalName =
			newFileName === "" ||
			illegalNames.includes(newFileName.toUpperCase());
		if (isIllegalName) newFileName = "Untitled";

		const parentPath =
			file.parent?.path === "/" ? "" : file.parent?.path + "/";

		let newPath = `${parentPath}${newFileName}.md`;

		// Duplicate checker: If file exists or newPath is in tempNewPaths, enter loop.
		let counter = 1;
		let fileExists: boolean =
			this.app.vault.getAbstractFileByPath(newPath) != null;
		while (fileExists || tempNewPaths.includes(newPath)) {
			if (file.path == newPath) return; // No need to rename if new filename == old filename
			counter += 1;
			newPath = `${parentPath}${newFileName} (${counter}).md`; // Adds (2), (3), (...) to avoid filename duplicates similar to windows.
			fileExists = this.app.vault.getAbstractFileByPath(newPath) != null;
		}

		// Populate tempNewPaths if noDelay is enabled to avoid duplicate bugs
		if (noDelay) {
			tempNewPaths.push(newPath);
		}

		// Rename file and increment renamedFileCount
		await this.app.fileManager.renameFile(file, newPath);
		renamedFileCount += 1;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AutoFilenameSettings(this.app, this));

		// Triggers when vault is modified such as when editing files.
		// This is what triggers to rename the file
		this.registerEvent(
			this.app.vault.on("modify", (abstractFile) => {
				if (abstractFile instanceof TFile) {
					const noDelay = this.settings.checkInterval === 0; // enable noDelay if checkInterval is 0
					void this.renameFile(abstractFile, noDelay);
				}
			}),
		);

		// Triggers when a file is moved/renamed into a watched folder.
		// Without this, moved files keep their old name until next edit.
		// Self-triggered renames are safe: renameFile() no-ops when the
		// computed name already matches the current path.
		this.registerEvent(
			this.app.vault.on("rename", (abstractFile) => {
				if (abstractFile instanceof TFile) {
					const noDelay = this.settings.checkInterval === 0;
					void this.renameFile(abstractFile, noDelay);
				}
			}),
		);

		// Triggers when a file is created/copied into a watched folder
		// (e.g. copy-paste in the explorer, Note Composer extract).
		this.registerEvent(
			this.app.vault.on("create", (abstractFile) => {
				if (abstractFile instanceof TFile) {
					const noDelay = this.settings.checkInterval === 0;
					void this.renameFile(abstractFile, noDelay);
				}
			}),
		);

		// Triggers when a file is opened.
		// Used for "Hide inline title for target folder" setting.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				if (!activeDocument.body.classList.contains("show-inline-title"))
					return;

				const shouldHide =
					this.settings.isTitleHidden &&
					inTargetFolder(file, this.settings);

				const target = activeDocument
					.querySelector(".workspace-leaf.mod-active")
					?.querySelector(".inline-title");
				if (!target) return;
				const customCss = "hide-inline-title";
				if (shouldHide && !target.classList.contains(customCss)) {
					target.classList.add(customCss);
				}
				if (!shouldHide && target.classList.contains(customCss)) {
					target.classList.remove(customCss);
				}
			}),
		);
	}
}

class AutoFilenameSettings extends PluginSettingTab {
	plugin: AutoFilename;

	display(): void {
		this.containerEl.empty();

		// Setting 1
		new Setting(this.containerEl)
			.setName("Include")
			.setDesc(
				"Folder paths where Auto Filename would auto rename files. Separate by new line. Case sensitive. Use ** for all folders, or folder/** for recursive matching.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("**\nfolder\nfolder/**")
					.setValue(this.plugin.settings.includeFolders.join("\n"))
					.onChange(async (value) => {
						// Split on \r?\n (Windows), trim, and drop empty lines so
						// entries like "temp/\u811a\u672c\r" still match.
						this.plugin.settings.includeFolders = value
							.split(/\r?\n/)
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					});
				text.inputEl.cols = 28;
				text.inputEl.rows = 4;
			});

		// Setting 2
		new Setting(this.containerEl)
			.setName("Use the header as filename")
			.setDesc(
				"Use the header as filename if the file starts with a header",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useHeader)
					.onChange(async (value) => {
						this.plugin.settings.useHeader = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 3
		new Setting(this.containerEl)
			.setName("Only use the first line")
			.setDesc(
				"Ignore succeeding lines of text when determining filename.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useFirstLine)
					.onChange(async (value) => {
						this.plugin.settings.useFirstLine = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 4
		const shouldDisable =
			!activeDocument.body.classList.contains("show-inline-title");
		const description: string = shouldDisable
			? 'Enable "Appearance > Interface > Show inline title" in options to use this setting.'
			: 'Override "Appearance > Interface > Show inline title" for files on the target folder.';
		const hideTitleSetting = new Setting(this.containerEl)
			.setName("Hide inline title for target folder")
			.setDesc(description)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.isTitleHidden)
					.onChange(async (value) => {
						this.plugin.settings.isTitleHidden = value;
						await this.plugin.saveSettings();
					});
			});
		// Disable this setting if the obsidian setting "Show inline title" is disabled.
		// NOTE: `Setting.setDisabled` requires Obsidian 1.2.3+, but minAppVersion
		// is 0.15.0, so apply the disabled state manually with long-available
		// APIs (`settingEl` / `controlEl`) instead.
		hideTitleSetting.settingEl.toggleClass(
			"auto-filename-disabled",
			shouldDisable,
		);
		hideTitleSetting.settingEl.toggleClass(
			"auto-filename-enabled",
			!shouldDisable,
		);
		const hideTitleInput =
			hideTitleSetting.controlEl.getElementsByTagName("input")[0];
		if (hideTitleInput) hideTitleInput.disabled = shouldDisable;

		// Setting 5
		new Setting(this.containerEl)
			.setName("YAML support")
			.setDesc("Enables YAML support.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.supportYAML)
					.onChange(async (value) => {
						this.plugin.settings.supportYAML = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 6
		new Setting(this.containerEl)
			.setName("Include Emojis")
			.setDesc("Include Emojis in the filename.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.includeEmojis)
					.onChange(async (value) => {
						this.plugin.settings.includeEmojis = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 7
		new Setting(this.containerEl)
			.setName("Character count")
			.setDesc(
				"Auto Filename will use the first x number of characters in file as filename.",
			)
			.addText((text) =>
				text
					.setPlaceholder(
						`10-100 (Default: ${DEFAULT_SETTINGS.charCount})`,
					)
					.setValue(String(this.plugin.settings.charCount))
					.onChange(async (value) => {
						const numVal = Number(value);
						if (numVal >= 10 && numVal <= 100) {
							this.plugin.settings.charCount = numVal;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Setting 8
		new Setting(this.containerEl)
			.setName("Check interval")
			.setDesc(
				"Interval in milliseconds of how often to rename files while editing. Increase if there's performance issues.",
			)
			.addText((text) =>
				text
					.setPlaceholder(
						`Default: ${DEFAULT_SETTINGS.checkInterval}`,
					)
					.setValue(String(this.plugin.settings.checkInterval))
					.onChange(async (value) => {
						if (!isNaN(Number(value))) {
							this.plugin.settings.checkInterval = Number(value);
							await this.plugin.saveSettings();
						}
					}),
			);

		// Setting 9
		new Setting(this.containerEl)
			.setName("Illegal character replacement")
			.setDesc(
				"Character(s) to replace illegal filename characters (\\ / : * ? \" < > | # ^ [ ]) with. Leave empty to delete them.",
			)
			.addText((text) =>
				text
					.setPlaceholder(`Default: "${DEFAULT_SETTINGS.illegalCharReplacement}" (space)`)
					.setValue(this.plugin.settings.illegalCharReplacement ?? " ")
					.onChange(async (value) => {
						// Sanitize: strip any illegal chars from the replacement itself
						// so it can't reintroduce an invalid filename.
						const illegalChars = '\\/:*?"<>|#^[]';
						let sanitized = "";
						for (const c of value) {
							if (!illegalChars.includes(c)) sanitized += c;
						}
						// Allow empty (strip mode) or any safe string.
						// Lone dots are trimmed later, so they are safe to keep.
						this.plugin.settings.illegalCharReplacement = sanitized;
						await this.plugin.saveSettings();
					}),
			);

		// Setting 10
		new Setting(this.containerEl)
			.setName("Ignore individual files")
			.setDesc(
				"Add `auto-filename-ignore: true` to a note's frontmatter (Properties) to prevent Auto Filename from renaming that file. Also accepts `auto-filename: ignore` in frontmatter. Applies to automatic renames and \"Rename all files\".",
			);

		// Setting 11
		new Setting(this.containerEl)
			.setName("Rename all files")
			.setDesc(
				"Force rename all files on the target folder. Warning: To be safe, make sure you backup before proceeding.",
			)
			.addButton((button) =>
				button.setButtonText("Rename").onClick(async () => {
					const filesToRename: TFile[] = [];
					this.app.vault.getMarkdownFiles().forEach((file) => {
						if (inTargetFolder(file, this.plugin.settings)) {
							filesToRename.push(file);
						}
					});

					new Notice(`Renaming files, please wait...`);

					renamedFileCount = 0;
					tempNewPaths = [];
					await Promise.all(
						filesToRename.map((file: TFile) =>
							this.plugin.renameFile(file, true),
						),
					);
					new Notice(
						`Renamed ${renamedFileCount}/${filesToRename.length} files.`,
					);
				}),
			);
	}
}
