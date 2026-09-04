import tree_sitter_c
import tree_sitter
from typing import List
from pathlib import Path
from scanners.static.ast.base import AstHandler
from scanners.static.results import StaticFinding

C_CRYPTO_QUERY = """
(call_expression
  function: (identifier) @func_name
  (#match? @func_name "^(EVP_md5|EVP_sha1|EVP_sha224|EVP_sha256|EVP_sha384|EVP_sha512|EVP_aes_.*|EVP_des_.*|EVP_rc4|EVP_PKEY_.*|RSA_generate_key_ex|RSA_new|EC_KEY_new_by_curve_name|DH_.*|PEM_read_.*PrivateKey|PEM_write_.*PrivateKey|SSL_CTX_new|TLS_method|mbedtls_md5|mbedtls_sha1|mbedtls_sha256|mbedtls_rsa_gen_key|mbedtls_ecp_group_load|mbedtls_ssl_config_defaults|mbedtls_ssl_conf_ciphersuites|wc_Md5Hash|wc_Sha|wc_RsaKeyGen|wolfSSL_CTX_new)$")
) @call

(call_expression
  function: (identifier) @func_name
  (#match? @func_name "^(rand|srand)$")
) @weak_rand
"""


class CHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_c.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        findings = []
        tree = self.parse(source_code)

        matches = self.run_query(tree, C_CRYPTO_QUERY)

        source_str = source_code.decode("utf-8", errors="replace")
        lines = source_str.split("\n")

        for match in matches:
            # match is a tuple: (pattern_index, captures_dict)
            captures = match[1]
            if "func_name" in captures and "call" in captures:
                func_node = captures["func_name"][0]
                call_node = captures["call"][0]

                func_name = func_node.text.decode("utf-8")
                line_number = call_node.start_point[0] + 1
                evidence = lines[line_number - 1].strip()

                # Check for inactive code (basic check - could be improved)
                # Tree-sitter C grammar puts preprocessor #if 0 blocks into `preproc_if` nodes,
                # but if they are inactive they might just be parsed as text or we can ignore them if needed.
                # True awareness needs full preprocessor.

                algo = func_name
                finding_type = "crypto_api_call"
                severity = "medium"
                confidence = "high"
                rule_id = "AST_C_API"

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
                    file_path, root_dir, line_number, "AST_C_WEAK_RAND", func_name, evidence, "low", "weak_prng"
                )
                findings.append(finding)

        return findings
