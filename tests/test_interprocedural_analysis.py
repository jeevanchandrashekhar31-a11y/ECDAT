"""
Tests for Phase 2.8: Interprocedural Bounded Data-Flow Analysis.

Verifies:
1. source -> wrapper -> crypto call -> algorithm parameter tracing.
2. Multi-hop wrapper call chains.
3. configuration -> crypto initialization tracing.
4. Explicit complexity limits:
   - max_call_depth
   - max_traversed_functions
   - max_path_length
   - timeout
5. Uncertainty behavior:
   - confidence=LOW on bounds exceeded, unresolved functions, missing configs, dead-ends.
   - Preserves complete evidence collected up to the uncertain point.
6. AST loading from Python source code.
7. Integration with DataFlowProvider (Generic & Python).
"""

import time
import pytest
from scanners.static.ast.dataflow_interprocedural import (
    BoundedDataFlowEngine,
    FunctionSignature,
    CallSite,
    FlowStep,
    InterproceduralTrace,
    MAX_CALL_DEPTH,
    MAX_TRAVERSED_FUNCTIONS,
    MAX_PATH_LENGTH,
)
from scanners.static.ast.adapters import GenericDataFlowProvider
from scanners.static.ast.python_handler import PythonDataFlowProvider


def test_source_wrapper_crypto_call_parameter():
    """
    Test flow:
    source -> wrapper -> crypto call -> algorithm parameter
    """
    engine = BoundedDataFlowEngine(max_call_depth=5)

    # entry_func: process_request(algo) -> calls encrypt_data(algo)
    engine.register_function(
        FunctionSignature(
            name="process_request",
            param_names=["algo"],
            start_line=10,
            end_line=15,
            body_calls=[
                CallSite(callee_name="encrypt_data", arguments=["algo"], line_number=12, snippet="encrypt_data(algo)")
            ],
        )
    )

    # wrapper: encrypt_data(cipher_name) -> calls Cipher.getInstance(cipher_name)
    engine.register_function(
        FunctionSignature(
            name="encrypt_data",
            param_names=["cipher_name"],
            start_line=20,
            end_line=25,
            body_calls=[
                CallSite(
                    callee_name="Cipher.getInstance",
                    arguments=["cipher_name"],
                    line_number=22,
                    snippet="Cipher.getInstance(cipher_name)",
                )
            ],
        )
    )

    trace = engine.trace_parameter_flow(
        entry_func="process_request",
        initial_arg_value="DES/CBC/PKCS5Padding",
        target_crypto_api="Cipher.getInstance",
        param_index=0,
    )

    assert trace.is_certain is True
    assert trace.confidence.upper() == "HIGH"
    assert trace.inferred_algorithm == "DES/CBC/PKCS5Padding"
    assert trace.target_api == "Cipher.getInstance"

    # Step sequence: source -> wrapper -> crypto_call -> param
    node_types = [s.node_type for s in trace.steps]
    assert node_types == ["source", "wrapper", "crypto_call", "param"]

    assert trace.steps[0].name == "process_request"
    assert trace.steps[0].value == "DES/CBC/PKCS5Padding"
    assert trace.steps[1].name == "encrypt_data"
    assert trace.steps[2].name == "Cipher.getInstance"
    assert trace.steps[3].node_type == "param"
    assert trace.steps[3].value == "DES/CBC/PKCS5Padding"

    evidence = trace.format_evidence_path()
    assert "source:process_request='DES/CBC/PKCS5Padding'" in evidence
    assert "wrapper:encrypt_data='DES/CBC/PKCS5Padding'" in evidence
    assert "crypto_call:Cipher.getInstance" in evidence
    assert "param:arg[0]='DES/CBC/PKCS5Padding'" in evidence


def test_multi_hop_wrapper_chain():
    """
    Test flow across multiple wrapper hops:
    source -> wrapper1 -> wrapper2 -> wrapper3 -> crypto call -> algorithm parameter
    """
    engine = BoundedDataFlowEngine(max_call_depth=5)

    engine.register_function(
        FunctionSignature(
            name="api_entry",
            param_names=["alg"],
            start_line=1,
            end_line=5,
            body_calls=[CallSite(callee_name="hop_1", arguments=["alg"], line_number=3, snippet="hop_1(alg)")],
        )
    )
    engine.register_function(
        FunctionSignature(
            name="hop_1",
            param_names=["x"],
            start_line=7,
            end_line=11,
            body_calls=[CallSite(callee_name="hop_2", arguments=["x"], line_number=9, snippet="hop_2(x)")],
        )
    )
    engine.register_function(
        FunctionSignature(
            name="hop_2",
            param_names=["y"],
            start_line=13,
            end_line=17,
            body_calls=[CallSite(callee_name="hop_3", arguments=["y"], line_number=15, snippet="hop_3(y)")],
        )
    )
    engine.register_function(
        FunctionSignature(
            name="hop_3",
            param_names=["z"],
            start_line=19,
            end_line=23,
            body_calls=[CallSite(callee_name="hashlib.new", arguments=["z"], line_number=21, snippet="hashlib.new(z)")],
        )
    )

    trace = engine.trace_parameter_flow(
        entry_func="api_entry",
        initial_arg_value="md5",
        target_crypto_api="hashlib.new",
    )

    assert trace.is_certain is True
    assert trace.confidence.upper() == "HIGH"
    assert trace.inferred_algorithm == "md5"

    node_types = [s.node_type for s in trace.steps]
    assert node_types == ["source", "wrapper", "wrapper", "wrapper", "crypto_call", "param"]
    step_names = [s.name for s in trace.steps]
    assert step_names == ["api_entry", "hop_1", "hop_2", "hop_3", "hashlib.new", "arg[0]"]


