import tree_sitter
import tree_sitter_c
import tree_sitter_cpp
import tree_sitter_go
import tree_sitter_javascript
from pathlib import Path
from typing import List

from scanners.models import CodeCryptoFinding

LANGUAGES = {
    ".c": tree_sitter.Language(tree_sitter_c.language()),
    ".h": tree_sitter.Language(tree_sitter_c.language()),
    ".cpp": tree_sitter.Language(tree_sitter_cpp.language()),
    ".hpp": tree_sitter.Language(tree_sitter_cpp.language()),
    ".go": tree_sitter.Language(tree_sitter_go.language()),
    ".js": tree_sitter.Language(tree_sitter_javascript.language()),
}

QUERIES = {
    ".go": """
        (call_expression
            function: (selector_expression
                operand: (identifier) @pkg
                field: (field_identifier) @func)
            (#eq? @pkg "md5")
            (#eq? @func "New")
        ) @md5_usage
        
        (call_expression
            function: (selector_expression
                operand: (identifier) @pkg
                field: (field_identifier) @func)
            (#eq? @pkg "sha1")
            (#eq? @func "New")
        ) @sha1_usage
    """,
    ".js": """
        (call_expression
            function: (member_expression
                object: (identifier) @obj
                property: (property_identifier) @prop)
            arguments: (arguments (string (string_fragment) @algo))
            (#eq? @obj "crypto")
            (#eq? @prop "createHash")
            (#match? @algo "^(?i)(md5|sha1)$")
        ) @hash_usage
    """,
}


def scan_file_ast(path: Path, root: Path) -> List[CodeCryptoFinding]:
    ext = path.suffix.lower()
    if ext not in LANGUAGES or ext not in QUERIES:
        return []

    try:
        text = path.read_bytes()
    except Exception:
        return []

    parser = tree_sitter.Parser(LANGUAGES[ext])
    tree = parser.parse(text)

    query = LANGUAGES[ext].query(QUERIES[ext])
    captures = query.captures(tree.root_node)

    findings = []
    rel = str(path.relative_to(root)).replace("\\", "/")
    lang_name = ext.lstrip(".").upper()

    for capture_name, nodes in captures.items():
        for node in nodes:
            algo = "MD5"
            if capture_name == "sha1_usage":
                algo = "SHA1"
            elif capture_name == "hash_usage":
                node_text = node.text.decode("utf-8").lower()
                algo = "SHA1" if "sha1" in node_text else "MD5"

            line = node.start_point[0] + 1
            findings.append(
                CodeCryptoFinding(
                    bom_ref=f"code:ast/{algo.lower()}@{rel}:{line}",
                    file_path=rel,
                    language=lang_name,
                    line=line,
                    algorithm=algo,
                    finding_type="algorithm",
                    confidence="high",
                    library="stdlib",
                )
            )

    return findings
