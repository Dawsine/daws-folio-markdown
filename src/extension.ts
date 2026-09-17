import * as vscode from 'vscode';
import { VIEW_TYPE } from './constants';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { isFolioTab, isMarkdownPath } from './splitView';

export function activate(context: vscode.ExtensionContext): void {
	void vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', true);
	context.subscriptions.push(MarkdownEditorProvider.register(context));
	context.subscriptions.push(
		vscode.commands.registerCommand('dawsFolioMarkdown.switchEditor', (uri?: vscode.Uri) =>
			switchMarkdownEditor(uri),
		),
		vscode.commands.registerCommand('dawsFolioMarkdown.openPreviewToTheSide', (uri?: vscode.Uri) =>
			openPreviewToTheSide(uri),
		),
	);
}

export function deactivate(): void {
	// 无全局资源需要释放。
}

function resolveTarget(uri?: vscode.Uri): vscode.Uri | undefined {
	if (uri && isMarkdownPath(uri.path)) {
		return uri;
	}

	const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
	const input = tab?.input;
	const fromCustom = input instanceof vscode.TabInputCustom ? input.uri : undefined;
	const fromTextTab = input instanceof vscode.TabInputText ? input.uri : undefined;
	const fromEditor = vscode.window.activeTextEditor?.document.uri;
	const target = fromTextTab ?? fromCustom ?? fromEditor;
	if (!target || !isMarkdownPath(target.path)) {
		return undefined;
	}
	return target;
}

async function openPreviewToTheSide(uri?: vscode.Uri): Promise<void> {
	const target = resolveTarget(uri);
	if (!target) {
		void vscode.window.showInformationMessage('请先打开 Markdown 文件后再打开预览。');
		return;
	}
	await vscode.workspace.openTextDocument(target);
	await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, {
		preserveFocus: false,
		preview: false,
	});
}

async function switchMarkdownEditor(uri?: vscode.Uri): Promise<void> {
	const target = resolveTarget(uri);
	if (!target) {
		void vscode.window.showInformationMessage('请先打开 Markdown 文件后再切换编辑器。');
		return;
	}

	const active = vscode.window.tabGroups.activeTabGroup.activeTab;
	if (isFolioTab(active, target)) {
		await vscode.commands.executeCommand('vscode.openWith', target, 'default', {
			preserveFocus: false,
			preview: false,
		});
		return;
	}

	await vscode.workspace.openTextDocument(target);
	await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, {
		preserveFocus: false,
		preview: false,
	});
}
