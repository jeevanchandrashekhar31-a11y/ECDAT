import tree_sitter_cpp
import tree_sitter
from typing import List
from pathlib import Path
from scanners.static.ast.base import AstHandler
from scanners.static.results import StaticFinding
from scanners.static.ast.c_handler import C_CRYPTO_QUERY


class CppHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_cpp.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        findings = []
        tree = self.parse(source_code)

        matches = self.run_query(tree, C_CRYPTO_QUERY)

        source_str = source_code.decode("utf-8", errors="replace")
        lines = source_str.split("\n")

        for match in matches:
            captures = match[1]
            if "func_name" in captures and "call" in captures:
                func_node = captures["func_name"][0]
                call_node = captures["call"][0]

                func_name = func_node.text.decode("utf-8")
                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                algo = func_name
                finding_type = "crypto_api_call"
                severity = "medium"
                confidence = "high"
                rule_id = "AST_CPP_API"

                if "md5" in func_name.lower():
                    finding_type = "weak_hash"
                elif (
                    "sha1" in func_name.lower()
                    or "sha" in func_name.lower()
                    and not ("256" in func_name or "512" in func_name)
                ):
                    finding_type = "weak_hash"
                elif "des" in func_name.lower() or "rc4" in func_name.lower():
                    finding_type = "weak_cipher"

                finding = self._create_finding(
                    file_path, root_dir, line_number, rule_id, algo, evidence, confidence, finding_type
                )
                findings.append(finding)

            elif "func_name" in captures and "weak_rand" in captures:
                func_node = captures["func_name"][0]
                call_node = captures["weak_rand"][0]

                func_name = func_node.text.decode("utf-8")
                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                finding = self._create_finding(
                    file_path, root_dir, line_number, "AST_CPP_WEAK_RAND", func_name, evidence, "low", "weak_prng"
                )
                findings.append(finding)

        return findings
