from typing import List, Dict, Any, Optional
from pathlib import Path
from scanners.static.results import StaticFinding
import tree_sitter


class AstHandler:
    def __init__(self, language: tree_sitter.Language):
        self.language = language
        self.parser = tree_sitter.Parser(self.language)
        self.import_aliases: Dict[str, str] = {}

    def parse(self, source_code: bytes) -> tree_sitter.Tree:
        return self.parser.parse(source_code)

    def run_query(self, tree: tree_sitter.Tree, query_str: str) -> list:
        query = tree_sitter.Query(self.language, query_str)
        cursor = tree_sitter.QueryCursor(query)
        matches = cursor.matches(tree.root_node)
        return matches

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        raise NotImplementedError("Must be implemented by subclasses")

    def strip_comments_and_strings(self, node: tree_sitter.Node, source_code: bytes, string_types: set, comment_types: set) -> bytes:
        """
        Recursively extracts source code but replaces comments and strings with whitespace 
        of the same length to preserve line and column offsets for accurate reporting.
        """
        result = bytearray(source_code)
        
        def traverse(n: tree_sitter.Node):
            if n.type in string_types or n.type in comment_types:
                # Replace with spaces (preserve newlines if multiline)
                for i in range(n.start_byte, n.end_byte):
                    if result[i] != 10:  # 10 is '\n'
                        result[i] = 32   # 32 is ' '
            else:
                for child in n.children:
                    traverse(child)

        traverse(node)
        return bytes(result)

    def _resolve_fqn(self, symbol: str) -> str:
        """
        Resolves a symbol to its fully qualified name based on the current file's import aliases.
        """
        parts = symbol.split('.')
        base = parts[0]
        if base in self.import_aliases:
            resolved_base = self.import_aliases[base]
            if len(parts) > 1:
                return f"{resolved_base}.{'.'.join(parts[1:])}"
            return resolved_base
        
        # If the symbol itself matches exactly
        if symbol in self.import_aliases:
            return self.import_aliases[symbol]
            
        return symbol

    def _create_finding(
        self,
        file_path: Path,
        root_dir: Path,
        line_number: int,
        rule_id: str,
        algorithm: str,
        evidence: str,
        confidence: str,
        finding_type: str,
        evidence_tier: Optional[str] = None,
        resolution_trace: Optional[str] = None,
        reachability: Optional[str] = None,
    ) -> StaticFinding:
        rel_path = str(file_path.relative_to(root_dir))
        return StaticFinding(
            file_path=rel_path,
            line_number=line_number,
            rule_id=rule_id,
            algorithm=algorithm,
            evidence=evidence.strip(),
            confidence=confidence,
            finding_type=finding_type,
            evidence_tier=evidence_tier,
            resolution_trace=resolution_trace,
            reachability=reachability,
        )
