# Auto Filename

📁 Simplify your file naming workflow

🙌 Obsidian Auto Filename is a plugin that automatically renames files in Obsidian based on the first x characters of the file. This can save you a lot of time and effort, especially if you create a lot of new notes or files on a regular basis.

🔧 The plugin is easy to use. Simply install it from the Obsidian community plugins and configure the settings to your liking. You can choose the target folder where you want the plugin to rename files, the number of characters to use for the filename, and whether or not to hide the inline title for files in the target folder.

🚀 Once you have configured the plugin, it will automatically rename any new files that you create in the target folder. You can also rename all of the files in the target folder at once by clicking the "Rename All files" button in the plugin settings.

📝 Obsidian Auto Filename is a great plugin for anyone who wants to simplify their file naming workflow. It is especially useful for people who use Obsidian to create a lot of new notes or files on a regular basis.

😊 Try Obsidian Auto Filename today and save yourself time and effort!

## Demo
![](https://github.com/rcsaquino/obsidian-auto-filename/blob/main/assets/demo.gif)

## How to use

1. Install from obsidian community plugins.
2. Setup settings
    - Include
        - Field: accepts folder paths from vault.
        - Folder paths where Auto Filename would auto rename files. Separate by new line. Case sensitive.
        - Supports glob patterns: `**` for all folders, `folder/**` for recursive matching.
        - Default: none
        - Examples:
            - `**` - all files in the entire vault
            - `My Folder` - only files directly in "My Folder"
            - `Notes/**` - files in "Notes" and all its subfolders (recursive)
            - `/` - files in vault root only
    - Use header as filename
        - Toggle
        - Uses the header as filename if the file starts with an H1.
        - Default: on
     - Only use the first line
       	- Toggle
       	- Ignore succeeding lines of text when determining filename.
       	- Default: off
    - Hide inline title for target folder
        - Toggle
        - This overrides "Appearance > Interface > Show inline title" for files on the target folder.
    	- You must enable "Show inline title" in options to use this setting.
        - Default: off
    - YAML Support
        - Toggle
        - Enables YAML support.
        - Default: on
    - Include Emojis
        - Toggle
        - Include or remove emojis in the filename.
        - Default: on
    - Character count
        - Field: accepts number from 10 to 100.
        - Auto Filename will use the first x number of characters in file as filename.
        - Default: 50
	- Check interval
		- Field: accepts number
		- Interval in milliseconds of how often to rename files while editing. Increase if there's performance issues.
		- Default: 500
    - Illegal character replacement
        - Field: accepts text.
        - Character(s) to replace illegal filename characters (`\ / : * ? " < > | # ^ [ ]`) with. Default is a space, so `3/7/9` becomes `3 7 9`. Leave empty to delete them (old behavior).
        - Default: ` ` (space)
    - Ignore individual files
        - No input. Add `auto-filename-ignore: true` to a note's frontmatter (Properties) to prevent Auto Filename from renaming that file. Also accepts `auto-filename: ignore` in frontmatter. Applies to automatic renames and "Rename all files".
    - Rename All files
        - Button
        - Renames all files on the target folder.
        - Warning: To be safe, make sure you backup before proceeding.

## Manual install
1. Download `main.js`, `styles.css` and `manifest.json` from the [latest release](https://github.com/rcsaquino/obsidian-auto-filename/releases/latest).
2. Copy or move the downloaded files to `path_to_your_vault/.obsidian/plugins/obsidian-auto-filename`.

## Support my work

If you like Auto Filename, then please support my work and enthusiasm by buying me a coffee on [https://ko-fi.com/rcsaquino](https://ko-fi.com/rcsaquino)😊.

<a href='https://ko-fi.com/rcsaquino' target='_blank'><img height='72' style='border:0px;height:72px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>