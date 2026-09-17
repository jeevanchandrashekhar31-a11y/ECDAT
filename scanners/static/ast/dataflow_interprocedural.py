"""
ECDAT Bounded Interprocedural Data-Flow Analysis Engine (Phase 2.8)

Traces:
1. source -> wrapper -> crypto call -> algorithm parameter
2. configuration -> crypto initialization

Features:
- Interprocedural Call Graph & Forward/Backward Parameter Tainting.
- Interprocedural Configuration-to-Crypto Binding.
- Explicit Complexity Limits:
  * MAX_CALL_DEPTH = 5
  * MAX_TRAVERSED_FUNCTIONS = 50
  * MAX_PATH_LENGTH = 10
  * TIMEOUT_MS = 2000
- Uncertainty Fallback:
  * Emits confidence="low" when data-flow resolution exceeds depth, enters unbounded dynamic dispatch,
    or contains ambiguous branching, while preserving complete evidence trace.
"""

import ast
from dataclasses import dataclass, field
import time
from typing import Any, Dict, List, Optional, Set, Tuple


MAX_CALL_DEPTH = 5
MAX_TRAVERSED_FUNCTIONS = 50
MAX_PATH_LENGTH = 10
MAX_ANALYSIS_TIME_SECONDS = 2.0


@dataclass
class FlowStep:
    node_type: str  # "source", "wrapper", "config", "crypto_call", "param"
    name: str
    line_number: int
    snippet: str
    value: Optional[Any] = None


@dataclass
class InterproceduralTrace:
    is_certain: bool
    confidence: str  # "HIGH", "MEDIUM", "LOW"
    steps: List[FlowStep] = field(default_factory=list)
    inferred_algorithm: Optional[str] = None
    target_api: Optional[str] = None
    uncertainty_reason: Optional[str] = None

    def format_evidence_path(self) -> str:
        parts = []
        for s in self.steps:
            val_str = f"='{s.value}'" if s.value is not None else ""
            parts.append(f"{s.node_type}:{s.name}{val_str}@L{s.line_number}")
        path_str = " -> ".join(parts)
        if not self.is_certain:
            path_str += f" [UNCERTAIN: {self.uncertainty_reason}]"
        return path_str


@dataclass
class FunctionSignature:
    name: str
    param_names: List[str]
    start_line: int
    end_line: int
    body_calls: List["CallSite"] = field(default_factory=list)
    body_assignments: Dict[str, Any] = field(default_factory=dict)
    returns: List[str] = field(default_factory=list)


@dataclass
class CallSite:
    callee_name: str
    arguments: List[Any]  # Can be literal or parameter/variable reference
    line_number: int
    snippet: str


