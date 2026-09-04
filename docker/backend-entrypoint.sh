#!/bin/sh
set -eu
node src/scripts/prepare_database.js
exec node src/server.js
