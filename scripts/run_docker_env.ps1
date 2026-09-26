# Build and Run Docker Containers
docker-compose up -d --build

# Wait for healthy backend (optional)
Start-Sleep -Seconds 15

# Show logs
docker-compose logs -f
