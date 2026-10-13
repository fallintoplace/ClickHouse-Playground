import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantAnswerContent } from '../../.core-build/src/shared/assistant/answers.js';
import {
    assistantReplyContent,
    normalizeAssistantContent,
} from '../../.core-build/src/shared/assistant/sql-replies.js';

for (const language of [
    'sql',
    'SQL',
    'clickhouse',
    'CLICKHOUSE',
    'postgres',
    'postgresql',
    'mysql',
    'sqlite',
    'tsql',
])
    test(`Returned ${language} scripts become proposals while retaining the explanation`, () => {
        const sql = "-- keep this comment\nSELECT '[docs](https://example.com/)' AS value;";
        const reply = assistantReplyContent(
            `Use this query.\n\n\`\`\`${language}\n${sql}\n\`\`\`\n\nMore details.`,
        );
        assert.equal(reply.sql, sql);
        assert.match(reply.summary, /Use this query/);
        assert.match(reply.summary, /More details/);
        assert.doesNotMatch(reply.summary, /SELECT/);
    });

test('Fenced SQL preserves CRLF, indentation, Unicode, string literals and multiple statements', () => {
    const sql =
        "  SELECT 'Zażółć 🐈', '```', '[x]([https://example.com/](https://example.com/))';\r\nSELECT 2;\r\n";
    assert.equal(assistantReplyContent(`\`\`\`\`sql\r\n${sql}\r\n\`\`\`\``).sql, sql);
});

test('Tilde fences and indented list fences use the same SQL review contract', () => {
    assert.equal(assistantReplyContent('~~~sql\nSELECT 1\n~~~').sql, 'SELECT 1');
    assert.equal(assistantReplyContent('- Option\n\n  ```sql\n  SELECT 2\n  ```').sql, 'SELECT 2');
    assert.equal(assistantReplyContent('> ```sql\n> SELECT 3\n> ```').sql, 'SELECT 3');
});

test('Several SQL fences form one ordered script while retaining the explanation', () => {
    const reply = assistantReplyContent(
        'Choices:\n\n## Exact\n```sql\n-- First query\nSELECT 1\n```\n\n## Approximate\n```sql\nSELECT 2;\nSELECT 3;\n```\n\nFinal note.',
    );
    assert.equal(reply.sql, '-- First query\nSELECT 1\n;\n\nSELECT 2;\nSELECT 3;');
    assert.match(reply.summary, /Final note/);
    assert.doesNotMatch(reply.summary, /SELECT/);
});

test('Existing structured SQL and an explicit empty replacement remain authoritative', () => {
    for (const sql of ['SELECT 42', '']) {
        const content = { ...assistantAnswerContent('```sql\nSELECT 99\n```'), sql };
        assert.deepEqual(normalizeAssistantContent(content), content);
    }
});

test('Combining SQL blocks preserves strings, trailing comments, delimiters and duplicate statements', () => {
    for (const [first, combined] of [
        ["SELECT ';'", "SELECT ';'\n;\n\nSELECT 2"],
        ['SELECT 1 -- trailing comment', 'SELECT 1 -- trailing comment\n;\n\nSELECT 2'],
        ['SELECT 1; -- trailing comment', 'SELECT 1; -- trailing comment\n\nSELECT 2'],
        ['SELECT 1;', 'SELECT 1;\n\nSELECT 2'],
        ["SELECT 'unfinished", "SELECT 'unfinished\n;\n\nSELECT 2"],
    ])
        assert.equal(
            assistantReplyContent(`\`\`\`sql\n${first}\n\`\`\`\n\n\`\`\`sql\nSELECT 2\n\`\`\``).sql,
            combined,
        );
    assert.equal(
        assistantReplyContent('```sql\nSELECT 1\n```\n```sql\nSELECT 1\n```').sql,
        'SELECT 1\n;\n\nSELECT 1',
    );
});

test('Plain prose, other code languages and unfinished fences remain visible answers', () => {
    for (const text of [
        'Here is an explanation.',
        '```json\n{"example":true}\n```',
        '```javascript\nconst sql = "SELECT 1";\n```',
        '```sql\nSELECT 1',
        '```sql\nSELECT 1\n~~~',
        '```sql\nSELECT 2\n> ```',
        '> ```sql\n> SELECT 2\n> > ```',
        '```sql\nSELECT 2\n    ```',
        '> ```sql\n> SELECT 2\n>     ```',
        '- ```sql\n  SELECT 2\n      ```',
        '```sql\n\n```',
        '{"summary":"unfinished',
    ]) {
        const reply = assistantReplyContent(text);
        assert.equal(reply.sql, null);
        assert.equal(reply.summary, text);
    }
});

test('SQL syntax errors stay reviewable when a complete SQL fence was returned', () => {
    assert.equal(
        assistantReplyContent("```sql\nSELECT 'unfinished\n```").sql,
        "SELECT 'unfinished",
    );
});

test('An unfinished SQL block keeps the whole reply visible without proposing a partial script', () => {
    const answer = '```sql\nSELECT 1;\n```\n\n```sql\nSELECT 2';
    const reply = assistantReplyContent(answer);
    assert.equal(reply.sql, null);
    assert.equal(reply.summary, answer);
});

test('A JSON code fence and partial JSON metadata retain proposed SQL and useful details', () => {
    const content = {
        ...assistantAnswerContent('Updated query.'),
        sql: 'SELECT 2',
        assumptions: ['One row.'],
        tables: ['events'],
        caveats: ['Example.'],
        sources: [{ title: 'Docs', url: 'https://example.com/' }],
        clarification: 'Review first.',
        findings: [{ severity: 'low', message: 'Note.', evidence: 'Evidence.' }],
    };
    assert.deepEqual(
        assistantReplyContent(`\`\`\`json\n${JSON.stringify(content)}\n\`\`\``),
        content,
    );
    assert.equal(
        assistantReplyContent(JSON.stringify({ sql: 'SELECT 3', summary: 'Updated.' })).sql,
        'SELECT 3',
    );
    assert.equal(
        assistantReplyContent({ summary: '```sql\nSELECT 4\n```', sql: 42 }).sql,
        'SELECT 4',
    );
    assert.equal(assistantReplyContent({ unexpected: 1 }).summary, '{\n  "unexpected": 1\n}');
});

test('Normalization is stable when a proposal is reloaded or decided twice', () => {
    for (const text of ['```sql\nSELECT 1\n```', '```sql\nSELECT 1\n```\n```sql\nSELECT 2\n```']) {
        const content = assistantReplyContent(text);
        assert.deepEqual(normalizeAssistantContent(content), content);
    }
});

test('One response can contain any number of SQL blocks without an option contract', () => {
    for (const count of [2, 3, 5, 12]) {
        const sql = Array.from({ length: count }, (_, index) => `SELECT ${index};`);
        const answer = sql.map(query => `\`\`\`sql\n${query}\n\`\`\``).join('\n\n');
        const content = assistantReplyContent(answer);
        assert.equal(content.sql, sql.join('\n\n'));
        assert.equal(Object.hasOwn(content, 'alternatives'), false);
    }
});
