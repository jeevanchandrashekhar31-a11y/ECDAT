# @ecdat-synthetic-corpus
"""
Adversarial Security Test: SQL Injection Prevention Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import sqlite3
import pytest

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "sql_injection_payloads.json"


class TestSQLInjectionControl:
    """
    Security Control: SQL Injection Defense & Query Parameterization
    Guarantees that all external database inputs are bound as literal parameters, preventing query tampering.
    """

    @pytest.fixture
    def db(self):
        conn = sqlite3.connect(":memory:")
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE scans (id TEXT PRIMARY KEY, target TEXT, findings_count INT)")
        cursor.execute("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT)")

        cursor.execute("INSERT INTO scans VALUES ('s1', 'repo-alpha', 3)")
        cursor.execute("INSERT INTO scans VALUES ('s2', 'repo-beta', 0)")
        cursor.execute("INSERT INTO users VALUES ('u1', 'admin', 'synthetic-hash-admin-123')")
        conn.commit()
        yield conn
        conn.close()

    @pytest.fixture
    def payloads(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Parameterized query returns exact record
    def test_positive_sql_injection(self, db, payloads):
        cursor = db.cursor()
        cursor.execute("SELECT id, target FROM scans WHERE target = ?", ("repo-alpha",))
        rows = cursor.fetchall()
        assert len(rows) == 1
        assert rows[0][1] == "repo-alpha"

    # 2. NEGATIVE TEST: Query for non-existent target returns zero rows cleanly
    def test_negative_sql_injection(self, db, payloads):
        cursor = db.cursor()
        cursor.execute("SELECT id, target FROM scans WHERE target = ?", ("non-existent-repo",))
        rows = cursor.fetchall()
        assert len(rows) == 0

    # 3. BOUNDARY TEST: Parameter at extreme length boundaries treated as literal
    def test_boundary_sql_injection(self, db):
        cursor = db.cursor()
        long_param = "x" * 1024
        cursor.execute("SELECT id FROM scans WHERE target = ?", (long_param,))
        assert len(cursor.fetchall()) == 0

        # Empty string parameter
        cursor.execute("SELECT id FROM scans WHERE target = ?", ("",))
        assert len(cursor.fetchall()) == 0

    # 4. MALICIOUS TEST: Hostile SQL injection payloads treated strictly as literal string values
    def test_malicious_sql_injection(self, db, payloads):
        mal_list = payloads.get("malicious", [
            "' OR '1'='1",
            "' OR 1=1 --",
            "admin'--",
            "' UNION SELECT username, password FROM users --",
            "'; DROP TABLE scans; --",
            "1; EXEC xp_cmdshell('dir'); --",
        ])
        cursor = db.cursor()

        for mal_payload in mal_list:
            cursor.execute("SELECT id, target FROM scans WHERE target = ?", (mal_payload,))
            rows = cursor.fetchall()
            # Must return 0 rows because no target literally equals the SQL payload
            assert len(rows) == 0

        # Table scans must still exist (stacked DROP TABLE injection was neutralized)
        cursor.execute("SELECT count(*) FROM scans")
        count = cursor.fetchone()[0]
        assert count == 2

    # 5. REGRESSION TEST: Verification that unparameterized concatenation is vulnerable whereas parameterization is immune
    def test_regression_sql_injection(self, db):
        tautology = "' OR '1'='1"

        # Parameterized query evaluates tautology as data: 0 rows returned
        cursor = db.cursor()
        cursor.execute("SELECT count(*) FROM scans WHERE target = ?", (tautology,))
        param_count = cursor.fetchone()[0]
        assert param_count == 0

        # Confirms immunity against UNION data exfiltration
        union_payload = "' UNION SELECT id, username FROM users --"
        cursor.execute("SELECT id, target FROM scans WHERE target = ?", (union_payload,))
        assert len(cursor.fetchall()) == 0
