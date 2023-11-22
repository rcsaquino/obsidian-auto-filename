import {
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	TFolder,
	TAbstractFile,
} from "obsidian";

interface PluginSettings {
	charCount: number;
	targetFolder: string;
	isTitleHidden: boolean;
	checkInterval: number;
	supportYAML: boolean;
	useHeader: boolean;
	includeSubfolder: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	charCount: 50,
	targetFolder: "",
	isTitleHidden: false,
	checkInterval: 500,
	supportYAML: true,
	useHeader: true,
	includeSubfolder: false,
};

// Global variable for "Rename all files" setting
let renamedFileCount: number = 0;

// Variables for debounce
let onTimeout: boolean = true;
let timeout: NodeJS.Timeout;
let previousFile: string;

function inTargetFolder(file: TFile, settings: PluginSettings): boolean {
	if (settings.targetFolder == "") return false; // False if user has no target folder selected
	if (settings.includeSubfolder) {
		if (!file.parent?.path.startsWith(settings.targetFolder)) return false; // False if file is not in user's target folder or its subfolders
	} else {
		if (file.parent?.path != settings.targetFolder) return false; // False if file is not in user's target folder
	}
	return true;
}

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	// Function for renaming files
	async renameFile(file: TFile, noDelay = false): Promise<void> {
		if (!inTargetFolder(file, this.settings)) return; // Return if file is not within the target folder/s

		// Debounce to avoid performance issues
		if (!noDelay) {
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

		// Ignores YAML depending on user preference
		if (this.settings.supportYAML && content.startsWith("---")) {
			let index = content.indexOf("---", 3); // returns -1 if none
			if (index != -1) content = content.slice(index + 3).trimStart(); // Add 3 to cover "---" || Cleanup white spaces and newlines at start
		}

		// Use the header as filename depending on user preference
		if (this.settings.useHeader && content.startsWith("# ")) {
			let index = content.indexOf("\n");
			if (index != -1) content = content.slice(2, index);
		}

		const allowedChars: string =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !#$%&'()+,-.;=@[]^_`{}~"; // Characters that are safe to use in a filename
		let fileName: string = "";

		// Takes the first n characters of the file and uses it as part of the filename.
		for (let i: number = 0; i < content.length; i++) {
			// Adds "..." after the last character if file characters > n
			if (i >= Number(this.settings.charCount)) {
				fileName += "...";
				break;
			}
			let char = content[i];
			if (char === "\n") char = " "; // Treat new lines as spaces.
			if (allowedChars.includes(char)) fileName += char;
		}

		fileName = fileName.trim(); // Trim white space
		if (fileName[0] == ".") fileName = fileName.slice(1); // Remove if "." is the first character in a file to avoid naming issues.

		// No need to rename if new filename == old filename
		// " (abc1234).md" = 13 chars
		if (file.name.startsWith(fileName) && fileName != "") return;

		// Adds 7 random alphanumeric characters at the end.
		// This allows multiple files with the same first n characters to be created without issues.
		fileName = `${fileName} (${Math.random().toString(36).slice(-7)}).md`;

		const newPath: string = `${file.parent?.path}/${fileName}`;
		await this.app.fileManager.renameFile(file, newPath);
		renamedFileCount++;
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
					this.renameFile(abstractFile);
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

		// Setting 4
		const shouldDisable: boolean =
			!document.body.classList.contains("show-inline-title");
		const description: string = shouldDisable
			? 'Enable "Appearance > Advanced > Show inline title" in options to use this setting.'
			: 'Overrides "Appearance > Advanced > Show inline title" for files on the target folder.';
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

		// Setting 5
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

		// Setting 6
		new Setting(this.containerEl)
			.setName("Use the header as filename")
			.setDesc(
				"Uses the header as filename if the file starts with an H1."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useHeader)
					.onChange(async (value) => {
						this.plugin.settings.useHeader = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 7
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

		// Setting 8
		new Setting(this.containerEl)
			.setName("Rename all files")
			.setDesc(
				"Forcibly renames all files on the target folder. Warning: To be safe, make sure you backup before proceeding."
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
