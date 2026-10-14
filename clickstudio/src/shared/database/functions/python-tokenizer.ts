const pattern = [
    String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?`,
    String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?`,
    String.raw`\p{N}{1,3}`,
    String.raw` ?[^\s\p{L}\p{N}]+[\r\n/]*`,
    String.raw`\s*[\r\n]+`,
    String.raw`\s+(?!\S)`,
    String.raw`\s+`,
].join('|');

export const TOKENIZER_SOURCE = `import base64
import json
import tiktoken

config = json.loads(${JSON.stringify(
    JSON.stringify({
        name: 'o200k_base',
        pat_str: pattern,
        special_tokens: { '<|endoftext|>': 199999, '<|endofprompt|>': 200018 },
    }),
)})
ranks = {
    base64.b64decode(token): int(rank)
    for token, rank in (
        line.split() for line in read_asset("o200k_base.tiktoken").splitlines() if line
    )
}
encoding = tiktoken.Encoding(mergeable_ranks=ranks, **config)

def transform(text):
    return len(encoding.encode_ordinary(text))
`;
