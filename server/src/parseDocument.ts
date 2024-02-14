
import { ElemSource, RakuDocument, RakuElem, RakuSymbolKind} from "./types";
import Uri from "vscode-uri";


export async function buildNav(stdout: string, fileuri: string): Promise<RakuDocument> {

    stdout = stdout.replace(/\r/g, ""); // Windows 

    let RakuDoc: RakuDocument = {
            elems: new Map(),
            canonicalElems: new Map(),
            imported: new Map(),
            parents: new Map(),
            uri: fileuri,
        };

    stdout.split("\n").forEach(Raku_elem => {
        parseElem(Raku_elem, RakuDoc);
    });
    
    return RakuDoc;
}


function parseElem(RakuTag: string, RakuDoc: RakuDocument): void {

    var items = RakuTag.split('\t');

    if(items.length != 5){
        return;
    }
    if (!items[0] || items[0]=='_') return; // Need a look-up key

    const name       = items[0];
    const type       = items[1] || ""; 
    const details    = items[2] || ""; 
    const file       = items[3] || ""; 
    const lines      = items[4].split(';');

    const startLine  = lines[0] ? +lines[0] : 0;
    const endLine    = lines[1] ? +lines[1] : startLine;

    const newElem: RakuElem = {
        name: name,
        type: type as RakuSymbolKind,
        uri: Uri.file(file).toString(),
        line: startLine,
        lineEnd: endLine,
        source: ElemSource.symbolTable,
        package: "",
    };

    addVal(RakuDoc.elems, name, newElem);

    return;
}

function addVal (map: Map<string, any[]>, key: string, value: any) {
    let array = map.get(key) || [];
    array.push(value)
    map.set(key, array);
}