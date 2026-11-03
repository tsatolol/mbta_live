# Cloud SQL（PostgreSQL 16）。web とジョブは Cloud Run の Cloud SQL 接続（Unix ソケット）でつなぐ。

resource "google_sql_database_instance" "main" {
  project          = var.project_id
  name             = "mbta-live"
  region           = var.region
  database_version = "POSTGRES_16"

  # Terraform からの削除を防ぐ（prod は true）
  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    # API やコンソールからの削除も防ぐ
    deletion_protection_enabled = var.db_deletion_protection

    backup_configuration {
      enabled = true
      # 08:00 UTC = 03:00 / 04:00 ET（運行日の境界のあと、sync-static の前）
      start_time                     = "08:00"
      point_in_time_recovery_enabled = false
      backup_retention_settings {
        retained_backups = var.db_backup_retained_count
      }
    }

    # 日曜 09:00 UTC（04:00 / 05:00 ET）。収集が少ない早朝
    maintenance_window {
      day          = 7
      hour         = 9
      update_track = "stable"
    }

    ip_configuration {
      # Cloud Run の Cloud SQL 接続は公開 IP を経由する（承認済みネットワークは設定しない = 直接はつなげない）
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = "mbta_live"
}

# DB のパスワードは ephemeral（plan と state に残らない）で作り、write-only の引数で
# Cloud SQL のユーザーと Secret Manager に入れる。変えるときは db_password_version を上げる
ephemeral "random_password" "db" {
  length  = 32
  special = false
}

locals {
  db_password_version = 1
}

resource "google_sql_user" "app" {
  project             = var.project_id
  instance            = google_sql_database_instance.main.name
  name                = "app"
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = local.db_password_version
}
