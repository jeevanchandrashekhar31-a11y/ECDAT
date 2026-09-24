import requests
import pytest
import datetime

BASE_URL = "http://localhost:5000/api/v1"

def login_and_get_cookie():
    res = requests.post(f"{BASE_URL}/auth/local/login", json={"username": "admin", "password": "password"})
    if res.status_code == 200:
        return res.headers.get("set-cookie")
    
    res = requests.post(f"{BASE_URL}/auth/evaluation/enter")
    if res.status_code == 200:
        return res.headers.get("set-cookie")
    return None

def test_blast_radius_calculation():
    cookie = login_and_get_cookie()
    assert cookie is not None, "Failed to authenticate"

    headers = {"Cookie": cookie}
    current_year = datetime.datetime.now().year
    
    # 1) Date that SHOULD trigger a deficit (Z = 5 years)
    # The mock injects X=10, Y=5, so total is 15. Z=5 gives deficit of 10 -> AFFECTED
    year_affected = current_year + 5
    res1 = requests.get(f"{BASE_URL}/blast-radius?quantum_arrival_year={year_affected}&scanId=demo-synthetic-scan", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    
    affected_nodes = [n for n in data1["projection"] if n["status"] == "AFFECTED"]
    assert len(affected_nodes) > 0, "Expected at least one node to be affected due to injected mock data"
    test_node_id = affected_nodes[0]["id"]
    
    # 2) Date that should NOT trigger a deficit (Z = 30 years)
    # Total is 15. Z=30 gives deficit of -15 -> SAFE
    year_safe = current_year + 30
    res2 = requests.get(f"{BASE_URL}/blast-radius?quantum_arrival_year={year_safe}&scanId=demo-synthetic-scan", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()
    
    safe_node = next((n for n in data2["projection"] if n["id"] == test_node_id), None)
    assert safe_node is not None, "Test component missing from projection"
    assert safe_node["status"] == "SAFE"

    # 3) Component with missing data should return INSUFFICIENT_EVIDENCE_FOR_PROJECTION
    # The mock only injects into the first node. All other nodes should be INSUFFICIENT.
    insufficient_nodes = [n for n in data1["projection"] if n["status"] == "INSUFFICIENT_EVIDENCE_FOR_PROJECTION"]
    assert len(insufficient_nodes) > 0, "Expected at least one node with missing data"
