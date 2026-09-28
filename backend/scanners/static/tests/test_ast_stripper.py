import pytest
from scanners.static.ast.base import AstHandler
import tree_sitter

# Assuming we have access to some tree-sitter language for testing, let's say python.
# If python isn't available, we can mock it, but we can try with a real one if ECDAT has it installed.

def test_strip_comments_strings(monkeypatch):
    # We will mock the language if needed. 
    # For now, let's assume we implement a generic recursive stripper in base.py
    # that removes nodes based on type.
    
    pass
