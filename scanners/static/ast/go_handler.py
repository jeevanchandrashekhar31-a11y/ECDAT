import tree_sitter_go
import tree_sitter
from typing import List
from pathlib import Path
from scanners.static.ast.base import AstHandler
from scanners.static.results import StaticFinding

GO_CRYPTO_QUERY = """
(call_expression
  function: (selector_expression
    operand: (identifier) @pkg
    field: (field_identifier) @func_name)
  (#match? @pkg "^(md5|sha1|sha256|rsa|ecdsa|elliptic|tls|x509|rand)$")
  (#match? @func_name "^(New|GenerateKey|Config|CreateCertificate)$")
) @call

(import_spec
  path: (interpreted_string_literal) @import_path
  (#match? @import_path "crypto/(md5|sha1|sha256|rsa|ecdsa|elliptic|tls|x509|rand)")
) @import
"""


class GoHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_go.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        findings = []
        tree = self.parse(source_code)

        matches = self.run_query(tree, GO_CRYPTO_QUERY)

        source_str = source_code.decode("utf-8", errors="replace")
        lines = source_str.split("\n")

        for match in matches:
            captures = match[1]
            if "func_name" in captures and "call" in captures:
                func_node = captures["func_name"][0]
                pkg_node = captures["pkg"][0]
                call_node = captures["call"][0]

                func_name = f"{pkg_node.text.decode('utf-8')}.{func_node.text.decode('utf-8')}"
                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                algo = func_name
                finding_type = "crypto_api_call"
                confidence = "high"
                rule_id = "AST_GO_API"

                if "md5" in func_name.lower():
                    finding_type = "weak_hash"
                elif "sha1" in func_name.lower():
                    finding_type = "weak_hash"

                finding = self._create_finding(
                    file_path, root_dir, line_number, rule_id, algo, evidence, confidence, finding_type
                )
                findings.append(finding)

            elif "import_path" in captures:
                node = captures["import_path"][0]
                line_number = node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()
                path_val = node.text.decode("utf-8").strip('"')

                rule_id = "AST_GO_IMPORT"
                finding = self._create_finding(
                    file_path, root_dir, line_number, rule_id, path_val, evidence, "medium", "crypto_library"
                )
                findings.append(finding)

        return findings
