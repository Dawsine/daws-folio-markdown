import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isBlockedLink, isExternalLink, splitLinkHref } from './linkHref';
import { protectMathInTables, restoreMathInTables } from './tableMath';

export const VIEW_TYPE = 'dawsine.folioMarkdown';

interface EditorConfig {
	editMode: string;
	editorTheme: string;
	mermaidTheme: string;
	language: string;
	fontSize: number;
	fontFamily: string;
}

interface HostToWebviewOpen {
	type: 'open';
	payload: {
		content: string;
		config: EditorConfig;
		fileName: string;
		documentBaseUrl: string;
		workspaceBaseUrl: string;
	};
}

interface HostToWebviewUpdate {
	type: 'update';
	payload: {
		content: string;
	};
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
	private readonly lastPosted = new Map<string, string>();
	private readonly panels = new Set<vscode.WebviewPanel>();
	private focused: vscode.WebviewPanel | undefined;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new MarkdownEditorProvider(context);
		return vscode.Disposable.from(
			vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			}),
			vscode.commands.registerCommand('dawsFolioMarkdown.cut', () => provider.sendClipboard('cut')),
			vscode.commands.registerCommand('dawsFolioMarkdown.copy', () => provider.sendClipboard('copy')),
			vscode.commands.registerCommand('dawsFolioMarkdown.paste', () => provider.sendClipboard('paste')),
		);
	}

	private constructor(private readonly context: vscode.ExtensionContext) {}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		this.panels.add(webviewPanel);
		this.rememberFocus(webviewPanel);
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: this.localResourceRoots(document),
		};
		webviewPanel.webview.html = this.buildWebviewHtml(webviewPanel.webview);

		const docKey = document.uri.toString();

		const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() !== docKey) {
				return;
			}
			const content = protectMathInTables(event.document.getText());
			if (this.lastPosted.get(docKey) === content) {
				return;
			}
			this.lastPosted.set(docKey, content);
			const message: HostToWebviewUpdate = { type: 'update', payload: { content } };
			void webviewPanel.webview.postMessage(message);
		});

		const messageSub = webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
			const type = readMessageType(message);
			if (type === 'ready' || type === 'init') {
				this.postOpen(webviewPanel.webview, document);
				return;
			}
			if (type === 'save') {
				const raw = readSaveContent(message);
				if (typeof raw !== 'string') {
					return;
				}
				void this.writeDocument(document, raw);
				return;
			}
			if (type === 'clipboardWrite') {
				const text = readClipboardText(message);
				if (typeof text === 'string') {
					void vscode.env.clipboard.writeText(text);
				}
				return;
			}
			if (type === 'clipboardNeed') {
				void this.sendClipboard('paste', webviewPanel.webview);
				return;
			}
			if (type === 'openLink') {
				void this.openLink(document, readHref(message));
			}
		});

		const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration('editor.fontSize') && !event.affectsConfiguration('editor.fontFamily')) {
				return;
			}
			this.postOpen(webviewPanel.webview, document);
		});

		const stateSub = webviewPanel.onDidChangeViewState(() => {
			this.rememberFocus(webviewPanel);
		});

		webviewPanel.onDidDispose(() => {
			changeSub.dispose();
			messageSub.dispose();
			configSub.dispose();
			stateSub.dispose();
			this.panels.delete(webviewPanel);
			if (this.focused === webviewPanel) {
				this.focused = undefined;
			}
			this.lastPosted.delete(docKey);
			this.refreshFocusContext();
		});
	}

	private rememberFocus(panel: vscode.WebviewPanel): void {
		if (panel.active) {
			this.focused = panel;
		}
		this.refreshFocusContext();
	}

	private refreshFocusContext(): void {
		const on = this.focused != null && this.panels.has(this.focused) && this.focused.visible;
		void vscode.commands.executeCommand('setContext', 'dawsFolioMarkdown.focus', on);
	}

	private targetWebview(): vscode.Webview | undefined {
		if (this.focused && this.panels.has(this.focused)) {
			return this.focused.webview;
		}
		for (const panel of this.panels) {
			if (panel.visible) {
				return panel.webview;
			}
		}
		const first = this.panels.values().next().value as vscode.WebviewPanel | undefined;
		return first?.webview;
	}

	private async openLink(document: vscode.TextDocument, href: string | undefined): Promise<void> {
		const raw = String(href ?? '').trim();
		if (!raw || isBlockedLink(raw)) {
			return;
		}
		if (isExternalLink(raw)) {
			await vscode.env.openExternal(vscode.Uri.parse(raw));
			return;
		}

		const { path: pathPart } = splitLinkHref(raw);
		if (!pathPart) {
			return;
		}

		if (/^(file|vscode-remote|vscode-vfs):/i.test(pathPart)) {
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(pathPart));
			return;
		}

		let rel: string;
		try {
			rel = decodeURIComponent(pathPart);
		} catch {
			rel = pathPart;
		}
		rel = rel.replace(/\\/g, '/');

		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const target = rel.startsWith('/')
			? folder
				? vscode.Uri.joinPath(folder.uri, rel.replace(/^\/+/, ''))
				: vscode.Uri.joinPath(document.uri, '..', rel)
			: vscode.Uri.joinPath(document.uri, '..', rel);

		await vscode.commands.executeCommand('vscode.open', target);
	}

	public async sendClipboard(action: 'cut' | 'copy' | 'paste', webview = this.targetWebview()): Promise<void> {
		if (!webview) {
			return;
		}
		const text = action === 'paste' ? await vscode.env.clipboard.readText() : undefined;
		void webview.postMessage({ type: 'clipboard', payload: { action, text } });
	}

	private postOpen(webview: vscode.Webview, document: vscode.TextDocument): void {
		const content = protectMathInTables(document.getText());
		this.lastPosted.set(document.uri.toString(), content);
		const message: HostToWebviewOpen = {
			type: 'open',
			payload: {
				content,
				config: this.readEditorConfig(),
				fileName: path.basename(document.uri.path),
				documentBaseUrl: this.toWebviewDir(webview, vscode.Uri.joinPath(document.uri, '..')),
				workspaceBaseUrl: this.workspaceWebviewDir(webview, document),
			},
		};
		void webview.postMessage(message);
	}

	private localResourceRoots(document: vscode.TextDocument): vscode.Uri[] {
		const roots = [
			vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'vditor'),
			vscode.Uri.joinPath(document.uri, '..'),
		];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			roots.push(folder.uri);
		}
		return roots;
	}

	private toWebviewDir(webview: vscode.Webview, dir: vscode.Uri): string {
		return webview.asWebviewUri(dir).toString().replace(/\/?$/, '/');
	}

	private workspaceWebviewDir(webview: vscode.Webview, document: vscode.TextDocument): string {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		return folder ? this.toWebviewDir(webview, folder.uri) : '';
	}

	private async writeDocument(document: vscode.TextDocument, markdown: string): Promise<void> {
		const restored = restoreMathInTables(markdown);
		if (document.getText() === restored) {
			this.lastPosted.set(document.uri.toString(), protectMathInTables(restored));
			return;
		}

		this.lastPosted.set(document.uri.toString(), protectMathInTables(restored));
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
			restored,
		);
		await vscode.workspace.applyEdit(edit);
	}

	private readEditorConfig(): EditorConfig {
		const cfg = vscode.workspace.getConfiguration('dawsFolioMarkdown');
		const editor = vscode.workspace.getConfiguration('editor');
		return {
			editMode: cfg.get<string>('editMode', 'wysiwyg'),
			editorTheme: cfg.get<string>('editorTheme', 'Newsprint'),
			mermaidTheme: cfg.get<string>('mermaidTheme', 'Forest'),
			language: vscode.env.language,
			fontSize: editor.get<number>('fontSize', 14),
			fontFamily: editor.get<string>('fontFamily', 'JetBrains Mono'),
		};
	}

	private buildWebviewHtml(webview: vscode.Webview): string {
		const mediaDir = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const vditorDir = vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'vditor');
		const htmlPath = vscode.Uri.joinPath(mediaDir, 'editor.html');
		const vditorCss = webview.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'index.css')).toString();
		const vditorJs = webview.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'index.js')).toString();
		const vditorIcons = webview
			.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'js', 'icons', 'ant.js'))
			.toString();
		const vditorMermaid = webview
			.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'js', 'mermaid', 'mermaid.min.js'))
			.toString();
		const katexCss = webview
			.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'js', 'katex', 'katex.min.css'))
			.toString();
		const katexJs = webview
			.asWebviewUri(vscode.Uri.joinPath(vditorDir, 'dist', 'js', 'katex', 'katex.min.js'))
			.toString();
		const editorCss = cacheBust(webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'editor.css')).toString(), '0.1.9');
		const scriptUri = cacheBust(webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'editor.js')).toString(), '0.1.9');
		const mediaRoot = webview.asWebviewUri(mediaDir).toString();
		const vditorRoot = webview.asWebviewUri(vditorDir).toString();
		const cspSource = webview.cspSource;
		const csp = [
			`default-src 'none'`,
			`img-src ${cspSource} https: data: blob:`,
			`script-src ${cspSource}`,
			`style-src ${cspSource} 'unsafe-inline'`,
			`font-src ${cspSource} data:`,
			`connect-src ${cspSource}`,
			`worker-src ${cspSource} blob:`,
		].join('; ');

		let html: string;
		try {
			html = fs.readFileSync(htmlPath.fsPath, 'utf8');
		} catch {
			return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>Daws Folio Markdown</title>
</head>
<body>
	<div id="vditor"></div>
	<script src="${scriptUri}"></script>
</body>
</html>`;
		}

		html = html
			.replaceAll('{{csp}}', csp)
			.replaceAll('{{cspSource}}', cspSource)
			.replaceAll('{{VDITOR_CSS}}', vditorCss)
			.replaceAll('{{VDITOR_JS}}', vditorJs)
			.replaceAll('{{VDITOR_ICONS}}', vditorIcons)
			.replaceAll('{{VDITOR_MERMAID}}', vditorMermaid)
			.replaceAll('{{KATEX_CSS}}', katexCss)
			.replaceAll('{{KATEX_JS}}', katexJs)
			.replaceAll('{{EDITOR_CSS}}', editorCss)
			.replaceAll('{{EDITOR_JS}}', scriptUri)
			.replaceAll('{{scriptUri}}', scriptUri)
			.replaceAll('{{mediaRoot}}', mediaRoot)
			.replaceAll('{{vditorRoot}}', vditorRoot);

		html = html.replace(/(?:src|href)=["'](?:\.\/)?(?:media\/)?editor\.js["']/g, `src="${scriptUri}"`);

		if (!html.includes(scriptUri) && !/editor\.js/.test(html)) {
			const tag = `<script src="${scriptUri}"></script>`;
			html = html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : `${html}${tag}`;
		}

		if (!/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
			const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
			html = html.includes('</head>') ? html.replace('</head>', `${meta}\n</head>`) : `${meta}${html}`;
		}

		return html;
	}
}

function cacheBust(uri: string, token: string): string {
	return uri.includes('?') ? `${uri}&v=${token}` : `${uri}?v=${token}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== 'object') {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function readMessageType(message: unknown): string | undefined {
	const record = asRecord(message);
	return typeof record?.type === 'string' ? record.type : undefined;
}

function readHref(message: unknown): string | undefined {
	const record = asRecord(message);
	if (!record) {
		return undefined;
	}
	const payload = asRecord(record.payload);
	if (typeof payload?.href === 'string') {
		return payload.href;
	}
	if (typeof record.href === 'string') {
		return record.href;
	}
	return undefined;
}

function readClipboardText(message: unknown): string | undefined {
	const record = asRecord(message);
	if (!record) {
		return undefined;
	}
	const payload = asRecord(record.payload);
	if (typeof payload?.text === 'string') {
		return payload.text;
	}
	if (typeof record.text === 'string') {
		return record.text;
	}
	return undefined;
}

function readSaveContent(message: unknown): string | undefined {
	const record = asRecord(message);
	if (!record) {
		return undefined;
	}
	const payload = asRecord(record.payload);
	if (typeof payload?.content === 'string') {
		return payload.content;
	}
	if (typeof record.payload === 'string') {
		return record.payload;
	}
	if (typeof record.content === 'string') {
		return record.content;
	}
	return undefined;
}
