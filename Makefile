.PHONY: init up down clean

# Build the images, start the Compose stack, and let Compose run its
# dependency-ordered init services (for example minio-init).
init:
	docker compose up -d --build

# Start the existing Compose images without rebuilding them.
up:
	docker compose up -d

# Stop the Compose stack while preserving named volumes.
down:
	docker compose down

# Stop the stack and remove its containers, networks, and named volumes.
clean:
	docker compose down -v --remove-orphans
