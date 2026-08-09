"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileMysqlIdentifiers = compileMysqlIdentifiers;
function compileMysqlIdentifiers(query) {
    let out = "";
    let inSingle = false;
    for (let index = 0; index < query.length; index += 1) {
        const char = query[index];
        const next = query[index + 1];
        if (char === "'" && !inSingle) {
            inSingle = true;
            out += char;
            continue;
        }
        if (char === "'" && inSingle) {
            out += char;
            if (next === "'") {
                out += next;
                index += 1;
            }
            else {
                inSingle = false;
            }
            continue;
        }
        out += !inSingle && char === '"' ? "`" : char;
    }
    return out;
}
