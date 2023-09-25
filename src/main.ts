import { Plugin, PluginSettingTab, Setting, Notice, TFile } from "obsidian";

interface PluginSettings {
	charCount: string;
	targetFolder: string;
	isTitleHidden: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	charCount: "50",
	targetFolder: "",
	isTitleHidden: false,
};

// Used for "Hide inline title for target folder" setting
const hideInlineTitle = document.createElement("style");
hideInlineTitle.innerText = ".inline-title {display: none}";

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	// Function for renaming files
	async renameFile(file: TFile): Promise<void> {
		if (this.settings.targetFolder == "") return; // Return if user has no target folder selected
		if (file?.parent?.path != this.settings.targetFolder) return; // Return if file is not in user's target folder

		const content = await this.app.vault.read(file);
		const allowedChars: string =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !#$%&'()+,-.;=@[]^_`{}~"; // Characters that are safe to  use in a filename
		const chars: string[] = content.split("");

		let fileName: string = "";
		// Takes the first n characters of the file and uses it as part of the filename.
		for (let i: number = 0; i < content.length; i++) {
			// Adds "..." after the last character if file characters > n
			if (i >= Number(this.settings.charCount)) {
				fileName += "...";
				break;
			}

			if (chars[i] == "\n") chars[i] = " "; // Treat new lines as spaces.
			if (allowedChars.contains(chars[i])) {
				fileName += chars[i];
			}
		}
		// Adds a random 4 digit number and the current date in ms at the end.
		// This allows multiple files with the same first n characters to be created without issues.
		fileName = `${fileName.trim()} (${Math.floor(
			1000 + Math.random() * 9000
		)}-${Date.now()}).md`;

		if (fileName[0] == ".") fileName = "~ " + fileName; // Can't use "." at the beginning of a filename. Replace with "~ " if present.
		const newPath: string = `${this.settings.targetFolder}/${fileName}`;
		await this.app.fileManager.renameFile(file, newPath);
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

		// Triggers when vault is  modified such as when editing files.
		// This is what triggers to rename the file
		this.registerEvent(
			this.app.vault.on("modify", (abstractFile) => {
				if (abstractFile instanceof TFile)
					this.renameFile(abstractFile);
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
				const head = document.head;
				if (shouldHide && !head.contains(hideInlineTitle)) {
					head.appendChild(hideInlineTitle);
				}
				if (!shouldHide && head.contains(hideInlineTitle)) {
					head.removeChild(hideInlineTitle);
				}
			})
		);
	}

	// Safely remove registered events
	async onunload(): Promise<void> {
		this.app.vault.off("modify", (abstractFile) => {
			if (abstractFile instanceof TFile) this.renameFile(abstractFile);
		});
		this.app.workspace.off("file-open", (file) => {
			if (!document.body.classList.contains("show-inline-title")) return;
			let shouldHide =
				this.settings.isTitleHidden &&
				file?.parent?.path == this.settings.targetFolder;
			const head = document.head;
			if (shouldHide && !head.contains(hideInlineTitle)) {
				head.appendChild(hideInlineTitle);
			}
			if (!shouldHide && head.contains(hideInlineTitle)) {
				head.removeChild(hideInlineTitle);
			}
		});
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
					.setPlaceholder("10-100 (Default: 50)")
					.setValue(this.plugin.settings.charCount)
					.onChange(async (value) => {
						if (Number(value) >= 10 && Number(value) <= 100) {
							this.plugin.settings.charCount = value;
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
			.setName("Rename all files")
			.setDesc(
				"Renames all files on the target folder. Warning: To be safe, make sure you backup before proceeding."
			)
			.addButton((button) =>
				button.setButtonText("Rename").onClick((_) => {
					let files = this.app.vault.getMarkdownFiles();
					files.forEach((file) => {
						this.plugin.renameFile(file);
					});
					new Notice(
						`Renamed all files in ${this.plugin.settings.targetFolder}`
					);
				})
			);
	}
}
