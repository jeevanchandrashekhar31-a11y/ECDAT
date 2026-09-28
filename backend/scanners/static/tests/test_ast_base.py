import pytest
from scanners.static.ast.base import AstHandler

class MockASTParser(AstHandler):
    # Minimal mock implementation to test base functionality
    def __init__(self):
        # Do not call super().__init__() directly if it requires language-specific binaries,
        # we just want to test the base methods.
        self.import_aliases = {}
        pass

    def add_alias(self, alias: str, fqn: str):
        self.import_aliases[alias] = fqn

    def resolve_alias(self, symbol: str) -> str:
        return self._resolve_fqn(symbol)

def test_ast_base_resolve_fqn():
    parser = MockASTParser()
    parser.add_alias("crypto", "node:crypto")
    parser.add_alias("createCipheriv", "node:crypto.createCipheriv")

    # Exact match
    assert parser.resolve_alias("crypto") == "node:crypto"
    assert parser.resolve_alias("createCipheriv") == "node:crypto.createCipheriv"

    # Dot property resolution
    assert parser.resolve_alias("crypto.createCipheriv") == "node:crypto.createCipheriv"
    assert parser.resolve_alias("crypto.submodule.func") == "node:crypto.submodule.func"
    
    # No match
    assert parser.resolve_alias("unknown") == "unknown"
    assert parser.resolve_alias("unknown.func") == "unknown.func"