def test_configuration_to_crypto_initialization():
    """
    Test flow:
    configuration -> crypto initialization
    """
    engine = BoundedDataFlowEngine(max_call_depth=5)

    # Register configuration item
    engine.register_config(
        key="DEFAULT_CIPHER",
        value="RC4",
        line_number=5,
        snippet="DEFAULT_CIPHER = 'RC4'",
    )

    # Function consuming config
    engine.register_function(
        FunctionSignature(
            name="init_security_context",
            param_names=[],
            start_line=10,
            end_line=20,
            body_calls=[
                CallSite(
                    callee_name="create_cipher_instance",
                    arguments=["DEFAULT_CIPHER"],
                    line_number=15,
                    snippet="create_cipher_instance(DEFAULT_CIPHER)",
                )
            ],
        )
    )

    # Function calling target crypto init
    engine.register_function(
        FunctionSignature(
            name="create_cipher_instance",
            param_names=["algo_name"],
            start_line=22,
            end_line=30,
            body_calls=[
                CallSite(
                    callee_name="EVP_get_cipherbyname",
                    arguments=["algo_name"],
                    line_number=26,
                    snippet="EVP_get_cipherbyname(algo_name)",
                )
            ],
        )
    )

    trace = engine.trace_configuration_flow(
        config_key="DEFAULT_CIPHER",
        target_init_func="EVP_get_cipherbyname",
    )

    assert trace.is_certain is True
    assert trace.confidence.upper() == "HIGH"
    assert trace.inferred_algorithm == "RC4"
    assert trace.target_api == "EVP_get_cipherbyname"

    node_types = [s.node_type for s in trace.steps]
    assert "config" in node_types
    assert "wrapper" in node_types
    assert "crypto_call" in node_types
    assert "param" in node_types

    evidence = trace.format_evidence_path()
    assert "config:DEFAULT_CIPHER='RC4'@L5" in evidence
    assert "crypto_call:EVP_get_cipherbyname" in evidence


def test_complexity_bound_exceeded_depth():
    """
    When call depth bound is exceeded, emit confidence=LOW and preserve evidence.
    """
    engine = BoundedDataFlowEngine(max_call_depth=3)

    # Create a 6-deep wrapper chain
    for i in range(1, 7):
        next_fn = f"fn_{i + 1}" if i < 6 else "crypto_sink"
        engine.register_function(
            FunctionSignature(
                name=f"fn_{i}",
                param_names=["p"],
                start_line=i * 10,
                end_line=i * 10 + 5,
                body_calls=[
                    CallSite(callee_name=next_fn, arguments=["p"], line_number=i * 10 + 2, snippet=f"{next_fn}(p)")
                ],
            )
        )

    trace = engine.trace_parameter_flow(
        entry_func="fn_1",
        initial_arg_value="DES",
        target_crypto_api="crypto_sink",
    )

    assert trace.is_certain is False
    assert trace.confidence.upper() == "LOW"
    assert "maximum call depth" in trace.uncertainty_reason.lower()

    # Crucial: evidence is preserved!
    assert len(trace.steps) >= 3
    evidence = trace.format_evidence_path()
    assert "[UNCERTAIN:" in evidence
    assert "source:fn_1" in evidence


def test_complexity_bound_exceeded_traversed_functions():
    """
    When max_traversed_functions is exceeded, emit confidence=LOW and preserve evidence.
    """
    engine = BoundedDataFlowEngine(max_call_depth=10, max_traversed_functions=2)

    for i in range(1, 5):
        engine.register_function(
            FunctionSignature(
                name=f"fn_{i}",
                param_names=["p"],
                start_line=i * 5,
                end_line=i * 5 + 4,
                body_calls=[
                    CallSite(
                        callee_name=f"fn_{i + 1}", arguments=["p"], line_number=i * 5 + 2, snippet=f"fn_{i + 1}(p)"
                    )
                ],
            )
        )

    trace = engine.trace_parameter_flow(
        entry_func="fn_1",
        initial_arg_value="SHA-1",
        target_crypto_api="target_crypto",
    )

    assert trace.is_certain is False
    assert trace.confidence.upper() == "LOW"
    assert "traversed functions limit" in trace.uncertainty_reason.lower()
    assert len(trace.steps) > 0


