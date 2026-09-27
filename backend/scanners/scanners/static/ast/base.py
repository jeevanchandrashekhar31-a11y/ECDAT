from typing import List, Dict, Any, Optional
from pathlib import Path
from scanners.static.results import StaticFinding
import tree_sitter


class AstHandler:
    def __init__(self, language: tree_sitter.Language):
        self.language = language
        self.parser = tree_sitter.Parser(self.language)

    def parse(self, source_code: bytes) -> tree_sitter.Tree:
        return self.parser.parse(source_code)

    def run_query(self, tree: tree_sitter.Tree, query_str: str) -> list:
        query = tree_sitter.Query(self.language, query_str)
        cursor = tree_sitter.QueryCursor(query)
        matches = cursor.matches(tree.root_node)
        return matches

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        raise NotImplementedError("Must be implemented by subclasses")

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
        )
