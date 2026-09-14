import * as vscode from 'vscode';
import { MarkdownEditorProvider, VIEW_TYPE } from './markdownEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(MarkdownEditorProvider.register(context));
	context.subscriptions.push(
		vscode.commands.registerCommand('dawsFolioMarkdown.switchEditor', (uri?: vscode.Uri) =>
			switchMarkdownEditor(uri),
		),
	);
}

export function deactivate(): void {
	// 无全局资源需要释放。
}

function isMarkdownUri(uri: vscode.Uri): boolean {
	return /\.(md|markdown)$/i.test(uri.path);
}

async function switchMarkdownEditor(uri?: vscode.Uri): Promise<void> {
	const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
	const input = tab?.input;

	if (input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE) {
		await vscode.commands.executeCommand('vscode.openWith', uri ?? input.uri, 'default');
		return;
	}

	const fromTextTab = input instanceof vscode.TabInputText ? input.uri : undefined;
	const fromEditor = vscode.window.activeTextEditor?.document.uri;
	const target = uri ?? fromTextTab ?? fromEditor;

	if (!target || !isMarkdownUri(target)) {
		void vscode.window.showInformationMessage('请先打开 Markdown 文件后再切换编辑器。');
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
}
