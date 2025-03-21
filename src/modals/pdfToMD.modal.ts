import PDFtoMD from "main";
import { App, Modal, Notice } from "obsidian";
import {
	getJsonFromSignedUrl,
	getSignedUrl,
	uploadPDFtoMistral,
} from "../utils/ocrRequests.utils";
import { addApiKey } from "./addApiKey.modal";

export class pdfToMdModal extends Modal {
	private plugin: PDFtoMD;

	constructor(app: App, plugin: PDFtoMD) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;

		if (this.plugin.settings.apiKey === "") {
			new addApiKey(this.app, this.plugin).open();
			this.close();
		}

		contentEl.createEl("h2", {
			text: "PDF To Markdown",
			cls: "pdf-upload-title",
		});

		const container = contentEl.createDiv({ cls: "pdf-upload-container" });

		const inputContainer = container.createDiv({
			cls: "pdf-input-container",
		});

		const pdfInput = inputContainer.createEl("input", {
			attr: {
				type: "text",
				id: "pdf-upload",
				placeholder: "Sélectionner un PDF...",
				readonly: "true",
			},
			cls: "pdf-upload-input",
		});

		const fileInput = inputContainer.createEl("input", {
			attr: {
				type: "file",
				accept: "application/pdf",
				hidden: "true",
			},
		});

		const folderInput = inputContainer.createEl("input", {
			attr: {
				type: "text",
				id: "folder-upload",
				value: this.plugin.settings.defaultFolder,
				placeholder: this.plugin.settings.defaultFolder,
				readonly: "true",
			},
			cls: "folder-upload-input",
		});

		pdfInput.addEventListener("click", () => fileInput.click());

		fileInput.addEventListener("change", (event) => {
			const file = (event.target as HTMLInputElement).files?.[0];
			if (file) {
				pdfInput.value = file.name;
			}
		});

		folderInput.addEventListener("click", async () => {
			const folderPath = await this.openFolderDialog();
			if (folderPath) {
				folderInput.value = folderPath;
			}
		});

		const submitButton = container.createEl("button", {
			text: "Convertir PDF",
			cls: "pdf-upload-button",
		});

		submitButton.addEventListener("click", async () => {
			const file = fileInput.files?.[0];
			const folderPath = folderInput.value;

			if (!file) {
				new Notice("Veuillez sélectionner un fichier PDF.");
				return;
			}

			if (!folderPath) {
				new Notice("Veuillez entrer un dossier de destination.");
				return;
			}

			try {
				const jsonContent = await this.getJSON(file);

				let pageContent = "";
				const images: string[] = [];

				jsonContent.pages.forEach((page) => {
					if (page.markdown) {
						pageContent += `${page.markdown} `;
					}

					if (page.images) {
						page.images.forEach((image) => {
							if (image.imageBase64) {
								images.push(image.imageBase64);
							}
						});
					}
				});

				await this.createMarkdownFile(
					pageContent,
					file,
					folderPath,
					images
				);

				new Notice("Conversion réussie !");
				this.close();
			} catch (error) {
				new Notice(
					`La conversion a échoué. Détails de l'erreur : ${
						error instanceof Error ? error.message : error
					}`
				);
			}
		});
	}

	async openFolderDialog(): Promise<string | null> {
		return new Promise((resolve) => {
			const dialog = window.require("electron").remote.dialog;

			dialog
				.showOpenDialog({
					properties: ["openDirectory"],
				})
				.then((result: any) => {
					if (result.canceled) {
						resolve(null);
					} else {
						resolve(result.filePaths[0]);
					}
				})
				.catch((err: Error) => {
					resolve(null);
				});
		});
	}

	async createMarkdownFile(
		content: string,
		file: File,
		folderPath: string,
		images: string[]
	) {
		const fileName = file.name.replace(/\.pdf$/, "");
		const markdownFileName = `${fileName}.md`;
		const vaultRoot = this.app.vault.adapter.basePath;
		const relativeFolderPath = folderPath
			.replace(vaultRoot, "")
			.replace(/^\/+/, "");

		const newFolderPath = relativeFolderPath
			? `${relativeFolderPath}${fileName}`
			: fileName;

		if (!(await this.app.vault.adapter.exists(newFolderPath))) {
			try {
				await this.app.vault.createFolder(newFolderPath);
			} catch (error) {
				new Notice(`Erreur lors de la création du dossier : ${error}`);
				return;
			}
		}

		const fullPath = `${newFolderPath}/${markdownFileName}`;
		try {
			if (images && images.length > 0) {
				for (let i = 0; i < images.length; i++) {
					const image = images[i];
					const imageFileName = `img-${i}.jpeg`;
					const imagePath = `${newFolderPath}/${imageFileName}`;
					try {
						const base64Data = image.split(",")[1];
						const imageBuffer = Buffer.from(base64Data, "base64");
						await this.app.vault.adapter.writeBinary(
							imagePath,
							imageBuffer
						);
					} catch (error) {
						new Notice(
							`Erreur lors de la création de l'image : ${error}`
						);
					}
				}
			}

			await this.app.vault.create(fullPath, content);
		} catch (error) {
			new Notice(
				`Erreur lors de la création du fichier Markdown : ${error}`
			);
		}
	}

	async getJSON(file: File) {
		const uploadedPdf = await uploadPDFtoMistral(file);
		const signedUrl = await getSignedUrl(uploadedPdf);
		return await getJsonFromSignedUrl(signedUrl);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
