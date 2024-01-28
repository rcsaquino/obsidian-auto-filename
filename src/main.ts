import { Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface PluginSettings {
	targetFolder: string;
	includeSubfolder: boolean;
	useHeader: boolean;
	useFirstLine: boolean;
	isTitleHidden: boolean;
	supportYAML: boolean;
	charCount: number;
	checkInterval: number;
}

const DEFAULT_SETTINGS: PluginSettings = {
	targetFolder: "",
	includeSubfolder: false,
	useHeader: true,
	useFirstLine: false,
	isTitleHidden: true,
	supportYAML: true,
	charCount: 50,
	checkInterval: 500,
};

// Global variables for "Rename all files" setting
let renamedFileCount: number = 0;
let tempNewPaths: string[] = [];

// Variables for debounce
let onTimeout: boolean = true;
let timeout: NodeJS.Timeout;
let previousFile: string;

function inTargetFolder(file: TFile, settings: PluginSettings): boolean {
	if (settings.targetFolder === "") return false; // False if user has no target folder selected

	if (settings.includeSubfolder) {
		// Eveything is within root so return true
		if (settings.targetFolder === "/") return true;

		// True if file is in user's target folder or its subfolders
		if (file.parent?.path.split("/")[0] === settings.targetFolder)
			return true;

		// True only if file is in user's target folder excluding subfolders
	} else if (file.parent?.path === settings.targetFolder) return true;

	return false; // False if all checks fails
}

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	// Function for renaming files
	async renameFile(file: TFile, noDelay = false): Promise<void> {
		if (!inTargetFolder(file, this.settings)) return; // Return if file is not within the target folder/s

		// Debounce to avoid performance issues if noDelay is disabled or checkInterval is 0
		if (noDelay === false) {
			if (onTimeout) {
				// Clear timeout only if renameFile is called on the same file.
				if (previousFile == file.path) {
					clearTimeout(timeout);
				}

				previousFile = file.path;

				timeout = setTimeout(() => {
					onTimeout = false;
					this.renameFile(file);
				}, this.settings.checkInterval);

				return;
			}

			onTimeout = true;
		}

		let content: string = await this.app.vault.cachedRead(file);

		// Supports YAML depending on user preference
		if (this.settings.supportYAML && content.startsWith("---")) {
			let index = content.indexOf("---", 3); // returns -1 if none
			if (index != -1) content = content.slice(index + 3).trimStart(); // Add 3 to cover "---" || Cleanup white spaces and newlines at start
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
					let index = content.indexOf("\n");
					if (index != -1) content = content.slice(i + 2, index);
					break;
				}
			}
		}

		const illegalChars: string = '\\/:*?"<>|#^[]'; // Characters that should be avoided in filenames
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
		let newFileName: string = "";

		// Takes the first n characters of the file and uses it as part of the filename.
		for (let i: number = 0; i < content.length; i++) {
			// Adds "..." after the last character if file characters > n
			if (i >= Number(this.settings.charCount)) {
				newFileName = newFileName.trimEnd();
				newFileName += "...";
				break;
			}
			let char = content[i];

			if (char === "\n") {
				// Ignore succeeding lines of text when determining filename depending on user preference.
				if (this.settings.useFirstLine) {
					newFileName = newFileName.trimEnd();
					newFileName += "..."; // Adds "..." at the end to indicate there might be more text.
					break;
				}
			}

			// Avoid illegal characters in filenames
			if (!illegalChars.includes(char)) newFileName += char;
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

		let newPath: string = `${file.parent?.path}/${newFileName}.md`;

		// Duplicate checker: If file exists or newPath is in tempNewPaths, enter loop.
		let counter: number = 1;
		let fileExists: boolean =
			this.app.vault.getAbstractFileByPath(newPath) != null;
		while (fileExists || tempNewPaths.includes(newPath)) {
			if (file.path == newPath) return; // No need to rename if new filename == old filename
			counter += 1;
			newPath = `${file.parent?.path}/${newFileName} (${counter}).md`; // Adds (2), (3), (...) to avoid filename duplicates similar to windows.
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
			await this.loadData()
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
					this.renameFile(abstractFile, noDelay);
				}
			})
		);

		// Triggers when a file is opened.
		// Used for "Hide inline title for target folder" setting.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				if (!document.body.classList.contains("show-inline-title"))
					return;

				let shouldHide =
					this.settings.isTitleHidden &&
					inTargetFolder(file, this.settings);

				const target = document
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
			})
		);
	}
}

class AutoFilenameSettings extends PluginSettingTab {
	plugin: AutoFilename;

