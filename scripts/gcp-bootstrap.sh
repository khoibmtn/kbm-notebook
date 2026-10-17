#!/usr/bin/env bash
# KBM Notebook — chuẩn bị hạ tầng GCP cho pipeline .github/workflows/deploy-cloud-run.yml
#
# MẶC ĐỊNH = PHƯƠNG ÁN 0 ĐỒNG (free tier):
#   - CSDL: Supabase (free) — KHÔNG tạo Cloud SQL. Bạn tự lấy DATABASE_URL từ Supabase dashboard.
#   - Tạo: Artifact Registry (kèm cleanup policy giữ 2 image mới nhất), bucket GCS (lifecycle, chặn truy cập công khai),
#     2 service account (deployer để GitHub Actions dùng, runtime để Cloud Run dùng), khoá JSON cho deployer.
#   - Bật API: run, artifactregistry, storage, iam (+ cloudresourcemanager để gán quyền).
#   Tuỳ chọn --with-cloudsql: tạo thêm Cloud SQL Postgres 16 — CÓ TÍNH PHÍ (khoảng vài chục USD/tháng), xem docs/08.
#
# Dùng:
#   PROJECT_ID=my-project ./scripts/gcp-bootstrap.sh
#   PROJECT_ID=my-project DB_PASSWORD="$(openssl rand -hex 16)" ./scripts/gcp-bootstrap.sh --with-cloudsql
#
# Biến môi trường:
#   PROJECT_ID   (bắt buộc) ID dự án GCP, đã gắn tài khoản thanh toán (billing) — Cloud Run yêu cầu dù dùng $0.
#   REGION       (mặc định us-central1) vùng Cloud Run + Artifact Registry + bucket. Vùng Mỹ nằm trong free tier của GCS.
#   DB_PASSWORD  (chỉ khi --with-cloudsql) mật khẩu user Postgres `kbm`; chỉ gồm A-Z a-z 0-9 . _ ~ - để nhúng vào URL.
#   BUCKET       (mặc định ${PROJECT_ID}-kbm-storage) tên bucket lưu tệp tải lên.
#   OUT_DIR      (mặc định ./.gcp) nơi lưu khoá JSON + secret sinh ra (thư mục này đã nằm trong .gitignore).
# Cờ:
#   --with-cloudsql   tạo Cloud SQL (có phí)       --rotate-key   tạo khoá JSON mới thay khoá cũ
#   -h, --help
#
# Script idempotent: chạy lại an toàn; tài nguyên đã có sẽ được bỏ qua. Cần: gcloud (đã `gcloud auth login`), openssl.
# CHƯA được chạy thử trong môi trường phát triển (không có thông tin đăng nhập GCP) — kiểm tra bằng bash -n / shellcheck.
set -euo pipefail

# ---------------------------------------------------------------------------
# Tiện ích
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[cảnh báo]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[lỗi]\033[0m %s\n' "$*" >&2; exit 1; }

# retry SỐ_LẦN GIÃN_CÁCH_GIÂY lệnh… — IAM/API mới tạo cần vài giây để "lan truyền" nên lệnh đầu có thể thất bại.
retry() {
  local tries="$1" delay="$2" n=1
  shift 2
  until "$@"; do
    if [ "$n" -ge "$tries" ]; then return 1; fi
    warn "Lần $n/$tries thất bại, thử lại sau ${delay}s: $*"
    n=$((n + 1))
    sleep "$delay"
  done
}

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------
# Tham số
# ---------------------------------------------------------------------------
WITH_CLOUDSQL=false
ROTATE_KEY=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-cloudsql) WITH_CLOUDSQL=true ;;
    --rotate-key) ROTATE_KEY=true ;;
    -h | --help) usage; exit 0 ;;
    *) die "Cờ không hợp lệ: $1 (xem --help)" ;;
  esac
  shift
done

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-${PROJECT_ID}-kbm-storage}"
BUCKET_LOCATION="${BUCKET_LOCATION:-$REGION}"
AR_REPO="${AR_REPO:-kbm}"
DEPLOYER_NAME="kbm-deployer"
RUNTIME_NAME="kbm-runtime"
OUT_DIR="${OUT_DIR:-./.gcp}"
KEY_FILE="${OUT_DIR}/deployer-key.json"
SECRETS_FILE="${OUT_DIR}/secrets.env"
SETTINGS_FILE="${OUT_DIR}/github-settings.txt"

