import tree_sitter_javascript
import tree_sitter
from typing import List
from pathlib import Path
from scanners.static.ast.base import AstHandler
from scanners.static.results import StaticFinding

JS_CRYPTO_QUERY = """
(call_expression
  function: (identifier) @func_name
  arguments: (arguments (string) @algo)
  (#match? @func_name "^(createHash|createCipher|createDecipher|createSign|createVerify)$")
) @call

(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @func_name)
  (#match? @obj "^(crypto|webcrypto|subtle)$")
  (#match? @func_name "^(createHash|createCipher|createDecipher|createSign|createVerify|digest|sign|verify|encrypt|decrypt)$")
) @member_call

(call_expression
  function: (identifier) @req
  arguments: (arguments (string) @pkg)
  (#match? @req "^require$")
  (#match? @pkg "(crypto|crypto-js|node-forge)")
) @require

(import_statement
  source: (string) @pkg
  (#match? @pkg "(crypto|crypto-js|node-forge)")
) @import
"""


class JavascriptHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_javascript.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        findings = []
        tree = self.parse(source_code)

        matches = self.run_query(tree, JS_CRYPTO_QUERY)

        source_str = source_code.decode("utf-8", errors="replace")
        lines = source_str.split("\n")

        for match in matches:
            captures = match[1]
            if "func_name" in captures and "algo" in captures and "call" in captures:
                func_node = captures["func_name"][0]
                algo_node = captures["algo"][0]
                call_node = captures["call"][0]

                func_name = func_node.text.decode("utf-8")
                algo_val = algo_node.text.decode("utf-8").strip("'\"")

                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                finding_type = "crypto_api_call"
                if "md5" in algo_val.lower() or "sha1" in algo_val.lower():
                    finding_type = "weak_hash"

                finding = self._create_finding(
                    file_path,
                    root_dir,
                    line_number,
                    "AST_JS_API",
                    f"{func_name}({algo_val})",
                    evidence,
                    "high",
                    finding_type,
                )
                findings.append(finding)

            elif "func_name" in captures and "member_call" in captures:
                func_node = captures["func_name"][0]
                obj_node = captures["obj"][0]
                call_node = captures["member_call"][0]

                func_name = f"{obj_node.text.decode('utf-8')}.{func_node.text.decode('utf-8')}"
                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                finding = self._create_finding(
                    file_path, root_dir, line_number, "AST_JS_API", func_name, evidence, "high", "crypto_api_call"
                )
                findings.append(finding)

            elif "pkg" in captures and ("require" in captures or "import" in captures):
                pkg_node = captures["pkg"][0]
                line_number = pkg_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()
                pkg_val = pkg_node.text.decode("utf-8").strip("'\"")

                finding = self._create_finding(
                    file_path, root_dir, line_number, "AST_JS_IMPORT", pkg_val, evidence, "medium", "crypto_library"
                )
                findings.append(finding)

        return findings