	display(): void {
		this.containerEl.empty();

		// Setting 1
		new Setting(this.containerEl)
			.setName("Target folder")
			.setDesc(
				"Target folder path where the Auto Filename would auto rename files."
			)
			.addText((text) =>
				text
					.setPlaceholder("folder/path/here")
					.setValue(this.plugin.settings.targetFolder)
					.onChange(async (value) => {
						this.plugin.settings.targetFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Setting 2
		new Setting(this.containerEl)
			.setName("Include subfolder")
			.setDesc("Also target files in subfolders of target folder.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.includeSubfolder)
					.onChange(async (value) => {
						this.plugin.settings.includeSubfolder = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 3
		new Setting(this.containerEl)
			.setName("Use the header as filename")
			.setDesc(
				"Use the header as filename if the file starts with a header"
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useHeader)
					.onChange(async (value) => {
						this.plugin.settings.useHeader = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 4
		new Setting(this.containerEl)
			.setName("Only use the first line")
			.setDesc(
				"Ignore succeeding lines of text when determining filename."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useFirstLine)
					.onChange(async (value) => {
						this.plugin.settings.useFirstLine = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 5
		const shouldDisable: boolean =
			!document.body.classList.contains("show-inline-title");
		const description: string = shouldDisable
			? 'Enable "Appearance > Interface > Show inline title" in options to use this setting.'
			: 'Override "Appearance > Interface > Show inline title" for files on the target folder.';
		new Setting(this.containerEl)
			.setName("Hide inline title for target folder")
			.setDesc(description)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.isTitleHidden)
					.onChange(async (value) => {
						this.plugin.settings.isTitleHidden = value;
						await this.plugin.saveSettings();
					});
			})
			//  Disable this setting if the obsidian setting "Show inline title" is disabled
			.setDisabled(shouldDisable)
			.then(async (setting) => {
				if (shouldDisable) {
					setting.settingEl.style.opacity = "0.5";
					setting.controlEl.getElementsByTagName(
						"input"
					)[0].disabled = true;
					setting.controlEl.getElementsByTagName(
						"input"
					)[0].style.cursor = "not-allowed";
				} else {
					setting.settingEl.style.opacity = "1";
					setting.controlEl.getElementsByTagName(
						"input"
					)[0].disabled = false;
					setting.controlEl.getElementsByTagName(
						"input"
					)[0].style.cursor = "pointer";
				}
			});

		// Setting 6
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

		// Setting 7
		new Setting(this.containerEl)
			.setName("Character count")
			.setDesc(
				"Auto Filename will use the first x number of characters in file as filename."
			)
			.addText((text) =>
				text
					.setPlaceholder(
						`10-100 (Default: ${DEFAULT_SETTINGS.charCount})`
					)
					.setValue(String(this.plugin.settings.charCount))
					.onChange(async (value) => {
						const numVal = Number(value);
						if (numVal >= 10 && numVal <= 100) {
							this.plugin.settings.charCount = numVal;
							await this.plugin.saveSettings();
						}
					})
			);

		// Setting 8
		new Setting(this.containerEl)
			.setName("Check interval")
			.setDesc(
				"Interval in milliseconds of how often to rename files while editing. Increase if there's performance issues."
			)
			.addText((text) =>
				text
					.setPlaceholder(
						`Default: ${DEFAULT_SETTINGS.checkInterval}`
					)
					.setValue(String(this.plugin.settings.checkInterval))
					.onChange(async (value) => {
						if (!isNaN(Number(value))) {
							this.plugin.settings.checkInterval = Number(value);
							await this.plugin.saveSettings();
						}
					})
			);

		// Setting 9
		new Setting(this.containerEl)
			.setName("Rename all files")
			.setDesc(
				"Force rename all files on the target folder. Warning: To be safe, make sure you backup before proceeding."
			)
			.addButton((button) =>
				button.setButtonText("Rename").onClick(async () => {
					let filesToRename: TFile[] = [];
					this.app.vault.getMarkdownFiles().forEach((file) => {
						if (inTargetFolder(file, this.plugin.settings)) {
							filesToRename.push(file);
						}
					});

					new Notice(
						`Renaming files in ${this.plugin.settings.targetFolder}...`
					);

					renamedFileCount = 0;
					tempNewPaths = [];
					await Promise.all(
						filesToRename.map((file: TFile) =>
							this.plugin.renameFile(file, true)
						)
					);
					new Notice(
						`Renamed ${renamedFileCount}/${filesToRename.length} files in ${this.plugin.settings.targetFolder}.`
					);
				})
			);
	}
}