def test_complexity_bound_exceeded_timeout():
    """
    When analysis timeout is reached, emit confidence=LOW and preserve evidence.
    """
    engine = BoundedDataFlowEngine(timeout_seconds=0.5)

    engine.register_function(
        FunctionSignature(
            name="slow_start",
            param_names=["x"],
            start_line=1,
            end_line=5,
            body_calls=[CallSite(callee_name="slow_step_2", arguments=["x"], line_number=3, snippet="slow_step_2(x)")],
        )
    )

    # Pass an expired start_time to simulate elapsed time exceeding timeout
    past_start = time.time() - 10.0
    trace = engine.trace_parameter_flow(
        entry_func="slow_start",
        initial_arg_value="AES",
        target_crypto_api="crypto_api",
        start_time=past_start,
    )

    assert trace.is_certain is False
    assert trace.confidence.upper() == "LOW"
    assert "timed out" in trace.uncertainty_reason.lower()
    assert len(trace.steps) > 0


def test_uncertainty_unresolved_function():
    """
    When encountering an unresolved callee / dynamic dispatch, emit confidence=LOW and preserve evidence.
    """
    engine = BoundedDataFlowEngine(max_call_depth=5)

    engine.register_function(
        FunctionSignature(
            name="entry",
            param_names=["algo"],
            start_line=1,
            end_line=5,
            body_calls=[
                CallSite(
                    callee_name="unknown_external_wrapper",
                    arguments=["algo"],
                    line_number=3,
                    snippet="unknown_external_wrapper(algo)",
                )
            ],
        )
    )

    trace = engine.trace_parameter_flow(
        entry_func="entry",
        initial_arg_value="DES",
        target_crypto_api="Cipher.getInstance",
    )

    assert trace.is_certain is False
    assert trace.confidence.upper() == "LOW"
    assert "unresolved function call" in trace.uncertainty_reason.lower()
    assert len(trace.steps) > 0
    assert trace.steps[0].name == "entry"


def test_uncertainty_missing_config():
    """
    When configuration key is not found, emit confidence=LOW.
    """
    engine = BoundedDataFlowEngine()

    trace = engine.trace_configuration_flow(
        config_key="NON_EXISTENT_KEY",
        target_init_func="init_crypto",
    )

    assert trace.is_certain is False
    assert trace.confidence.upper() == "LOW"
    assert "not found" in trace.uncertainty_reason.lower()


def test_python_source_ast_loading():
    """
    Verify automated loading of functions, calls, assignments, and configs from Python source code.
    """
    py_code = """
SSL_CIPHER_SUITE = "RC4-MD5"

def dispatch_crypto(algorithm):
    return run_hash(algorithm)

def run_hash(algo_name):
    return hashlib.new(algo_name)
"""
    engine = BoundedDataFlowEngine()
    engine.load_from_python_source(py_code)

    assert "SSL_CIPHER_SUITE" in engine.configs
    assert engine.configs["SSL_CIPHER_SUITE"]["value"] == "RC4-MD5"
    assert "dispatch_crypto" in engine.functions
    assert "run_hash" in engine.functions

    trace = engine.trace_parameter_flow(
        entry_func="dispatch_crypto",
        initial_arg_value="sha1",
        target_crypto_api="hashlib.new",
    )

    assert trace.is_certain is True
    assert trace.confidence.upper() == "HIGH"
    assert trace.inferred_algorithm == "sha1"
    assert len(trace.steps) == 4
    assert [s.name for s in trace.steps] == ["dispatch_crypto", "run_hash", "hashlib.new", "arg[0]"]


def test_dataflow_providers_integration():
    """
    Verify GenericDataFlowProvider and PythonDataFlowProvider provide interprocedural tracing.
    """
    # 1. GenericDataFlowProvider
    generic_df = GenericDataFlowProvider()
    generic_df.engine.register_function(
        FunctionSignature(
            name="handler",
            param_names=["x"],
            start_line=1,
            end_line=5,
            body_calls=[CallSite(callee_name="crypto_call", arguments=["x"], line_number=3, snippet="crypto_call(x)")],
        )
    )
    trace_gen = generic_df.trace_interprocedural_flow("handler", "AES-256-GCM", "crypto_call")
    assert trace_gen.is_certain is True
    assert trace_gen.confidence.upper() == "HIGH"

    # 2. PythonDataFlowProvider
    py_df = PythonDataFlowProvider()
    py_df.engine.register_config("TLS_VERSION", "TLSv1", 1, "TLS_VERSION = 'TLSv1'")
    py_df.engine.register_function(
        FunctionSignature(
            name="setup_tls",
            param_names=[],
            start_line=10,
            end_line=15,
            body_calls=[
                CallSite(
                    callee_name="ssl.wrap_socket",
                    arguments=["TLS_VERSION"],
                    line_number=12,
                    snippet="ssl.wrap_socket(TLS_VERSION)",
                )
            ],
        )
    )
    trace_py_cfg = py_df.trace_configuration_flow("TLS_VERSION", "ssl.wrap_socket")
    assert trace_py_cfg.is_certain is True
    assert trace_py_cfg.confidence.upper() == "HIGH"
    assert trace_py_cfg.inferred_algorithm == "TLSv1"