# Cloud SQL (chỉ dùng với --with-cloudsql)
SQL_INSTANCE="${SQL_INSTANCE:-kbm-pg}"
DB_NAME="${DB_NAME:-kbm_notebook}"
DB_USER="${DB_USER:-kbm}"
DB_TIER="${DB_TIER:-db-g1-small}" # hoặc db-custom-1-3840 (1 vCPU / 3,75 GB, đắt hơn)
DB_PASSWORD="${DB_PASSWORD:-}"

[ -n "$PROJECT_ID" ] || die "Thiếu PROJECT_ID. Ví dụ: PROJECT_ID=my-project $0"
command -v gcloud > /dev/null || die "Chưa cài gcloud (https://cloud.google.com/sdk/docs/install) — hoặc chạy trong Cloud Shell."
command -v openssl > /dev/null || die "Chưa cài openssl."
if [ "$WITH_CLOUDSQL" = "true" ]; then
  [ -n "$DB_PASSWORD" ] || die "--with-cloudsql cần DB_PASSWORD (gợi ý: export DB_PASSWORD=\"\$(openssl rand -hex 16)\")."
  [[ "$DB_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] || die "DB_PASSWORD chỉ được gồm A-Z a-z 0-9 . _ ~ - (để nhúng thẳng vào DATABASE_URL)."
fi

DEPLOYER_EMAIL="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_EMAIL="${RUNTIME_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ---------------------------------------------------------------------------
# 0) Kiểm tra đăng nhập, dự án, billing
# ---------------------------------------------------------------------------
log "Kiểm tra tài khoản gcloud và dự án $PROJECT_ID"
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2> /dev/null | head -n1 || true)"
[ -n "$ACTIVE_ACCOUNT" ] || die "Chưa đăng nhập gcloud. Chạy: gcloud auth login"
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' > /dev/null 2>&1 \
  || die "Không tìm thấy dự án '$PROJECT_ID' (hoặc tài khoản $ACTIVE_ACCOUNT không có quyền). Tạo dự án trước: https://console.cloud.google.com/projectcreate"

BILLING="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2> /dev/null || true)"
case "$BILLING" in
  True | true) ;;
  False | false) die "Dự án chưa gắn tài khoản thanh toán. Cloud Run yêu cầu billing (dù dùng trong free tier vẫn \$0): https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID" ;;
  *) warn "Không đọc được trạng thái billing (thiếu quyền?). Nếu bước bật API báo lỗi billing, hãy gắn tài khoản thanh toán cho dự án." ;;
esac

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

# ---------------------------------------------------------------------------
# 1) Bật API (run, artifactregistry, storage, iam; thêm sqladmin nếu --with-cloudsql)
# ---------------------------------------------------------------------------
APIS=(run.googleapis.com artifactregistry.googleapis.com storage.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com)
if [ "$WITH_CLOUDSQL" = "true" ]; then APIS+=(sqladmin.googleapis.com); fi
log "Bật API: ${APIS[*]}"
gcloud services enable "${APIS[@]}" --project "$PROJECT_ID"

# ---------------------------------------------------------------------------
# 2) Artifact Registry: repo Docker `kbm` + cleanup policy (giữ 2 phiên bản mới nhất, xoá phần còn lại)
#    Free tier của Artifact Registry chỉ 0,5 GB nên cần dọn image cũ.
# ---------------------------------------------------------------------------
if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" > /dev/null 2>&1; then
  log "Artifact Registry '$AR_REPO' ($REGION) đã có — bỏ qua tạo mới"
else
  log "Tạo Artifact Registry '$AR_REPO' ($REGION)"
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location "$REGION" \
    --description="KBM Notebook images" --project "$PROJECT_ID"
fi

POLICY_FILE="${OUT_DIR}/ar-cleanup-policy.json"
cat > "$POLICY_FILE" << 'JSON'
[
  {
    "name": "keep-2-most-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 2 }
  },
  {
    "name": "delete-the-rest",
    "action": { "type": "Delete" },
    "condition": { "tagState": "any" }
  }
]
JSON
log "Đặt cleanup policy cho '$AR_REPO' (giữ 2 image mới nhất)"
# --no-dry-run: mặc định gcloud chỉ chạy thử (không xoá thật).
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" \
  --policy "$POLICY_FILE" --no-dry-run \
  || warn "Không đặt được cleanup policy (có thể do phiên bản gcloud) — vào Console > Artifact Registry > $AR_REPO > Cleanup policies để đặt tay."