class BoundedDataFlowEngine:
    """
    Performs interprocedural data-flow tracking with explicit bounds and uncertainty emission.
    """

    def __init__(
        self,
        max_call_depth: int = MAX_CALL_DEPTH,
        max_traversed_functions: int = MAX_TRAVERSED_FUNCTIONS,
        max_path_length: int = MAX_PATH_LENGTH,
        timeout_seconds: float = MAX_ANALYSIS_TIME_SECONDS,
    ):
        self.max_call_depth = max_call_depth
        self.max_traversed_functions = max_traversed_functions
        self.max_path_length = max_path_length
        self.timeout_seconds = timeout_seconds

        self.functions: Dict[str, FunctionSignature] = {}
        self.configs: Dict[str, Any] = {}
        self.traversed_count = 0
        self.start_time = 0.0

    def register_function(self, fn: FunctionSignature):
        self.functions[fn.name] = fn

    def register_config(self, key: str, value: Any, line_number: int, snippet: str):
        self.configs[key] = {
            "value": value,
            "line_number": line_number,
            "snippet": snippet,
        }

    def load_from_python_source(self, source_code: str) -> None:
        """
        Parses Python source code and automatically populates functions, calls,
        assignments, and top-level configuration values into the engine.
        """
        try:
            tree = ast.parse(source_code)
        except Exception:
            return

        lines = source_code.split("\n")

        def get_snippet(line_no: int) -> str:
            if 1 <= line_no <= len(lines):
                return lines[line_no - 1].strip()
            return ""

        def resolve_expr_name(expr: ast.AST) -> str:
            if isinstance(expr, ast.Name):
                return expr.id
            elif isinstance(expr, ast.Attribute):
                parent = resolve_expr_name(expr.value)
                return f"{parent}.{expr.attr}" if parent else expr.attr
            elif isinstance(expr, ast.Constant):
                return str(expr.value)
            return "<expr>"

        def resolve_literal_val(expr: ast.AST) -> Any:
            if isinstance(expr, ast.Constant):
                return expr.value
            elif isinstance(expr, ast.Name):
                return expr.id
            elif isinstance(expr, ast.Dict):
                d = {}
                for k, v in zip(expr.keys, expr.values):
                    k_val = resolve_literal_val(k) if k else None
                    if k_val:
                        d[str(k_val)] = resolve_literal_val(v)
                return d
            return None

        # 1. Top-level assignments (configurations)
        for node in tree.body:
            if isinstance(node, ast.Assign):
                val = resolve_literal_val(node.value)
                line_no = node.lineno
                snippet = get_snippet(line_no)
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        self.register_config(t.id, val, line_no, snippet)

        # 2. Function definitions
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_name = node.name
                param_names = [arg.arg for arg in node.args.args]
                start_l = node.lineno
                end_l = getattr(node, "end_lineno", node.lineno)
                body_calls: List[CallSite] = []
                body_assigns: Dict[str, Any] = {}
                returns: List[str] = []

                for inner in ast.walk(node):
                    if inner is node:
                        continue
                    if isinstance(inner, ast.Assign):
                        val = resolve_literal_val(inner.value)
                        for t in inner.targets:
                            if isinstance(t, ast.Name):
                                body_assigns[t.id] = val if val is not None else resolve_expr_name(inner.value)
                    elif isinstance(inner, ast.Call):
                        callee = resolve_expr_name(inner.func)
                        args = []
                        for a in inner.args:
                            lit = resolve_literal_val(a)
                            args.append(lit if lit is not None else resolve_expr_name(a))
                        body_calls.append(
                            CallSite(
                                callee_name=callee,
                                arguments=args,
                                line_number=inner.lineno,
                                snippet=get_snippet(inner.lineno),
                            )
                        )
                    elif isinstance(inner, ast.Return) and inner.value:
                        returns.append(resolve_expr_name(inner.value))

                self.register_function(
                    FunctionSignature(
                        name=fn_name,
                        param_names=param_names,
                        start_line=start_l,
                        end_line=end_l,
                        body_calls=body_calls,
                        body_assignments=body_assigns,
                        returns=returns,
                    )
                )

    # =========================================================================
    # 1. Source -> Wrapper -> Crypto Call -> Algorithm Parameter
    # =========================================================================

    def trace_parameter_flow(
        self,
        entry_func: str,
        initial_arg_value: Any,
        target_crypto_api: str,
        param_index: int = 0,
        start_time: Optional[float] = None,
    ) -> InterproceduralTrace:
        """
        Traces a parameter from its origin, through wrapper functions, down to a crypto call.
        """
        self.traversed_count = 0
        self.start_time = start_time if start_time is not None else time.time()
        trace = InterproceduralTrace(is_certain=True, confidence="HIGH", target_api=target_crypto_api)

        step_source = FlowStep(
            node_type="source",
            name=entry_func,
            line_number=self.functions[entry_func].start_line if entry_func in self.functions else 1,
            snippet=f"Source input value: {initial_arg_value}",
            value=initial_arg_value,
        )
        trace.steps.append(step_source)

        curr_func_name = entry_func
        curr_val = initial_arg_value
        visited_functions: Set[str] = set()

        depth = 0
        while depth < self.max_call_depth:
            # Complexity Limits check
            if (time.time() - self.start_time) >= self.timeout_seconds:
                trace.is_certain = False
                trace.confidence = "LOW"
                trace.uncertainty_reason = "Analysis timed out exceeding execution bound"
                break

            if self.traversed_count >= self.max_traversed_functions:
                trace.is_certain = False
                trace.confidence = "LOW"
                trace.uncertainty_reason = f"Traversed functions limit ({self.max_traversed_functions}) exceeded"
                break

            if len(trace.steps) >= self.max_path_length:
                trace.is_certain = False
                trace.confidence = "LOW"
                trace.uncertainty_reason = f"Maximum path length ({self.max_path_length}) exceeded"
                break

            if curr_func_name not in self.functions:
                # Reached external or unresolved function
                if curr_func_name == target_crypto_api:
                    trace.steps.append(
                        FlowStep(
                            node_type="crypto_call",
                            name=curr_func_name,
                            line_number=trace.steps[-1].line_number if trace.steps else 1,
                            snippet=f"Crypto API invoked: {curr_func_name}",
                            value=curr_val,
                        )
                    )
                    trace.inferred_algorithm = str(curr_val)
                    return trace
                else:
                    trace.is_certain = False
                    trace.confidence = "LOW"
                    trace.uncertainty_reason = f"Unresolved function call: {curr_func_name}"
                    break

            fn = self.functions[curr_func_name]
            visited_functions.add(curr_func_name)
            self.traversed_count += 1

            # Check if this function directly invokes the target crypto API
            direct_call = None
            for call in fn.body_calls:
                if call.callee_name == target_crypto_api:
                    direct_call = call
                    break

            if direct_call:
                # Found crypto call inside current wrapper
                # Resolve argument passed to crypto call
                arg_val = curr_val
                if direct_call.arguments:
                    raw_arg = (
                        direct_call.arguments[param_index]
                        if param_index < len(direct_call.arguments)
                        else direct_call.arguments[0]
                    )
                    # If raw_arg references a local assignment in this function
                    if raw_arg in fn.body_assignments:
                        arg_val = fn.body_assignments[raw_arg]
                    elif raw_arg in fn.param_names:
                        # Value forwarded directly from caller
                        arg_val = curr_val
                    else:
                        arg_val = raw_arg

                trace.steps.append(
                    FlowStep(
                        node_type="crypto_call",
                        name=target_crypto_api,
                        line_number=direct_call.line_number,
                        snippet=direct_call.snippet,
                        value=arg_val,
                    )
                )
                trace.steps.append(
                    FlowStep(
                        node_type="param",
                        name=f"arg[{param_index}]",
                        line_number=direct_call.line_number,
                        snippet=f"Resolved algorithm parameter: {arg_val}",
                        value=arg_val,
                    )
                )
                trace.inferred_algorithm = str(arg_val)
                return trace

            # Otherwise, find next downstream wrapper call
            next_call = None
            for call in fn.body_calls:
                if call.callee_name in self.functions and call.callee_name not in visited_functions:
                    next_call = call
                    break

            if next_call is None:
                # If there are calls, but none are in self.functions or target, report unresolved function call
                unresolved = [
                    c.callee_name
                    for c in fn.body_calls
                    if c.callee_name != target_crypto_api and c.callee_name not in visited_functions
                ]
                trace.is_certain = False
                trace.confidence = "LOW"
                if unresolved:
                    trace.uncertainty_reason = f"Unresolved function call: {unresolved[0]}"
                else:
                    trace.uncertainty_reason = f"Dead-end wrapper {curr_func_name} without target crypto call"
                break

            # Forward parameter to next wrapper
            forwarded_val = curr_val
            if next_call.arguments:
                arg_expr = next_call.arguments[0]
                if arg_expr in fn.body_assignments:
                    forwarded_val = fn.body_assignments[arg_expr]
                elif arg_expr in fn.param_names:
                    forwarded_val = curr_val
                else:
                    forwarded_val = arg_expr

            trace.steps.append(
                FlowStep(
                    node_type="wrapper",
                    name=next_call.callee_name,
                    line_number=next_call.line_number,
                    snippet=next_call.snippet,
                    value=forwarded_val,
                )
            )
            curr_func_name = next_call.callee_name
            curr_val = forwarded_val
            depth += 1

        if depth >= self.max_call_depth:
            trace.is_certain = False
            trace.confidence = "LOW"
            trace.uncertainty_reason = f"Exceeded maximum call depth ({self.max_call_depth})"

        return trace

    # =========================================================================
    # 2. Configuration -> Crypto Initialization
    # =========================================================================

    def trace_configuration_flow(
        self,
        config_key: str,
        target_init_func: str,
    ) -> InterproceduralTrace:
        """
        Traces a configuration item into a cryptographic initialization routine.
        """
        self.start_time = time.time()
        self.traversed_count = 0
        trace = InterproceduralTrace(is_certain=True, confidence="HIGH", target_api=target_init_func)

        if config_key not in self.configs:
            trace.is_certain = False
            trace.confidence = "LOW"
            trace.uncertainty_reason = f"Configuration key '{config_key}' not found in registry"
            return trace

        cfg = self.configs[config_key]
        trace.steps.append(
            FlowStep(
                node_type="config",
                name=config_key,
                line_number=cfg["line_number"],
                snippet=cfg["snippet"],
                value=cfg["value"],
            )
        )

        cfg_val = cfg["value"]

        # Search which function consumes this configuration
        consumer_func = None
        consumer_call = None

        for fn_name, fn in self.functions.items():
            for call in fn.body_calls:
                # Check if call references config_key or consumes it
                if any(config_key in str(arg) for arg in call.arguments):
                    consumer_func = fn_name
                    consumer_call = call
                    break
            if consumer_func:
                break
            # Check if assigned locally
            for var_name, assigned_val in fn.body_assignments.items():
                if config_key in str(assigned_val) or config_key == str(assigned_val):
                    consumer_func = fn_name
                    for call in fn.body_calls:
                        if call.callee_name == target_init_func or any(var_name in str(a) for a in call.arguments):
                            consumer_call = call
                            break
                    if not consumer_call and fn.body_calls:
                        consumer_call = fn.body_calls[0]
                    break
            if consumer_func:
                break

        if not consumer_func or not consumer_call:
            trace.is_certain = False
            trace.confidence = "LOW"
            trace.uncertainty_reason = f"No function consumer found for configuration key '{config_key}'"
            return trace

        trace.steps.append(
            FlowStep(
                node_type="wrapper",
                name=consumer_func,
                line_number=consumer_call.line_number,
                snippet=consumer_call.snippet,
                value=cfg_val,
            )
        )

        # Now trace from consumer down to target initialization function
        if consumer_call.callee_name == target_init_func:
            trace.steps.append(
                FlowStep(
                    node_type="crypto_call",
                    name=target_init_func,
                    line_number=consumer_call.line_number,
                    snippet=consumer_call.snippet,
                    value=cfg_val,
                )
            )
            trace.inferred_algorithm = str(cfg_val)
            return trace

        # Traverse downstream
        sub_trace = self.trace_parameter_flow(consumer_call.callee_name, cfg_val, target_init_func)
        trace.steps.extend(sub_trace.steps[1:])  # Skip duplicated source step
        trace.is_certain = sub_trace.is_certain
        trace.confidence = sub_trace.confidence
        trace.inferred_algorithm = sub_trace.inferred_algorithm
        trace.uncertainty_reason = sub_trace.uncertainty_reason

        return trace
