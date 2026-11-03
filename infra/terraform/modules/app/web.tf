# Cloud Run サービス（web）。イメージとトラフィックはパイプラインが gcloud で更新する。

resource "google_cloud_run_v2_service" "web" {
  project  = var.project_id
  name     = "web"
  location = var.region

  # 認証は IAP（iap.tf）。Cloud Run に直接組み込む方式なので、ロードバランサは使わない
  ingress     = "INGRESS_TRAFFIC_ALL"
  iap_enabled = true
  # ステートレスなので、Terraform から作り直せるようにする（DB は sql.tf で守る）
  deletion_protection = false

  template {
    service_account                  = google_service_account.web.email
    max_instance_request_concurrency = 80
    timeout                          = "30s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.web_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.db_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # 起動の確認はポートが開くことだけにする。/api/health（DB への接続）はデプロイ後のスモークテストで確かめる。
      # 最初の apply ではまだマイグレーションが適用されていないので、/api/health を使うと web を作れないため（research.md）
      startup_probe {
        tcp_socket {
          port = 8080
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 6
      }
    }
  }

  lifecycle {
    # イメージ・リビジョン名・トラフィック（prod の candidate タグなど）はパイプラインが管理する
    ignore_changes = [
      client,
      client_version,
      template[0].revision,
      template[0].containers[0].image,
      traffic,
    ]
  }

  depends_on = [
    google_project_iam_member.sql_client,
    google_secret_manager_secret_iam_member.db_password,
    google_secret_manager_secret_version.db_password,
  ]
}