# ---------------------------------------------------------------------------
# 3) Bucket GCS lưu tệp tải lên: không công khai, lifecycle dọn rác
#    Free tier: 5 GB-tháng ở us-central1 / us-east1 / us-west1.
# ---------------------------------------------------------------------------
if gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT_ID" > /dev/null 2>&1; then
  log "Bucket gs://${BUCKET} đã có — bỏ qua tạo mới"
else
  log "Tạo bucket gs://${BUCKET} ($BUCKET_LOCATION)"
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT_ID" --location "$BUCKET_LOCATION" \
    --uniform-bucket-level-access --public-access-prevention \
    || die "Không tạo được bucket '$BUCKET' (tên có thể đã bị người khác dùng). Đặt BUCKET=<tên-khác> rồi chạy lại."
fi

LIFECYCLE_FILE="${OUT_DIR}/bucket-lifecycle.json"
# Chỉ dọn rác: upload nhiều phần bỏ dở sau 7 ngày, tệp tạm *.part (app ghi .part rồi đổi tên) sau 2 ngày.
# KHÔNG xoá tệp của người dùng.
cat > "$LIFECYCLE_FILE" << 'JSON'
{
  "rule": [
    { "action": { "type": "AbortIncompleteMultipartUpload" }, "condition": { "age": 7 } },
    { "action": { "type": "Delete" }, "condition": { "age": 2, "matchesSuffix": [".part"] } }
  ]
}
JSON
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file "$LIFECYCLE_FILE" --project "$PROJECT_ID" \
  || warn "Không đặt được lifecycle cho bucket — không bắt buộc, có thể bỏ qua."

# ---------------------------------------------------------------------------
# 4) Service account
#    - kbm-deployer: GitHub Actions dùng (build/push/deploy). Quyền: run.admin, artifactregistry.writer,
#      iam.serviceAccountUser, storage.objectAdmin (+ cloudsql.client nếu --with-cloudsql).
#    - kbm-runtime : danh tính của dịch vụ Cloud Run khi chạy (đọc/ghi bucket; Cloud SQL nếu có). Tách riêng để không phụ
#      thuộc service account Compute mặc định (tổ chức mới thường không còn cấp sẵn quyền cho nó).
# ---------------------------------------------------------------------------
create_sa() { # create_sa TÊN MÔ_TẢ
  if gcloud iam service-accounts describe "${1}@${PROJECT_ID}.iam.gserviceaccount.com" --project "$PROJECT_ID" > /dev/null 2>&1; then
    log "Service account $1 đã có"
  else
    log "Tạo service account $1"
    gcloud iam service-accounts create "$1" --display-name "$2" --project "$PROJECT_ID"
  fi
}
create_sa "$DEPLOYER_NAME" "KBM Notebook - deployer (GitHub Actions)"
create_sa "$RUNTIME_NAME" "KBM Notebook - runtime (Cloud Run)"

bind_project() { # bind_project EMAIL VAI_TRÒ
  log "Gán $2 cho $1 (cấp dự án)"
  retry 6 10 gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$1" --role "$2" --condition=None --quiet > /dev/null
}
bind_bucket() { # bind_bucket EMAIL VAI_TRÒ
  log "Gán $2 cho $1 (trên bucket gs://${BUCKET})"
  retry 6 10 gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member "serviceAccount:$1" --role "$2" --project "$PROJECT_ID" > /dev/null
}

bind_project "$DEPLOYER_EMAIL" roles/run.admin
bind_project "$DEPLOYER_EMAIL" roles/artifactregistry.writer
bind_project "$DEPLOYER_EMAIL" roles/iam.serviceAccountUser
bind_bucket "$DEPLOYER_EMAIL" roles/storage.objectAdmin
bind_bucket "$RUNTIME_EMAIL" roles/storage.objectAdmin

