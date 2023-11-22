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
	ignoreYAML: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	charCount: 50,
	targetFolder: "",
	isTitleHidden: false,
	checkInterval: 500,
	ignoreYAML: false,
};

const END_OF_LINE: RegExp = /\r\n|\r|\n/;

// Global variable for "Rename all files" setting
let renamedFileCount: number = 0;

// Variables for debounce
let onTimeout: boolean = true;
let timeout: NodeJS.Timeout;
let previousFile: string;

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	// Function for renaming files
	async renameFile(file: TFile, noDelay = false): Promise<void> {
		if (this.settings.targetFolder == "") return; // Return if user has no target folder selected
		if (file?.parent?.path != this.settings.targetFolder) return; // Return if file is not in user's target folder

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

		// Ignores YAML depending on user preference (Experimental)
		if (this.settings.ignoreYAML) {
			let contentLines: string[] = content.split(END_OF_LINE);
			if (contentLines[0] === "---") {
				for (let i: number = 1; i < contentLines.length; i++) {
					if (contentLines[i] === "---") {
						content = contentLines.slice(i + 1).join(" ");
						break;
					}
				}
			}
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
			if (END_OF_LINE.test(char)) char = " "; // Treat new lines as spaces.
			if (allowedChars.contains(char)) {
				fileName += char;
			}
		}

		fileName = fileName.trim(); // Trim white space
		if (fileName[0] == ".") fileName = "~ " + fileName; // Add "~ " at the beginning if "." is the first character in a file to avoid naming issues.

		// No need to rename if new filename == old filename
		if (fileName == file.name.slice(0, -13)) return;

		// Adds 7 random alphanumeric characters at the end.
		// This allows multiple files with the same first n characters to be created without issues.
		fileName = `${fileName} (${Math.random().toString(36).slice(-7)}).md`;

		const newPath: string = `${this.settings.targetFolder}/${fileName}`;
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
				if (!document.body.classList.contains("show-inline-title"))
					return;

				let shouldHide =
					this.settings.isTitleHidden &&
					file?.parent?.path == this.settings.targetFolder;

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
					.setPlaceholder("folder/subfolder")
					.setValue(this.plugin.settings.targetFolder)
					.onChange(async (value) => {
						this.plugin.settings.targetFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Setting 2
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

		// Setting 3
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

		// Setting 4
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

		// Setting 5
		new Setting(this.containerEl)
			.setName("YAML Support (Experimental)")
			.setDesc(
				"Enables YAML support. Warning: Highly experimental. Please report bugs/performance issues in the github page."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.ignoreYAML)
					.onChange(async (value) => {
						this.plugin.settings.ignoreYAML = value;
						await this.plugin.saveSettings();
					});
			});

		// Setting 6
		new Setting(this.containerEl)
			.setName("Rename all files")
			.setDesc(
				"Forcibly renames all files on the target folder. Warning: To be safe, make sure you backup before proceeding."
			)
			.addButton((button) =>
				button.setButtonText("Rename").onClick(async () => {
					let targetFolder = this.app.vault.getAbstractFileByPath(
						this.plugin.settings.targetFolder
					);
					let files: TAbstractFile[];
					if (targetFolder instanceof TFolder) {
						files = targetFolder.children.filter(
							(file: TAbstractFile) => file instanceof TFile
						);
					} else {
						new Notice("Error renaming files!");
						return;
					}

					new Notice(
						`Renaming files in ${this.plugin.settings.targetFolder}...`
					);

					renamedFileCount = 0;
					await Promise.all(
						files.map((file: TFile) =>
							this.plugin.renameFile(file, true)
						)
					);
					new Notice(
						`Renamed ${renamedFileCount}/${files.length} files in ${this.plugin.settings.targetFolder}.`
					);
				})
			);
	}
}
