import pytest
from scanners.static.parsers.cloud_infra_parser import CloudInfraParser

def test_terraform_elb_policy_resolution():
    parser = CloudInfraParser()
    
    tf_content = """
resource "aws_lb_listener" "front_end" {
  load_balancer_arn = aws_lb.front_end.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate.cert.arn
}
"""
    findings = parser.parse_content("main.tf", tf_content)
    
    assert len(findings) == 1
    f = findings[0]
    
    assert f.scope == "aws_lb_listener.front_end"
    assert f.policy_name == "ELBSecurityPolicy-2016-08"
    assert f.resolved_min_protocol == "TLSv1.0" # resolved from cloud_tls_policies.json!