# ---------------------------------------------------------------------------
# 5) (Tuỳ chọn, CÓ PHÍ) Cloud SQL Postgres 16 + pgvector
#    pgvector (`vector`) và pg_trgm có sẵn trên Cloud SQL; migration của app tự chạy
#    CREATE EXTENSION IF NOT EXISTS vector / pg_trgm (user tạo bằng gcloud thuộc cloudsqlsuperuser) nên KHÔNG cần chạy tay.
# ---------------------------------------------------------------------------
DATABASE_URL_VALUE=""
if [ "$WITH_CLOUDSQL" = "true" ]; then
  warn "Cloud SQL KHÔNG nằm trong free tier: instance $DB_TIER chạy 24/7 tốn khoảng vài chục USD/tháng."
  if gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID" > /dev/null 2>&1; then
    log "Cloud SQL instance $SQL_INSTANCE đã có"
  else
    log "Tạo Cloud SQL $SQL_INSTANCE (POSTGRES_16, $DB_TIER) — mất khoảng 5-10 phút"
    gcloud sql instances create "$SQL_INSTANCE" --project "$PROJECT_ID" --region "$REGION" \
      --database-version=POSTGRES_16 --edition=ENTERPRISE --tier "$DB_TIER" \
      --storage-type=SSD --storage-size=10GB --storage-auto-increase \
      --availability-type=zonal --backup-start-time=17:00
  fi
  if gcloud sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" --project "$PROJECT_ID" > /dev/null 2>&1; then
    log "Database $DB_NAME đã có"
  else
    log "Tạo database $DB_NAME"
    gcloud sql databases create "$DB_NAME" --instance "$SQL_INSTANCE" --project "$PROJECT_ID"
  fi
  if [ -n "$(gcloud sql users list --instance "$SQL_INSTANCE" --project "$PROJECT_ID" --filter="name=$DB_USER" --format='value(name)')" ]; then
    log "User $DB_USER đã có — đồng bộ lại mật khẩu theo DB_PASSWORD"
    gcloud sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --project "$PROJECT_ID" --password "$DB_PASSWORD"
  else
    log "Tạo user $DB_USER"
    gcloud sql users create "$DB_USER" --instance "$SQL_INSTANCE" --project "$PROJECT_ID" --password "$DB_PASSWORD"
  fi
  bind_project "$DEPLOYER_EMAIL" roles/cloudsql.client
  bind_project "$RUNTIME_EMAIL" roles/cloudsql.client
  DATABASE_URL_VALUE="postgres://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
fi

# ---------------------------------------------------------------------------
# 6) Khoá JSON cho deployer -> secret GCP_SA_KEY
#    Nếu tổ chức chặn tạo khoá (policy iam.disableServiceAccountKeyCreation) -> dùng Workload Identity (docs/08).
# ---------------------------------------------------------------------------
if [ -s "$KEY_FILE" ] && [ "$ROTATE_KEY" != "true" ]; then
  log "Khoá deployer đã có tại $KEY_FILE (dùng --rotate-key để tạo khoá mới)"
else
  if [ -s "$KEY_FILE" ]; then
    log "Xoá khoá cũ cục bộ rồi tạo khoá mới (khoá cũ vẫn còn hiệu lực trên GCP — xoá bằng 'gcloud iam service-accounts keys delete')"
    rm -f "$KEY_FILE"
  fi
  log "Tạo khoá JSON cho $DEPLOYER_EMAIL"
  umask 077
  if ! retry 4 10 gcloud iam service-accounts keys create "$KEY_FILE" --iam-account "$DEPLOYER_EMAIL" --project "$PROJECT_ID"; then
    warn "Không tạo được khoá service account. Nếu tổ chức bật policy 'iam.disableServiceAccountKeyCreation', hãy dùng Workload Identity Federation (docs/08-trien-khai.md) và đặt secret GCP_WIF_PROVIDER + GCP_SA_EMAIL=$DEPLOYER_EMAIL thay cho GCP_SA_KEY."
    rm -f "$KEY_FILE"
  fi
fi
chmod 600 "$KEY_FILE" 2> /dev/null || true

