# Cloud Run Jobs: collector、sync-static、aggregate、migrate。イメージはパイプラインが gcloud で更新する。
# 起動コマンドは docs/architecture.md の「イメージの起動コマンド」。

locals {
  jobs = {
    collector = {
      args        = ["jobs/collect.mjs"]
      timeout     = "50s" # 1 分間隔の次の回と重ならないように
      memory      = "512Mi"
      uses_mbta   = true
      description = "MBTA の車両・予測・アラートを収集する（001）"
      extra_env   = {}
    }
    sync-static = {
      args        = ["jobs/sync-static.mjs"]
      timeout     = "600s"
      memory      = "512Mi"
      uses_mbta   = true
      description = "路線・駅・運行パターンを同期する（001）"
      extra_env   = {}
    }
    aggregate = {
      args        = ["jobs/aggregate.mjs"]
      timeout     = "1800s"
      memory      = "1Gi"
      uses_mbta   = false
      description = "前の運行日を集計し、パーティションを作成・削除する（003 / 001）"
      extra_env   = { RAW_RETENTION_DAYS = tostring(var.raw_retention_days) }
    }
    migrate = {
      args        = ["migrate/node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "migrate/prisma.config.ts"]
      timeout     = "600s"
      memory      = "1Gi"
      uses_mbta   = false
      description = "prisma migrate deploy（デプロイのたびにパイプラインが実行する）"
      extra_env   = {}
    }
  }
}

resource "google_cloud_run_v2_job" "job" {
  for_each = local.jobs

  project  = var.project_id
  name     = each.key
  location = var.region
  # ステートレスなので、Terraform から作り直せるようにする
  deletion_protection = false
  labels = {
    app = "mbta-live"
  }

  template {
    task_count = 1

    template {
      service_account = google_service_account.jobs.email
      timeout         = each.value.timeout
      # 失敗しても再試行しない（collector は次の回で取り直す。MBTA API のレート制限を守る）
      max_retries = 0

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image   = var.image
        command = ["node"]
        args    = each.value.args

        resources {
          limits = {
            cpu    = "1"
            memory = each.value.memory
          }
        }

        dynamic "env" {
          for_each = merge(local.db_env, each.value.extra_env)
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

        dynamic "env" {
          for_each = each.value.uses_mbta && var.mbta_api_key_enabled ? [1] : []
          content {
            name = "MBTA_API_KEY"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.mbta_api_key.secret_id
                version = "latest"
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_iam_member.sql_client,
    google_secret_manager_secret_iam_member.db_password,
    google_secret_manager_secret_iam_member.mbta_api_key,
    google_secret_manager_secret_version.db_password,
  ]
}
