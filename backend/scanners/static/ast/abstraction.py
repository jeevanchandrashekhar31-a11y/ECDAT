"""
ECDAT Multi-Language Parser Abstraction
Defines formal interfaces and base implementations for:
- LanguageAdapter
- Parser
- ASTNormalizer
- CryptoRuleProvider
- DataFlowProvider

Each adapter explicitly declares:
- language
- supported versions
- parser version
- supported crypto APIs
- unsupported constructs
- confidence behavior
- tested corpus
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter

from scanners.domain.errors import ParserFailureError
from scanners.static.results import StaticFinding


# =====================================================================
# Normalized AST Representation
# =====================================================================
@dataclass(frozen=True)
class NormalizedCallNode:
    callee: str
    arguments: List[Any]
    line_number: int
    raw_snippet: str
    context_qualifier: Optional[str] = None


@dataclass(frozen=True)
class NormalizedAssignmentNode:
    variable_name: str
    value: Any
    inferred_type: str
    line_number: int


@dataclass(frozen=True)
class CryptoDetectionRule:
    rule_id: str
    algorithm: str
    target_api: str
    finding_type: str
    severity: str
    confidence: str
    key_size_arg_index: Optional[int] = None


# =====================================================================
# Abstract Interfaces
# =====================================================================
class Parser(ABC):
    """Abstract parser encapsulating tree-sitter or native parser execution."""

    @abstractmethod
    def parse(self, source_bytes: bytes) -> tree_sitter.Tree:
        """Parses source bytes into an AST tree; raises ParserFailureError on fatal error."""
        pass


class ASTNormalizer(ABC):
    """Abstract normalizer transforming language-specific AST nodes into unified representation."""

    @abstractmethod
    def extract_function_calls(self, tree: tree_sitter.Tree, source_bytes: bytes) -> List[NormalizedCallNode]:
        pass

    @abstractmethod
    def extract_assignments(self, tree: tree_sitter.Tree, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        pass


class CryptoRuleProvider(ABC):
    """Provides language-specific detection rules and API signatures."""

    @abstractmethod
    def get_rules(self) -> List[CryptoDetectionRule]:
        pass


class DataFlowProvider(ABC):
    """Performs intra-procedural constant propagation and interprocedural data-flow tracking."""

    @abstractmethod
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        pass

    def trace_interprocedural_flow(
        self,
        entry_func: str,
        initial_arg_value: Any,
        target_crypto_api: str,
        param_index: int = 0,
    ) -> Any:
        """Traces parameter across wrappers down to crypto call."""
        return None


# =====================================================================
# Base Language Adapter
# =====================================================================
class LanguageAdapter(ABC):
    """
    Abstract Language Adapter for Static Cryptographic Discovery.
    Declares metadata and capabilities.
    """

    # Mandatory Declarations
    language: str
    supported_versions: List[str]
    parser_version: str
    supported_crypto_apis: List[str]
    unsupported_constructs: List[str]
    confidence_behavior: Dict[str, str]
    tested_corpus: List[str]

    @abstractmethod
    def get_parser(self) -> Parser:
        pass

    @abstractmethod
    def get_ast_normalizer(self) -> ASTNormalizer:
        pass

    @abstractmethod
    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        pass

    @abstractmethod
    def get_data_flow_provider(self) -> DataFlowProvider:
        pass

    @abstractmethod
    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        """Extracts cryptographic findings using the adapter toolchain."""
        pass

    def get_capabilities(self) -> Dict[str, Any]:
        """Returns structured capability declaration for this language adapter."""
        return {
            "language": self.language,
            "supported_versions": list(self.supported_versions),
            "parser_version": self.parser_version,
            "supported_crypto_apis": list(self.supported_crypto_apis),
            "unsupported_constructs": list(self.unsupported_constructs),
            "confidence_behavior": dict(self.confidence_behavior),
            "tested_corpus": list(self.tested_corpus),
        }