# ---------------------------------------------------------------------------
# 7) Bí mật ngẫu nhiên — sinh một lần, lưu lại để chạy lại script không đổi giá trị
#    (đổi BETTER_AUTH_SECRET = đăng xuất mọi người; MẤT APP_ENCRYPTION_KEY = mất các khoá API người dùng đã lưu)
# ---------------------------------------------------------------------------
if [ -s "$SECRETS_FILE" ]; then
  log "Dùng lại secret đã sinh trong $SECRETS_FILE"
else
  log "Sinh BETTER_AUTH_SECRET và APP_ENCRYPTION_KEY"
  (
    umask 077
    {
      echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
      echo "APP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    } > "$SECRETS_FILE"
  )
fi
BETTER_AUTH_SECRET="$(sed -n 's/^BETTER_AUTH_SECRET=//p' "$SECRETS_FILE")"
APP_ENCRYPTION_KEY="$(sed -n 's/^APP_ENCRYPTION_KEY=//p' "$SECRETS_FILE")"
if [ -z "$BETTER_AUTH_SECRET" ] || [ -z "$APP_ENCRYPTION_KEY" ]; then die "$SECRETS_FILE hỏng — xoá tệp này rồi chạy lại."; fi

# ---------------------------------------------------------------------------
# 8) In danh sách secrets / variables cần đặt trong GitHub
# ---------------------------------------------------------------------------
{
  echo "=============================================================================="
  echo " THIẾT LẬP GITHUB: Settings -> Secrets and variables -> Actions"
  echo "=============================================================================="
  echo
  echo "--- Tab 'Secrets' -> New repository secret ---"
  if [ -s "$KEY_FILE" ]; then
    echo "GCP_SA_KEY           = toàn bộ nội dung tệp: $KEY_FILE"
    echo "                       (CLI: gh secret set GCP_SA_KEY < \"$KEY_FILE\")"
  else
    echo "GCP_WIF_PROVIDER, GCP_SA_EMAIL = (không có khoá JSON) Workload Identity, xem docs/08; GCP_SA_EMAIL=$DEPLOYER_EMAIL"
  fi
  if [ "$WITH_CLOUDSQL" = "true" ]; then
    echo "DATABASE_URL         = $DATABASE_URL_VALUE"
    echo "CLOUDSQL_INSTANCE    = ${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
  else
    echo "DATABASE_URL         = <TỰ LẤY TỪ SUPABASE> Dashboard -> Connect -> 'Session pooler' (cổng 5432), dạng:"
    echo "                       postgresql://postgres.<PROJECT_REF>:<MẬT_KHẨU>@aws-0-<vùng>.pooler.supabase.com:5432/postgres?sslmode=require"
    echo "                       (mật khẩu có ký tự đặc biệt phải mã hoá %-encode; KHÔNG dùng Transaction pooler cổng 6543)"
  fi
  echo "BETTER_AUTH_SECRET   = $BETTER_AUTH_SECRET"
  echo "APP_ENCRYPTION_KEY   = $APP_ENCRYPTION_KEY"
  echo "GEMINI_API_KEY       = <khoá miễn phí tại https://aistudio.google.com/apikey>"
  echo "(tuỳ chọn) SMTP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"
  echo
  echo "--- Tab 'Variables' -> New repository variable ---"
  echo "GCP_PROJECT_ID       = $PROJECT_ID"
  echo "GCP_REGION           = $REGION"
  echo "GCS_BUCKET           = $BUCKET"
  echo "AUTH_REQUIRE_EMAIL_VERIFICATION = false     (demo; bật 'true' khi đã có SMTP_URL)"
  echo "(tuỳ chọn) APP_URL, MIN_INSTANCES, MAX_INSTANCES, CPU_ALWAYS_ON, GCS_MOUNT_OPTIONS, TRUSTED_ORIGINS"
  echo
  echo "Service account deployer: $DEPLOYER_EMAIL"
  echo "Service account runtime : $RUNTIME_EMAIL   (workflow dùng mặc định; đổi bằng variable RUNTIME_SA)"
  echo
  echo "Sau đó: GitHub -> Actions -> 'Deploy Cloud Run' -> Run workflow."
  echo "KHÔNG commit hay chia sẻ $OUT_DIR (chứa khoá riêng tư)."
} | tee "$SETTINGS_FILE"
chmod 600 "$SETTINGS_FILE"
log "Đã lưu bản sao danh sách ở $SETTINGS_FILE"
