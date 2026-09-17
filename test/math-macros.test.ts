import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import katex from 'katex';
import {
	asStringMacroMap,
	builtinKatexMacros,
	expandMathdsArg,
} from '../src/mathMacros.ts';

function render(tex: string): string {
	return katex.renderToString(tex, {
		throwOnError: true,
		output: 'html',
		strict: false,
		macros: builtinKatexMacros(),
	});
}

describe('katex macros', () => {
	it('drops non-string vscode macro values', () => {
		assert.deepEqual(asStringMacroMap({ '\\RR': '\\mathbb{R}', '\\bad': 1 }), {
			'\\RR': '\\mathbb{R}',
		});
	});

	it('maps digit 1 to the double-struck glyph', () => {
		assert.equal(expandMathdsArg('1'), '𝟙');
		assert.equal(expandMathdsArg('{1}'), '𝟙');
		assert.equal(expandMathdsArg('R'), '\\mathbb{R}');
	});

	it('renders W(\\mathds{1})=0 as 𝟙, not a plain 1', () => {
		const html = render('W(\\mathds{1})=0');
		assert.match(html, /𝟙/);
		assert.doesNotMatch(html, /Undefined control sequence/);
	});

	it('renders \\mathds{1}_k and letter arguments', () => {
		assert.match(render('\\mathds{1}_k'), /𝟙/);
		assert.doesNotThrow(() => render('\\mathds{R}'));
		assert.match(render('\\mathbbm{1}'), /𝟙/);
	});
});
