const replaceCodeBlocksToTripleQuotes = (text) => {
    return text.replace(/```(.*?)```/g, (match) => {
        const inner = match.replace(/```/g, "")
        return `"""${inner}"""`;
    });
}
const replaceTripleQuotesToCodeBlocks = (text) => {
    return text.replace(/"""(.*?)"""/g, (match, inner) => {
        return `\`\`\`${inner}\`\`\``;
    });
};
const restoreTripleQuotesInObject = (obj) => {
    if (typeof obj === 'string') {
        return replaceTripleQuotesToCodeBlocks(obj);
    } else if (Array.isArray(obj)) {
        return obj.map(restoreTripleQuotesInObject);
    } else if (obj !== null && typeof obj === 'object') {
        const restored = {};
        for (const key in obj) {
            restored[key] = restoreTripleQuotesInObject(obj[key]);
        }
        return restored;
    } else {
        return obj;
    }
}
const text = "{\"text\": '```javascript\nlet fruits = [];```'}"

const json = text.startsWith("```json")
    ? text.trim().split(/```json/)[1]
    : text.trim();

const escapedJson = json
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (_match, capturedGroup) => {
        const escapedInsideQuotes = replaceCodeBlocksToTripleQuotes(capturedGroup.replace(/\n/g, "\\n"));
        return `"${escapedInsideQuotes}"`;
    })
    .replace(/\n/g, "");
console.log(restoreTripleQuotesInObject(JSON.parse(escapedJson)));