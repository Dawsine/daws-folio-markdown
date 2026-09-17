import * as vscode from 'vscode';
import { VIEW_TYPE } from './constants';

const SKIP_SCHEMES = new Set(['git', 'gitlens', 'output', 'vscode-scm', 'comment', 'walkThrough']);
const inflight = new Set<string>();

export function isMarkdownDocument(document: vscode.TextDocument): boolean {
	if (document.languageId === 'markdown') {
		return true;
	}
	return isMarkdownPath(document.uri.path);
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

export function isSkippedScheme(scheme: string): boolean {
	return SKIP_SCHEMES.has(scheme);
}

export function autoPreviewEnabled(): boolean {
	return vscode.workspace.getConfiguration('dawsFolioMarkdown').get<boolean>('automaticallyShowPreview', true);
}

export function findMarkdownTabs(uri: vscode.Uri): { text?: vscode.Tab; folio?: vscode.Tab } {
	const key = uri.toString();
	const found: { text?: vscode.Tab; folio?: vscode.Tab } = {};
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (input instanceof vscode.TabInputText && input.uri.toString() === key) {
				found.text = tab;
			}
			if (
				input instanceof vscode.TabInputCustom &&
				input.viewType === VIEW_TYPE &&
				input.uri.toString() === key
			) {
				found.folio = tab;
			}
		}
	}
	return found;
}

export function isFolioTab(tab: vscode.Tab | undefined, uri?: vscode.Uri): boolean {
	const input = tab?.input;
	if (!(input instanceof vscode.TabInputCustom) || input.viewType !== VIEW_TYPE) {
		return false;
	}
	return uri == null || input.uri.toString() === uri.toString();
}

export async function ensureFolioPreview(uri: vscode.Uri): Promise<void> {
	if (!autoPreviewEnabled() || isSkippedScheme(uri.scheme)) {
		return;
	}
	if (findMarkdownTabs(uri).folio) {
		return;
	}
	await openWithGuard(uri, VIEW_TYPE, {
		viewColumn: vscode.ViewColumn.Beside,
		preserveFocus: true,
		preview: true,
	});
}

export async function ensureSourceEditor(uri: vscode.Uri): Promise<void> {
	if (!autoPreviewEnabled() || isSkippedScheme(uri.scheme)) {
		return;
	}
	if (findMarkdownTabs(uri).text) {
		return;
	}
	await openWithGuard(uri, 'default', {
		viewColumn: vscode.ViewColumn.One,
		preserveFocus: true,
		preview: true,
	});
}

export async function focusSourceEditor(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
}

export async function focusFolioPreview(uri: vscode.Uri): Promise<void> {
	await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
		preserveFocus: false,
	});
}

async function openWithGuard(
	uri: vscode.Uri,
	viewType: string,
	options: vscode.TextDocumentShowOptions,
): Promise<void> {
	const key = `${viewType}:${uri.toString()}`;
	if (inflight.has(key)) {
		return;
	}
	inflight.add(key);
	try {
		await vscode.commands.executeCommand('vscode.openWith', uri, viewType, options);
	} finally {
		inflight.delete(key);
	}
}
