#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

mode="${1:-all}"
log_dir="${DEPLOY_LOG_DIR:-logs}"
mkdir -p "$log_dir"
log_file="$log_dir/deploy-$(date +%Y%m%d%H%M%S).log"

exec > >(tee -a "$log_file") 2>&1

run() {
  echo "+ $*"
  "$@"
}

health_check() {
  if command -v curl >/dev/null 2>&1; then
    echo "Waiting for health check..."
    for i in {1..30}; do
      if curl -fsS http://127.0.0.1:9020/api/health >/dev/null 2>&1; then
        echo "Health check passed!"
        run curl -fsS http://127.0.0.1:9020/api/health
        echo
        return 0
      fi
      sleep 2
    done
    echo "Health check warning: service not responding on :9020 yet."
  fi
}

sync_frontend_dist() {
  run rm -rf frontend/dist
  run mkdir -p frontend/dist
  run docker cp radiology-frontend:/usr/share/nginx/html/. frontend/dist/ || true
}

case "$mode" in
  all)
    run docker compose build backend frontend
    run docker compose up -d
    sync_frontend_dist
    run docker compose exec -T nginx nginx -t
    run docker compose restart nginx
    ;;
  backend)
    run docker compose build backend
    run docker compose up -d backend
    ;;
  frontend)
    run docker compose build frontend
    run docker compose up -d frontend
    sync_frontend_dist
    ;;
  nginx)
    run docker compose exec -T nginx nginx -t
    run docker compose restart nginx
    ;;
  *)
    echo "Usage: $0 [all|backend|frontend|nginx]"
    exit 2
    ;;
esac

run docker compose ps
health_check
echo "Deploy complete. Log: $log_file"
