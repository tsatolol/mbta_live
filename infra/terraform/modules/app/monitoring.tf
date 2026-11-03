# 監視（004 FR-013・FR-020）: ログベースの指標とアラートポリシー。
# ジョブの終了ログ（src/jobs/runner.ts の「ジョブ <名前> が終了しました」）の項目を読む。項目の名前を変えるときはここも直す。
# 通知先は bootstrap が作った通知チャンネル（表示名 mbta-live alerts）。dev は通知しない（ポリシーは作り、画面で見る）。
#
# /api/health の稼働時間チェック（uptime check）は作らない。IAP の背後にあり、稼働時間チェックの ID トークンの
# audience を IAP の OAuth クライアントに合わせられないため。同じことを、collector の成功の途絶と
# aggregate の遅れ（collector の終了ログ）で見る（research.md）。

data "google_monitoring_notification_channel" "email" {
  count = var.alert_notifications_enabled ? 1 : 0

  project      = var.project_id
  display_name = "mbta-live alerts"
}

locals {
  notification_channels = [for c in data.google_monitoring_notification_channel.email : c.name]

  # collector の終了ログ（Cloud Run Job collector の標準出力）
  collector_end_log = join(" AND ", [
    "resource.type=\"cloud_run_job\"",
    "resource.labels.job_name=\"collector\"",
    "jsonPayload.job=\"collect\"",
  ])
}

# ---- ログベースの指標

resource "google_logging_metric" "collector_success" {
  project     = var.project_id
  name        = "collector_success"
  description = "collector の成功した回数"
  filter      = "${local.collector_end_log} AND jsonPayload.status=\"success\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "vehicles_in_service_hours" {
  project         = var.project_id
  name            = "collector_vehicles_in_service_hours"
  description     = "運行時間中（05:30〜24:00 ET）の collector が取得した車両数"
  filter          = "${local.collector_end_log} AND jsonPayload.status=\"success\" AND jsonPayload.inServiceHours=true"
  value_extractor = "EXTRACT(jsonPayload.counts.vehicles)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
  }
  bucket_options {
    explicit_buckets {
      bounds = [0, 1, 10, 50, 100, 200, 500]
    }
  }
}

resource "google_logging_metric" "rejected_row_ratio" {
  project         = var.project_id
  name            = "collector_rejected_row_ratio"
  description     = "collector で応答の解析に失敗した行の割合"
  filter          = "${local.collector_end_log} AND jsonPayload.status=\"success\""
  value_extractor = "EXTRACT(jsonPayload.rejectedRowRatio)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
  }
  bucket_options {
    explicit_buckets {
      bounds = [0, 0.001, 0.01, 0.05, 0.1, 0.5, 1]
    }
  }
}

resource "google_logging_metric" "unknown_stop_ids" {
  project         = var.project_id
  name            = "collector_unknown_stop_ids"
  description     = "collector で駅一覧にない stop ID の数（次の sync-static で解決する）"
  filter          = "${local.collector_end_log} AND jsonPayload.status=\"success\""
  value_extractor = "EXTRACT(jsonPayload.counts.unknownStopIds)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
  }
  bucket_options {
    explicit_buckets {
      bounds = [0, 1, 5, 20, 100]
    }
  }
}

resource "google_logging_metric" "aggregate_overdue" {
  project     = var.project_id
  name        = "collector_aggregate_overdue"
  description = "05:00 ET を過ぎても、今の運行日に aggregate が成功していないことを collector が見つけた回数"
  filter      = "${local.collector_end_log} AND jsonPayload.aggregateOverdue=true"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# ログベースの指標は、作ってから Cloud Monitoring で使えるようになるまで最大 10 分かかる。作った直後にアラートポリシーを
# 作ると「Cannot find metric(s)」で失敗するので、指標を新しく作ったときだけ待つ（パイプラインの 13 回目の実行。research.md）
resource "time_sleep" "log_metrics_propagation" {
  create_duration = "300s"

  triggers = {
    metrics = join(",", [
      google_logging_metric.collector_success.id,
      google_logging_metric.vehicles_in_service_hours.id,
      google_logging_metric.rejected_row_ratio.id,
      google_logging_metric.unknown_stop_ids.id,
      google_logging_metric.aggregate_overdue.id,
    ])
  }
}

# ---- アラートポリシー（FR-013）

resource "google_monitoring_alert_policy" "collector_stopped" {
  project      = var.project_id
  display_name = "収集が止まった（collector の成功が途絶えた）"
  combiner     = "OR"
  conditions {
    display_name = "collector の成功が ${var.collector_absence_seconds} 秒ない"
    condition_absent {
      filter   = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.collector_success.name}\""
      duration = "${var.collector_absence_seconds}s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = local.notification_channels

  depends_on = [time_sleep.log_metrics_propagation]
}

resource "google_monitoring_alert_policy" "no_vehicles" {
  project      = var.project_id
  display_name = "運行時間中に車両が 0 件"
  combiner     = "OR"
  conditions {
    display_name = "運行時間中の車両数が 10 分間 0"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.vehicles_in_service_hours.name}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }
  notification_channels = local.notification_channels

  depends_on = [time_sleep.log_metrics_propagation]
}

resource "google_monitoring_alert_policy" "rejected_rows" {
  project      = var.project_id
  display_name = "応答の解析に失敗した行が 1% を超えた"
  combiner     = "OR"
  conditions {
    display_name = "解析に失敗した行の割合 > 1%"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.rejected_row_ratio.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }
  notification_channels = local.notification_channels

  depends_on = [time_sleep.log_metrics_propagation]
}

resource "google_monitoring_alert_policy" "unknown_stop_ids" {
  project      = var.project_id
  display_name = "駅一覧にない stop ID が 1 時間続いている"
  combiner     = "OR"
  conditions {
    display_name = "未解決の stop ID が 1 件以上、60 分間"
    condition_threshold {
      filter = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.unknown_stop_ids.name}\""
      # COMPARISON_GE は使えない（LT と GT だけ）。分布の p99 は、0 件だけなら [0, 1) のバケットの中で 1 未満になる
      comparison      = "COMPARISON_GT"
      threshold_value = 0.999
      duration        = "3600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }
  notification_channels = local.notification_channels

  depends_on = [time_sleep.log_metrics_propagation]
}

resource "google_monitoring_alert_policy" "aggregate_overdue" {
  project      = var.project_id
  display_name = "前日分の集計が 05:00 ET までに終わっていない"
  combiner     = "OR"
  conditions {
    display_name = "collector が aggregate の遅れを見つけた"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.aggregate_overdue.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = local.notification_channels

  depends_on = [time_sleep.log_metrics_propagation]
}

# ---- web の監視（FR-020）

resource "google_monitoring_alert_policy" "web_5xx" {
  project      = var.project_id
  display_name = "web の 5xx が 5% を超えた"
  combiner     = "OR"
  conditions {
    display_name = "5 分間の 5xx の割合 > 5%"
    condition_threshold {
      filter             = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.web.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      denominator_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.web.name}\" AND metric.type=\"run.googleapis.com/request_count\""
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.05
      duration           = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  notification_channels = local.notification_channels
}

resource "google_monitoring_alert_policy" "web_latency" {
  project      = var.project_id
  display_name = "web の応答時間の p95 が 3 秒を超えた"
  combiner     = "OR"
  conditions {
    display_name = "5 分間の応答時間の p95 > 3 秒"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.web.name}\" AND metric.type=\"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 3000
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
      }
    }
  }
  notification_channels = local.notification_channels
}
