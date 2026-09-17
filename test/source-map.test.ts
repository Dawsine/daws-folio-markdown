import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockIndexForLine, mapMarkdownBlocks } from '../src/sourceMap';

describe('mapMarkdownBlocks', () => {
	it('maps heading, paragraph and display math', () => {
		const md = ['# 摘要', '', '第一句。', '', '$$', 'E=mc^2', '$$', ''].join('\n');
		assert.deepEqual(mapMarkdownBlocks(md), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
			{ start: 4, end: 7 },
		]);
	});

	it('keeps a fenced block together', () => {
		const md = ['```js', '1', '2', '```', '', '后文'].join('\n');
		assert.deepEqual(mapMarkdownBlocks(md), [
			{ start: 0, end: 4 },
			{ start: 5, end: 6 },
		]);
	});

	it('keeps a pipe table together', () => {
		const md = ['| A | B |', '| --- | --- |', '| $O$ | $O$ |', '', '尾'].join('\n');
		assert.deepEqual(mapMarkdownBlocks(md), [
			{ start: 0, end: 3 },
			{ start: 4, end: 5 },
		]);
	});

	it('finds the last block that starts on or before a line', () => {
		const blocks = [
			{ start: 0, end: 1 },
			{ start: 2, end: 5 },
			{ start: 6, end: 8 },
		];
		assert.equal(blockIndexForLine(blocks, 0), 0);
		assert.equal(blockIndexForLine(blocks, 3), 1);
		assert.equal(blockIndexForLine(blocks, 7), 2);
	});
});
