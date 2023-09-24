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

let hideInlineTitle = document.createElement("style");
hideInlineTitle.innerText = ".inline-title {display: none}";

export default class AutoFilename extends Plugin {
	settings: PluginSettings;

	async renameFile(file: TFile): Promise<void> {
		if (this.settings.targetFolder == "") return;
		if (file?.parent?.path != this.settings.targetFolder) return;

		const content = await this.app.vault.read(file);
		const allowedChars: string =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !#$%&'()+,-.;=@[]^_`{}~";
		const chars: string[] = content.split("");
		let fileName: string = "";
		for (let i: number = 0; i < content.length; i++) {
			if (i >= Number(this.settings.charCount)) {
				fileName += "...";
				break;
			}
			if (chars[i] == "\n") chars[i] = " ";
			if (allowedChars.contains(chars[i])) {
				fileName += chars[i];
			}
		}
		fileName = `${fileName.trim()} (${Math.floor(
			1000 + Math.random() * 9000
		)}-${Date.now()}).md`;
		if (fileName[0] == ".") fileName = "~ " + fileName;
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
		this.app.vault.on("modify", (abstractFile) => {
			if (abstractFile instanceof TFile) this.renameFile(abstractFile);
		});
		this.app.workspace.on("file-open", (file) => {
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

	async onunload(): Promise<void> {
		this.app.vault.off("modify", (abstractFile) => {
			if (abstractFile instanceof TFile) this.renameFile(abstractFile);
		});
	}
}

class AutoFilenameSettings extends PluginSettingTab {
	plugin: AutoFilename;

	display(): void {
		this.containerEl.empty();

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

		let shouldDisable: boolean =
			!document.body.classList.contains("show-inline-title");

		let description: string = shouldDisable
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

		new Setting(this.containerEl)
			.setName("Rename all files")
			.setDesc(
				"Renames all files on the target folder. Warning: To be safe, make sure you backup before proceeding."
			)
			.addButton((button) =>
				button.setButtonText("Rename").onClick((_) => {
					let files = this.app.vault.getFiles();
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
