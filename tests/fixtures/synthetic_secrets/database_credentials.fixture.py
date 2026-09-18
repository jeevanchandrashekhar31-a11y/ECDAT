"""
# @ecdat-synthetic-corpus
ECDAT Synthetic Secrets Test Corpus - Database Credentials Fixture
Certified fake test credentials for testing scanner detection and synthetic discrimination.
"""

# ecdat:synthetic-fixture
DATABASE_URL = "postgresql://mock_user:mock_synthetic_password_fixture@db.test.local:5432/testdb"
MYSQL_DATABASE_URL = "mysql://mock_admin:mock_secret_pass_12345@127.0.0.1:3306/appdb"
DB_PASSWORD = "mock_synthetic_db_password_12345"
